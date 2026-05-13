import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

export interface MemoryUpdateOptions {
  chapter: number;
  llm?: LlmClient;
  now?: Date;
  write?: boolean;
}

export interface MemoryUpdateResult {
  chapter: number;
  chapterId: string;
  path: string;
  source: 'model' | 'scaffold';
  generatedAt: string;
  content: string;
  body: string;
  written: boolean;
  contextInputs: string[];
}

export interface PendingMemoryDelta {
  name: string;
  kind: 'console' | 'chapter';
  description: string;
}

const memoryAgent = 'memory-curator';
const memoryDirectory = 'memory';

export async function createMemoryUpdate(projectDir: string, options: MemoryUpdateOptions): Promise<MemoryUpdateResult> {
  const chapter = validateChapter(options.chapter);
  const chapterId = formatChapterNumber(chapter);
  const now = (options.now ?? new Date()).toISOString();

  const docs = await assembleAgentContext(projectDir, memoryAgent, { chapter });
  assertNoRequiredMissing(memoryAgent, docs);

  const profile = await readAgentProfile(projectDir, memoryAgent);
  const body = options.llm
    ? await generateMemoryDeltaWithModel(options.llm, chapter, profile, docs)
    : renderMemoryDeltaScaffold();

  const source: 'model' | 'scaffold' = options.llm ? 'model' : 'scaffold';
  const content = wrapMemoryContent(chapter, body, source, now);
  const path = `${memoryDirectory}/chapter-${chapterId}.delta.md`;

  let written = false;
  if (options.write) {
    await mkdir(join(projectDir, memoryDirectory), { recursive: true });
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
  };
}

export function renderMemoryUpdateResult(result: MemoryUpdateResult): string {
  const lines = [
    `AuthorOS memory update: chapter ${result.chapter}`,
    `path: ${result.path}${result.written ? '' : ' (preview, use --write to save)'}`,
    `source: ${result.source}`,
    `generated: ${result.generatedAt}`,
    'inputs:',
    ...result.contextInputs.map((path) => `  - ${path}`),
    '',
    'Note: this command produces a delta proposal only.',
    'Review the delta, then manually merge changes into memory/{canon.md, foreshadowing.yaml, plot_threads.yaml, character_state.yaml, style.md}.',
    '',
    result.content.trimEnd(),
    '',
  ];
  return lines.join('\n');
}

export async function listMemoryDeltas(projectDir: string): Promise<PendingMemoryDelta[]> {
  const memoryDir = join(projectDir, memoryDirectory);
  const entries = await readMemoryEntries(memoryDir);
  const canon = await readOptional(join(memoryDir, 'canon.md')) ?? '';
  const pending: PendingMemoryDelta[] = [];

  for (const name of entries.sort()) {
    if (/^console-[^/\\]+\.delta\.md$/.test(name)) {
      pending.push({
        name,
        kind: 'console',
        description: 'created from console session, scope: book',
      });
      continue;
    }

    const chapterMatch = name.match(/^chapter-(\d{4})\.delta\.md$/);
    if (chapterMatch && !canon.includes(name)) {
      pending.push({
        name,
        kind: 'chapter',
        description: `chapter ${Number(chapterMatch[1])} memory delta, not yet merged`,
      });
    }
  }

  return pending;
}

export function renderMemoryDeltas(deltas: readonly PendingMemoryDelta[]): string {
  const lines = deltas.length > 0
    ? [
        'Pending memory deltas:',
        ...deltas.map((delta) => `  ${delta.name.padEnd(36)} (${delta.description})`),
      ]
    : [
        'Pending memory deltas:',
        '  (none)',
      ];

  lines.push(
    '',
    'Merge instructions:',
    '  1. Review a delta with `author memory deltas show <name>`',
    '  2. Copy adopted entries into memory/canon.md (变更记录 段)',
    '     or memory/foreshadowing.yaml / plot_threads.yaml / character_state.yaml as appropriate',
    '  3. After integration, you can optionally delete the delta file',
    '',
  );
  return lines.join('\n');
}

export async function showMemoryDelta(projectDir: string, name: string): Promise<string> {
  const safeName = sanitizeDeltaName(name);
  const path = join(projectDir, memoryDirectory, safeName);
  const content = await readOptional(path);
  if (content === null) {
    throw new AuthorOsError(`memory delta not found: ${name}`);
  }
  return content.endsWith('\n') ? content : `${content}\n`;
}

async function generateMemoryDeltaWithModel(
  llm: LlmClient,
  chapter: number,
  profile: string,
  docs: readonly ContextDoc[],
): Promise<string> {
  const prompt = [
    'MEMORY_UPDATE',
    `chapter: ${chapter}`,
    '',
    'agent_profile:',
    profile.trim(),
    '',
    'agent_context:',
    renderContextBlock(docs),
    '',
    'task:',
    'Extract typed memory deltas from this chapter and its decision report.',
    'Output ONLY proposed deltas; do NOT rewrite whole memory files. The user merges manually.',
    'Output Markdown with EXACTLY these sections:',
    '## canon (新增 / 变更)',
    '## foreshadowing (新增 / 推进 / 回收)',
    '## plot_threads (状态推进)',
    '## character_state (变化)',
    '## style (规则增 / 禁)',
    'Under each section, use bullets. If a section has nothing, write "- 无".',
    'For foreshadowing/plot_threads/character_state, prefer key:value style bullets that mirror the existing YAML structure.',
  ].join('\n');

  let reply: string;
  try {
    reply = await llm.generate(prompt, { temperature: 0.3, maxTokens: 4000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthorOsError(`Memory update model generation failed. ${detail}`);
  }
  const trimmed = reply.trim();
  if (!trimmed) {
    throw new AuthorOsError('Memory update model returned empty content.');
  }
  return trimmed;
}

function renderMemoryDeltaScaffold(): string {
  return [
    '## canon (新增 / 变更)',
    '- (待 memory-curator 提取本章新确认的设定)',
    '',
    '## foreshadowing (新增 / 推进 / 回收)',
    '- (待 memory-curator 提取本章伏笔操作)',
    '',
    '## plot_threads (状态推进)',
    '- (待 memory-curator 提取主线状态变化)',
    '',
    '## character_state (变化)',
    '- (待 memory-curator 提取人物状态变化)',
    '',
    '## style (规则增 / 禁)',
    '- (待 memory-curator 提取风格规则增量)',
  ].join('\n');
}

function wrapMemoryContent(chapter: number, body: string, source: 'model' | 'scaffold', now: string): string {
  return [
    `# 章节 ${chapter} 记忆更新建议`,
    '',
    `> generated: ${now}`,
    '> agent: memory-curator',
    `> source: ${source}`,
    '> note: delta proposal only; merge manually into memory/* files',
    '',
    body.trim(),
    '',
  ].join('\n');
}

function validateChapter(chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new AuthorOsError('--chapter must be a positive integer.');
  }
  return chapter;
}

async function readMemoryEntries(memoryDir: string): Promise<string[]> {
  try {
    return await readdir(memoryDir);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function sanitizeDeltaName(name: string): string {
  const cleaned = name.trim().replace(/^["']|["']$/g, '');
  if (!/^((console-[^/\\]+)|(chapter-\d{4}))\.delta\.md$/.test(cleaned)) {
    throw new AuthorOsError(`invalid memory delta name: ${name}`);
  }
  return cleaned;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
