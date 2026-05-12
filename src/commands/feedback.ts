import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
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

export interface FeedbackImportOptions {
  chapter: number;
  inputPath: string;
  cwd: string;
  now?: Date;
}

export interface FeedbackImportResult {
  chapter: number;
  chapterId: string;
  path: string;
  imported: number;
  totalAfter: number;
}

export interface FeedbackAnalyzeOptions {
  chapter: number;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface FeedbackAnalyzeResult {
  chapter: number;
  chapterId: string;
  path: string;
  source: 'model' | 'scaffold';
  generatedAt: string;
  content: string;
  body: string;
  written: boolean;
  contextInputs: string[];
  contextMissing: string[];
  feedbackCount: number;
}

const feedbackAgent = 'feedback-analyzer';
const feedbackDirectory = 'feedback';

export async function importFeedback(
  projectDir: string,
  options: FeedbackImportOptions,
): Promise<FeedbackImportResult> {
  const chapter = validateChapter(options.chapter);
  const chapterId = formatChapterNumber(chapter);
  const inputAbsolute = resolvePath(options.cwd, options.inputPath);

  let raw: string;
  try {
    raw = await readFile(inputAbsolute, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(`Feedback input file not found: ${options.inputPath}`);
    }
    throw error;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new AuthorOsError(`Feedback input file has no non-empty lines: ${options.inputPath}`);
  }

  const received = (options.now ?? new Date()).toISOString();
  const entries = lines.map((text) => JSON.stringify({ chapter, text, received })).join('\n') + '\n';

  const path = `${feedbackDirectory}/${chapterId}.raw.jsonl`;
  await mkdir(join(projectDir, feedbackDirectory), { recursive: true });
  const targetPath = join(projectDir, path);
  await appendFile(targetPath, entries, 'utf8');

  const totalAfter = await countJsonlLines(targetPath);

  return { chapter, chapterId, path, imported: lines.length, totalAfter };
}

export function renderFeedbackImportResult(result: FeedbackImportResult): string {
  return [
    `AuthorOS feedback import: chapter ${result.chapter}`,
    `path: ${result.path}`,
    `imported: ${result.imported}`,
    `total after: ${result.totalAfter}`,
    '',
  ].join('\n');
}

export async function analyzeFeedback(
  projectDir: string,
  options: FeedbackAnalyzeOptions,
): Promise<FeedbackAnalyzeResult> {
  const chapter = validateChapter(options.chapter);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const rawPath = `${feedbackDirectory}/${chapterId}.raw.jsonl`;
  const feedbackCount = await countJsonlLines(join(projectDir, rawPath));
  if (feedbackCount === 0) {
    throw new AuthorOsError(`No imported feedback at ${rawPath}. Run author feedback import first.`);
  }

  const docs = await assembleAgentContext(projectDir, feedbackAgent, { chapter });
  assertNoRequiredMissing(feedbackAgent, docs);

  const profile = await readAgentProfile(projectDir, feedbackAgent);
  const body = options.llm
    ? await generateAnalysisWithModel(options.llm, chapter, profile, docs, feedbackCount)
    : renderAnalysisScaffold();

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';
  const content = wrapAnalysisContent(chapter, body, source, now, feedbackCount);
  const path = `${feedbackDirectory}/${chapterId}.analysis.md`;

  let written = false;
  if (options.write) {
    await mkdir(join(projectDir, feedbackDirectory), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  return {
    chapter,
    chapterId,
    path,
    source,
    generatedAt: now,
    content,
    body,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    contextMissing: docs.filter((doc) => doc.status === 'optional-missing').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    feedbackCount,
  };
}

export function renderFeedbackAnalyzeResult(result: FeedbackAnalyzeResult): string {
  const lines = [
    `AuthorOS feedback analyze: chapter ${result.chapter}`,
    `path: ${result.path}${result.written ? '' : ' (preview, use --write to save)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    `imported feedback entries: ${result.feedbackCount}`,
    'inputs:',
    ...result.contextInputs.map((path) => `  - ${path}`),
  ];
  if (result.contextMissing.length > 0) {
    lines.push('optional inputs missing:');
    for (const path of result.contextMissing) {
      lines.push(`  - ${path}`);
    }
  }
  lines.push('');
  lines.push(result.content.trimEnd());
  lines.push('');
  return lines.join('\n');
}

async function generateAnalysisWithModel(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  feedbackCount: number,
): Promise<string> {
  const prompt = [
    'FEEDBACK_ANALYZE',
    `chapter: ${chapter}`,
    `feedback_count: ${feedbackCount}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'task:',
    'Classify the imported reader feedback. Output Markdown with these exact sections:',
    '## 高频共性反馈',
    '## 情绪倾向',
    '## 有效反馈',
    '## 噪声反馈',
    '## 可能误读',
    '## 需要验证的假设',
    '## 不应迎合的反馈',
    'Each bullet may quote short snippets from the feedback. Distinguish surface complaint from likely root cause.',
    'If a section has nothing, write "- 无" under it.',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.4, maxTokens: 4000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Feedback analyze model generation failed. ${detail}`);
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Feedback analyze model returned empty content.');
  }
  return trimmed;
}

function renderAnalysisScaffold(): string {
  return [
    '## 高频共性反馈',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 情绪倾向',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 有效反馈',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 噪声反馈',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 可能误读',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 需要验证的假设',
    '- (待 feedback-analyzer 分析)',
    '',
    '## 不应迎合的反馈',
    '- (待 feedback-analyzer 分析)',
  ].join('\n');
}

function wrapAnalysisContent(
  chapter: number,
  body: string,
  source: 'model' | 'scaffold',
  now: string,
  feedbackCount: number,
): string {
  return [
    `# 章节 ${chapter} 真实读者反馈分析`,
    '',
    `> generated: ${now}`,
    '> agent: feedback-analyzer',
    `> source: ${source}`,
    `> feedback_count: ${feedbackCount}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

async function countJsonlLines(path: string): Promise<number> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

function validateChapter(chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new AuthorOsError('--chapter must be a positive integer.');
  }
  return chapter;
}
