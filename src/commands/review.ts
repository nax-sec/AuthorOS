import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assembleAgentContext,
  assertNoRequiredMissing,
  renderContextBlock,
  type ContextDoc,
} from '../core/contextAssembly.ts';
import { readAgentProfile } from '../core/agentProfiles.ts';
import type { LlmClient } from '../core/llm.ts';
import { formatChapterNumber } from '../core/paths.ts';
import { AuthorOsError } from '../core/schema.ts';

export type ReviewMode = 'internal' | 'reader-sim' | 'all';

export interface ReviewOptions {
  chapter?: number;
  next?: boolean;
  mode: ReviewMode;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface ReviewArtifact {
  mode: 'internal' | 'reader-sim';
  path: string;
  source: 'model' | 'scaffold';
  content: string;
  written: boolean;
  contextInputs: string[];
  contextMissing: string[];
}

export interface ReviewResult {
  chapter: number;
  chapterId: string;
  generatedAt: string;
  artifacts: ReviewArtifact[];
}

interface AdvisorSpec {
  agent: string;
  marker: string;
  label: string;
  temperature: number;
}

const advisorSpecs: readonly AdvisorSpec[] = [
  { agent: 'world-advisor', marker: 'INTERNAL_REVIEW_WORLD_ADVISOR', label: '世界顾问 (world-advisor)', temperature: 0.4 },
  { agent: 'character-advisor', marker: 'INTERNAL_REVIEW_CHARACTER_ADVISOR', label: '人物顾问 (character-advisor)', temperature: 0.4 },
  { agent: 'plot-advisor', marker: 'INTERNAL_REVIEW_PLOT_ADVISOR', label: '剧情顾问 (plot-advisor)', temperature: 0.4 },
  { agent: 'style-advisor', marker: 'INTERNAL_REVIEW_STYLE_ADVISOR', label: '风格顾问 (style-advisor)', temperature: 0.4 },
];

const advisorReviewMaxTokens = 6000;
const editorReviewMaxTokens = 7000;
const readerSimMaxTokens = 5000;

export async function createChapterReview(projectDir: string, options: ReviewOptions): Promise<ReviewResult> {
  const chapter = resolveChapterNumber(options);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();
  await assertChapterDraftExists(projectDir, chapter);

  const runInternal = options.mode === 'internal' || options.mode === 'all';
  const runReaderSim = options.mode === 'reader-sim' || options.mode === 'all';

  const pending: Array<Promise<ReviewArtifact>> = [];
  if (runInternal) {
    pending.push(runInternalReview(projectDir, chapter, options.llm, now, options.write === true));
  }
  if (runReaderSim) {
    pending.push(runReaderSimReview(projectDir, chapter, options.llm, now, options.write === true));
  }

  const artifacts = await Promise.all(pending);
  return { chapter, chapterId, generatedAt: now, artifacts };
}

export function renderReviewResult(result: ReviewResult): string {
  const lines: string[] = [`AuthorOS review: chapter ${result.chapter}`];
  for (const artifact of result.artifacts) {
    lines.push('');
    lines.push(`--- ${artifact.mode} ---`);
    lines.push(`path: ${artifact.path}${artifact.written ? '' : ' (preview, use --write to save)'}`);
    lines.push(`source: ${artifact.source}`);
    if (artifact.contextInputs.length > 0) {
      lines.push('inputs:');
      for (const path of artifact.contextInputs) {
        lines.push(`  - ${path}`);
      }
    }
    if (artifact.contextMissing.length > 0) {
      lines.push('optional inputs missing:');
      for (const path of artifact.contextMissing) {
        lines.push(`  - ${path}`);
      }
    }
    lines.push('');
    lines.push(artifact.content.trimEnd());
  }
  lines.push('');
  return lines.join('\n');
}

async function runInternalReview(
  projectDir: string,
  chapter: number,
  llm: LlmClient | undefined,
  now: string,
  write: boolean,
): Promise<ReviewArtifact> {
  const chapterDraft = await readChapterDraft(projectDir, chapter);
  const allContextInputs: string[] = [];
  const allContextMissing: string[] = [];

  // Pre-flight: validate context + load profiles for all advisors (cheap I/O).
  // Run sequentially so missing-context errors surface in declaration order, not race order.
  const advisorPrep: Array<{ spec: AdvisorSpec; docs: ContextDoc[]; profile: string }> = [];
  for (const spec of advisorSpecs) {
    const docs = await assembleAgentContext(projectDir, spec.agent, { chapter });
    assertNoRequiredMissing(spec.agent, docs);
    accumulateContextPaths(docs, allContextInputs, allContextMissing);
    const profile = await readAgentProfile(projectDir, spec.agent);
    advisorPrep.push({ spec, docs, profile });
  }

  // 4 advisor model calls in parallel. Order in output is preserved by Promise.all.
  const advisorReports = await Promise.all(advisorPrep.map(async (prep) => ({
    spec: prep.spec,
    body: llm
      ? await generateAdvisorReview(llm, prep.spec, chapter, prep.profile, prep.docs, chapterDraft)
      : renderAdvisorScaffold(prep.spec),
  })));

  const editorContext = await assembleAgentContext(projectDir, 'editor', { chapter });
  assertNoRequiredMissing('editor', editorContext);
  accumulateContextPaths(editorContext, allContextInputs, allContextMissing);
  const editorProfile = await readAgentProfile(projectDir, 'editor');
  const editorDecision = llm
    ? await generateEditorDecision(llm, chapter, editorProfile, editorContext, chapterDraft, advisorReports)
    : renderEditorScaffold();

  const source: 'model' | 'scaffold' = llm ? 'model' : 'scaffold';
  const content = renderInternalReviewMarkdown(chapter, now, source, editorDecision, advisorReports);
  const path = `reviews/${formatChapterNumber(chapter)}.internal.md`;

  let written = false;
  if (write) {
    await mkdir(join(projectDir, 'reviews'), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  return {
    mode: 'internal',
    path,
    source,
    content,
    written,
    contextInputs: uniqueStrings(allContextInputs),
    contextMissing: uniqueStrings(allContextMissing),
  };
}

async function runReaderSimReview(
  projectDir: string,
  chapter: number,
  llm: LlmClient | undefined,
  now: string,
  write: boolean,
): Promise<ReviewArtifact> {
  const docs = await assembleAgentContext(projectDir, 'reader-sim', { chapter });
  assertNoRequiredMissing('reader-sim', docs);
  const profile = await readAgentProfile(projectDir, 'reader-sim');
  const personaNames = parsePersonaNames(docs);
  const body = llm
    ? await generateReaderSim(llm, chapter, profile, docs, personaNames)
    : renderReaderSimScaffold(personaNames);

  const source: 'model' | 'scaffold' = llm ? 'model' : 'scaffold';
  const content = wrapReviewContent('reader-sim', chapter, body, source, now);
  const path = `reviews/${formatChapterNumber(chapter)}.reader-sim.md`;

  let written = false;
  if (write) {
    await mkdir(join(projectDir, 'reviews'), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  return {
    mode: 'reader-sim',
    path,
    source,
    content,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    contextMissing: docs.filter((doc) => doc.status === 'optional-missing').map((doc) => doc.resolvedPath ?? doc.declaredPath),
  };
}

async function generateAdvisorReview(
  llm: LlmClient,
  spec: AdvisorSpec,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  chapterDraft: string,
): Promise<string> {
  const prompt = [
    spec.marker,
    `chapter: ${chapter}`,
    `role: ${spec.agent}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'chapter_draft:',
    chapterDraft,
    '',
    'task:',
    'Diagnose only from your specialty. Do not rewrite prose. Output Markdown with three sub-sections:',
    '## blocking',
    '## advisory',
    '## accepted-if-no-change',
    'If a section has nothing, write "- 无" under it.',
  ].join('\n');

  return await runAgentCall(llm, `${spec.agent} review`, prompt, {
    temperature: spec.temperature,
    maxTokens: advisorReviewMaxTokens,
  });
}

async function generateEditorDecision(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  chapterDraft: string,
  advisorReports: readonly { spec: AdvisorSpec; body: string }[],
): Promise<string> {
  const advisorBundle = advisorReports.map((entry) => [
    `### ${entry.spec.label}`,
    '',
    entry.body.trim(),
    '',
  ].join('\n')).join('\n');

  const prompt = [
    'INTERNAL_REVIEW_EDITOR',
    `chapter: ${chapter}`,
    'role: editor',
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'chapter_draft:',
    chapterDraft,
    '',
    'advisor_reports:',
    advisorBundle,
    '',
    'task:',
    'Synthesize advisor reports into decisions. Protect chief-writer direction unless a blocking risk is concrete.',
    'Output Markdown with exactly these four sections:',
    '## 已采纳',
    '## 已拒绝',
    '## 阻塞风险',
    '## 暂缓',
    'Each bullet must reference which advisor surfaced the item.',
    'If a section has nothing, write "- 无" under it.',
  ].join('\n');

  return await runAgentCall(llm, 'editor synthesis', prompt, {
    temperature: 0.35,
    maxTokens: editorReviewMaxTokens,
  });
}

async function generateReaderSim(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  personaNames: readonly string[],
): Promise<string> {
  const prompt = [
    'READER_SIM_REVIEW',
    `chapter: ${chapter}`,
    'role: reader-sim',
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'task:',
    'For each persona in .authoros/readers.yaml, write a short authentic reaction to this chapter.',
    'Output Markdown with exactly one ## heading per persona, in the order they appear in readers.yaml.',
    `Personas in order: ${personaNames.join(', ')}.`,
    'Each persona section should be 3-6 sentences, focused on what that persona cares about. No meta commentary.',
  ].join('\n');

  return await runAgentCall(llm, 'reader-sim review', prompt, {
    temperature: 0.55,
    maxTokens: readerSimMaxTokens,
  });
}

async function runAgentCall(
  llm: LlmClient,
  label: string,
  prompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  let reply: string;
  try {
    reply = await llm.generate(prompt, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`${label} model generation failed. ${detail}`);
  }
  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError(`${label} model returned empty content.`);
  }
  return trimmed;
}

function renderAdvisorScaffold(spec: AdvisorSpec): string {
  return [
    `## blocking`,
    '- (待 ' + spec.agent + ' 诊断)',
    '## advisory',
    '- (待 ' + spec.agent + ' 诊断)',
    `## accepted-if-no-change`,
    '- (待 ' + spec.agent + ' 诊断)',
  ].join('\n');
}

function renderEditorScaffold(): string {
  return [
    '## 已采纳',
    '- (待 editor 综合)',
    '## 已拒绝',
    '- (待 editor 综合)',
    '## 阻塞风险',
    '- (待 editor 综合)',
    '## 暂缓',
    '- (待 editor 综合)',
  ].join('\n');
}

function renderReaderSimScaffold(personaNames: readonly string[]): string {
  if (personaNames.length === 0) {
    return [
      '## (无人格)',
      '',
      '.authoros/readers.yaml 没有解析出任何人格,请检查文件。',
    ].join('\n');
  }
  return personaNames.map((name) => [
    `## ${name}`,
    '',
    '(待 reader-sim 用模型生成)',
    '',
  ].join('\n')).join('\n');
}

function renderInternalReviewMarkdown(
  chapter: number,
  now: string,
  source: 'model' | 'scaffold',
  editorDecision: string,
  advisorReports: readonly { spec: AdvisorSpec; body: string }[],
): string {
  const advisorBlock = advisorReports.map((entry) => [
    `### ${entry.spec.label}`,
    '',
    entry.body.trim(),
    '',
  ].join('\n')).join('\n');

  return [
    `# 章节 ${chapter} 内部评审`,
    '',
    `> generated: ${now}`,
    '> agent: editor (synthesis), with diagnostics from 4 advisors',
    `> source: ${source}`,
    '',
    '## 编辑决议',
    '',
    editorDecision.trim(),
    '',
    '## 顾问诊断',
    '',
    advisorBlock.trim(),
    '',
  ].join('\n');
}

function wrapReviewContent(
  mode: 'internal' | 'reader-sim',
  chapter: number,
  body: string,
  source: 'model' | 'scaffold',
  now: string,
): string {
  const title = mode === 'reader-sim' ? '模拟读者反馈' : '内部评审';
  const agent = mode === 'reader-sim' ? 'reader-sim' : 'editor';
  return [
    `# 章节 ${chapter} ${title}`,
    '',
    `> generated: ${now}`,
    `> agent: ${agent}`,
    `> source: ${source}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

function parsePersonaNames(docs: readonly ContextDoc[]): string[] {
  const doc = docs.find((entry) => entry.resolvedPath === '.authoros/readers.yaml');
  if (!doc?.content) return [];
  const names: string[] = [];
  for (const line of doc.content.split(/\r?\n/)) {
    const match = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (match) names.push(match[1].trim());
  }
  return names;
}

function resolveChapterNumber(options: ReviewOptions): number {
  if (options.chapter === undefined) {
    throw new AuthorOsError('author review requires --chapter <N>.');
  }
  if (!Number.isInteger(options.chapter) || options.chapter < 1) {
    throw new AuthorOsError('--chapter must be a positive integer.');
  }
  return options.chapter;
}

async function readChapterDraft(projectDir: string, chapter: number): Promise<string> {
  try {
    return await readFile(join(projectDir, 'chapters', `${formatChapterNumber(chapter)}.md`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(
        `Chapter draft missing at chapters/${formatChapterNumber(chapter)}.md. Run author write first.`,
      );
    }
    throw error;
  }
}

async function assertChapterDraftExists(projectDir: string, chapter: number): Promise<void> {
  try {
    await readFile(join(projectDir, 'chapters', `${formatChapterNumber(chapter)}.md`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(
        `Chapter draft missing at chapters/${formatChapterNumber(chapter)}.md. Run author write first.`,
      );
    }
    throw error;
  }
}

function accumulateContextPaths(docs: readonly ContextDoc[], present: string[], missing: string[]): void {
  for (const doc of docs) {
    if (doc.status === 'present' && doc.resolvedPath) {
      present.push(doc.resolvedPath);
    } else if (doc.status === 'optional-missing' && doc.resolvedPath) {
      missing.push(doc.resolvedPath);
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
