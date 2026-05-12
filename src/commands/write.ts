import { mkdir, readdir, writeFile } from 'node:fs/promises';
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
import { computeChapterLengthSpec, readProjectConfig, type ChapterLengthSpec } from '../core/projectConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export interface WriteOptions {
  chapter?: number;
  next?: boolean;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface WriteResult {
  chapter: number;
  chapterId: string;
  path: string;
  source: 'model' | 'scaffold';
  generatedAt: string;
  body: string;
  content: string;
  written: boolean;
  contextInputs: string[];
  contextMissing: string[];
  targetCharCount: number;
  actualCharCount: number;
  withinTargetRange: boolean;
}


const chiefWriterAgent = 'chief-writer';
const chaptersDirectory = 'chapters';
const plansDirectory = 'plans';

export async function createChapterDraft(projectDir: string, options: WriteOptions): Promise<WriteResult> {
  const chapter = await resolveChapterNumber(projectDir, options);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const config = await readProjectConfig(projectDir);
  const lengthSpec = computeChapterLengthSpec(config);

  const docs = await assembleAgentContext(projectDir, chiefWriterAgent, { chapter });
  assertNoRequiredMissing(chiefWriterAgent, docs);

  const profile = await readAgentProfile(projectDir, chiefWriterAgent);
  const body = options.llm
    ? await generateDraftWithModel(options.llm, chapter, profile, docs, lengthSpec)
    : renderDraftScaffold(chapter);

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';
  const content = wrapDraftContent(chapter, body, source, now);
  const path = `${chaptersDirectory}/${chapterId}.md`;

  let written = false;
  if (options.write) {
    await mkdir(join(projectDir, chaptersDirectory), { recursive: true });
    await writeFile(join(projectDir, path), content, 'utf8');
    written = true;
  }

  const actualCharCount = countChineseChars(body);

  return {
    chapter,
    chapterId,
    path,
    source,
    generatedAt: now,
    body,
    content,
    written,
    contextInputs: docs.filter((doc) => doc.status === 'present').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    contextMissing: docs.filter((doc) => doc.status === 'optional-missing').map((doc) => doc.resolvedPath ?? doc.declaredPath),
    targetCharCount: lengthSpec.target,
    actualCharCount,
    withinTargetRange: source === 'scaffold'
      ? true
      : actualCharCount >= lengthSpec.minChars && actualCharCount <= lengthSpec.maxChars,
  };
}

export function renderWriteResult(result: WriteResult): string {
  const rangeStatus = result.source === 'scaffold'
    ? '(scaffold; length not enforced)'
    : result.withinTargetRange
      ? 'within target range'
      : 'OUT OF RANGE';

  const lines = [
    `AuthorOS write: chapter ${result.chapter}`,
    `path: ${result.path}${result.written ? '' : ' (preview, use --write to save)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    `length: target ${result.targetCharCount} chars | actual ${result.actualCharCount} chars — ${rangeStatus}`,
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

async function resolveChapterNumber(projectDir: string, options: WriteOptions): Promise<number> {
  if (options.chapter !== undefined) {
    if (!Number.isInteger(options.chapter) || options.chapter < 1) {
      throw new AuthorOsError('--chapter must be a positive integer.');
    }
    return options.chapter;
  }

  if (options.next === true) {
    return await findNextDraftChapter(projectDir);
  }

  throw new AuthorOsError('author write requires --chapter <N> or --next.');
}

async function findNextDraftChapter(projectDir: string): Promise<number> {
  const planEntries = await readDirSafe(join(projectDir, plansDirectory));
  const chapterEntries = await readDirSafe(join(projectDir, chaptersDirectory));
  const plannedChapters = parseNumberedFiles(planEntries, /^(\d{4})\.md$/);
  const draftedChapters = new Set(parseNumberedFiles(chapterEntries, /^(\d{4})\.md$/));

  for (const chapter of plannedChapters.sort((a, b) => a - b)) {
    if (!draftedChapters.has(chapter)) {
      return chapter;
    }
  }

  throw new AuthorOsError(
    'No chapter plan without a draft was found. Run author plan first or pass --chapter <N>.',
  );
}

async function generateDraftWithModel(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
  length: ChapterLengthSpec,
): Promise<string> {
  const prompt = [
    'WRITE_CHAPTER',
    `chapter: ${chapter}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'task:',
    `Draft chapter ${chapter} as continuous Chinese prose in Markdown.`,
    '',
    'length:',
    `- target_chinese_chars: ${length.target}`,
    `- acceptable_range: ${length.minChars} - ${length.maxChars} (floor ${length.floorPercent}% / ceiling ${length.ceilingPercent}% of target)`,
    '- Pace and structure the chapter to land inside acceptable_range.',
    '- Plan your ending and the chapter-end hook so the chapter finishes inside acceptable_range; never stop mid-sentence.',
    '- If you sense the chapter trending past acceptable_range, compress description before action and dialogue, not the hook.',
    '',
    'constraints:',
    `- Follow the chapter plan in plans/${formatChapterNumber(chapter)}.md exactly: goal, conflict, 爽点, hook, information release, character moves, foreshadowing.`,
    '- Respect canon and the precedence: canon > author profile > product positioning > the chapter plan.',
    '- Match the style rules in memory/style.md.',
    '- Do not add commentary, meta sections, or headings other than chapter section breaks if natural.',
    '- End with a hook (emotion / information / situation), as required by the plan.',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.7, maxTokens: length.maxTokens });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Chapter write model generation failed. ${detail}`);
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Chapter write model returned empty content.');
  }
  return trimmed;
}

function countChineseChars(text: string): number {
  const matches = text.match(/[一-鿿]/g);
  return matches ? matches.length : 0;
}

function renderDraftScaffold(chapter: number): string {
  return [
    '(章节正文待写)',
    '',
    `参考:plans/${formatChapterNumber(chapter)}.md。`,
    '使用 --model 调用 chief-writer agent 产生模型版正文。',
  ].join('\n');
}

function wrapDraftContent(chapter: number, body: string, source: 'model' | 'scaffold', generatedAt: string): string {
  return [
    `# 章节 ${chapter}`,
    '',
    `> generated: ${generatedAt}`,
    '> agent: chief-writer',
    `> source: ${source}`,
    '',
    body.trim(),
    '',
  ].join('\n');
}

function parseNumberedFiles(entries: readonly string[], pattern: RegExp): number[] {
  const chapters: number[] = [];
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (!match) continue;
    chapters.push(Number.parseInt(match[1], 10));
  }
  return chapters;
}

async function readDirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
