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

export interface MarkMemoryDeltaReviewedOptions {
  now?: Date;
}

export interface MarkMemoryDeltaReviewedResult {
  name: string;
  path: string;
  marker: string;
  markedAt: string;
  alreadyReviewed: boolean;
}

export type MemoryDeltaSectionKey = 'canon' | 'foreshadowing' | 'plot_threads' | 'character_state' | 'style';

export interface MergeMemoryDeltaOptions {
  now?: Date;
}

export interface MergeMemoryDeltaResult {
  name: string;
  marker: string;
  mergedAt: string;
  alreadyMerged: boolean;
  changedFiles: string[];
  appliedSections: Record<MemoryDeltaSectionKey, string[]>;
}

export interface MemoryDeltaMergeTarget {
  path: string;
  section: MemoryDeltaSectionKey;
  items: string[];
}

export interface PreviewMemoryDeltaMergeResult {
  name: string;
  alreadyMerged: boolean;
  changedFiles: string[];
  appliedSections: Record<MemoryDeltaSectionKey, string[]>;
  targetFiles: MemoryDeltaMergeTarget[];
}

const memoryAgent = 'memory-curator';
const memoryDirectory = 'memory';
const reviewedMemoryDeltaHeading = '## 已审阅记忆增量';

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
      if (canon.includes(name)) continue;
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
    '  2. Semi-merge it with `author memory deltas merge <name>`',
    '     or manually copy adopted entries into memory/* files as appropriate',
    '  3. After integration, you can optionally keep or delete the delta file',
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

export async function markMemoryDeltaReviewed(
  projectDir: string,
  name: string,
  options: MarkMemoryDeltaReviewedOptions = {},
): Promise<MarkMemoryDeltaReviewedResult> {
  const safeName = sanitizeDeltaName(name);
  const deltaPath = join(projectDir, memoryDirectory, safeName);
  const deltaContent = await readOptional(deltaPath);
  if (deltaContent === null) {
    throw new AuthorOsError(`memory delta not found: ${name}`);
  }

  const canonPath = join(projectDir, memoryDirectory, 'canon.md');
  const canon = await readOptional(canonPath) ?? '# 正史设定\n';
  const markedAt = (options.now ?? new Date()).toISOString();
  const marker = `- reviewed: ${safeName} at ${markedAt}`;
  if (canon.includes(safeName)) {
    return {
      name: safeName,
      path: 'memory/canon.md',
      marker,
      markedAt,
      alreadyReviewed: true,
    };
  }

  await mkdir(join(projectDir, memoryDirectory), { recursive: true });
  await writeFile(canonPath, appendReviewedMemoryDeltaToCanon(canon, safeName, deltaContent, markedAt), 'utf8');

  return {
    name: safeName,
    path: 'memory/canon.md',
    marker,
    markedAt,
    alreadyReviewed: false,
  };
}

export async function mergeMemoryDelta(
  projectDir: string,
  name: string,
  options: MergeMemoryDeltaOptions = {},
): Promise<MergeMemoryDeltaResult> {
  const safeName = sanitizeDeltaName(name);
  const memoryDir = join(projectDir, memoryDirectory);
  const deltaPath = join(memoryDir, safeName);
  const deltaContent = await readOptional(deltaPath);
  if (deltaContent === null) {
    throw new AuthorOsError(`memory delta not found: ${name}`);
  }

  const mergedAt = (options.now ?? new Date()).toISOString();
  const marker = `- merged: ${safeName} at ${mergedAt}`;
  const canonPath = join(memoryDir, 'canon.md');
  const canon = await readOptional(canonPath) ?? '# 正史设定\n\n## 变更记录\n';
  const preview = buildMemoryDeltaMergePreview(safeName, deltaContent, canon);
  if (preview.alreadyMerged) {
    return {
      name: safeName,
      marker,
      mergedAt,
      alreadyMerged: true,
      changedFiles: [],
      appliedSections: preview.appliedSections,
    };
  }

  await mkdir(memoryDir, { recursive: true });
  const changedFiles: string[] = [];
  let nextCanon = canon;
  if (preview.appliedSections.canon.length > 0) {
    nextCanon = appendToMarkdownHeading(
      nextCanon,
      '## 已确认设定',
      preview.appliedSections.canon.map((item) => `- ${item}`),
    );
  }
  nextCanon = appendToMarkdownHeading(nextCanon, '## 变更记录', [marker]);
  nextCanon = appendReviewedMemoryDeltaToCanon(nextCanon, safeName, deltaContent, mergedAt);
  await writeFile(canonPath, nextCanon, 'utf8');
  changedFiles.push('memory/canon.md');

  await appendYamlMemoryDeltaSection(memoryDir, 'foreshadowing.yaml', 'foreshadowing', preview.appliedSections.foreshadowing, safeName, mergedAt, changedFiles);
  await appendYamlMemoryDeltaSection(memoryDir, 'plot_threads.yaml', 'plot_threads', preview.appliedSections.plot_threads, safeName, mergedAt, changedFiles);
  await appendYamlMemoryDeltaSection(memoryDir, 'character_state.yaml', 'character_state', preview.appliedSections.character_state, safeName, mergedAt, changedFiles);

  if (preview.appliedSections.style.length > 0) {
    const stylePath = join(memoryDir, 'style.md');
    const style = await readOptional(stylePath) ?? '# 风格规则\n\n## 变更记录\n';
    const nextStyle = appendToMarkdownHeading(style, '## 变更记录', [
      marker,
      ...preview.appliedSections.style.map((item) => `  - ${item}`),
    ]);
    await writeFile(stylePath, nextStyle, 'utf8');
    changedFiles.push('memory/style.md');
  }

  return {
    name: safeName,
    marker,
    mergedAt,
    alreadyMerged: false,
    changedFiles,
    appliedSections: preview.appliedSections,
  };
}

export async function previewMemoryDeltaMerge(projectDir: string, name: string): Promise<PreviewMemoryDeltaMergeResult> {
  const safeName = sanitizeDeltaName(name);
  const memoryDir = join(projectDir, memoryDirectory);
  const deltaPath = join(memoryDir, safeName);
  const deltaContent = await readOptional(deltaPath);
  if (deltaContent === null) {
    throw new AuthorOsError(`memory delta not found: ${name}`);
  }

  const canon = await readOptional(join(memoryDir, 'canon.md')) ?? '# 正史设定\n\n## 变更记录\n';
  return buildMemoryDeltaMergePreview(safeName, deltaContent, canon);
}

export function renderMergeMemoryDeltaResult(result: MergeMemoryDeltaResult): string {
  const lines = [
    result.alreadyMerged
      ? `Memory delta already merged: ${result.name}`
      : `Merged memory delta: ${result.name}`,
    `merged_at: ${result.mergedAt}`,
    'changed_files:',
    ...(result.changedFiles.length > 0 ? result.changedFiles.map((file) => `  - ${file}`) : ['  - (none)']),
    'applied_sections:',
    ...memoryDeltaSectionKeys().map((key) => `  - ${key}: ${result.appliedSections[key].length}`),
    '',
  ];
  return lines.join('\n');
}

function buildMemoryDeltaMergePreview(safeName: string, deltaContent: string, canon: string): PreviewMemoryDeltaMergeResult {
  const appliedSections = parseMemoryDeltaSections(deltaContent);
  const alreadyMerged = canon.includes(`- merged: ${safeName} at`);
  const targetFiles = memoryDeltaMergeTargets(appliedSections);
  return {
    name: safeName,
    alreadyMerged,
    changedFiles: alreadyMerged ? [] : changedFilesForMergePlan(appliedSections),
    appliedSections,
    targetFiles,
  };
}

function memoryDeltaMergeTargets(sections: Record<MemoryDeltaSectionKey, string[]>): MemoryDeltaMergeTarget[] {
  return memoryDeltaSectionKeys()
    .filter((section) => sections[section].length > 0)
    .map((section) => ({
      path: memoryPathForSection(section),
      section,
      items: [...sections[section]],
    }));
}

function changedFilesForMergePlan(sections: Record<MemoryDeltaSectionKey, string[]>): string[] {
  const files = ['memory/canon.md'];
  if (sections.foreshadowing.length > 0) files.push('memory/foreshadowing.yaml');
  if (sections.plot_threads.length > 0) files.push('memory/plot_threads.yaml');
  if (sections.character_state.length > 0) files.push('memory/character_state.yaml');
  if (sections.style.length > 0) files.push('memory/style.md');
  return files;
}

function memoryPathForSection(section: MemoryDeltaSectionKey): string {
  if (section === 'foreshadowing') return 'memory/foreshadowing.yaml';
  if (section === 'plot_threads') return 'memory/plot_threads.yaml';
  if (section === 'character_state') return 'memory/character_state.yaml';
  if (section === 'style') return 'memory/style.md';
  return 'memory/canon.md';
}

function appendReviewedMemoryDeltaToCanon(canon: string, safeName: string, deltaContent: string, markedAt: string): string {
  const base = canon.endsWith('\n') ? canon : `${canon}\n`;
  if (base.includes(`### ${safeName}`)) {
    return base;
  }
  let nextCanon = base;
  if (!nextCanon.includes(reviewedMemoryDeltaHeading)) {
    nextCanon = `${nextCanon}${nextCanon.endsWith('\n\n') ? '' : '\n'}${reviewedMemoryDeltaHeading}\n\n`;
  } else if (!nextCanon.endsWith('\n\n')) {
    nextCanon = `${nextCanon}\n`;
  }
  return `${nextCanon}${renderReviewedMemoryDelta(safeName, deltaContent, markedAt)}`;
}

function renderReviewedMemoryDelta(safeName: string, deltaContent: string, markedAt: string): string {
  const trimmed = deltaContent.trimEnd();
  const fence = markdownFenceFor(trimmed);
  return [
    `### ${safeName}`,
    '',
    `- reviewed: ${safeName} at ${markedAt}`,
    '',
    `${fence}markdown`,
    trimmed,
    fence,
    '',
  ].join('\n');
}

function markdownFenceFor(content: string): string {
  const backtickRuns = content.match(/`{3,}/g) ?? [];
  const longestRun = backtickRuns.reduce((longest, run) => Math.max(longest, run.length), 0);
  return '`'.repeat(Math.max(3, longestRun + 1));
}

function parseMemoryDeltaSections(content: string): Record<MemoryDeltaSectionKey, string[]> {
  const sections = emptyMemoryDeltaSections();
  let current: MemoryDeltaSectionKey | null = null;

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      current = sectionKeyForHeading(heading[1]);
      continue;
    }

    if (!current) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!bullet?.[1]) continue;
    const item = bullet[1].trim();
    if (isActionableMemoryDeltaItem(item)) {
      sections[current].push(item);
    }
  }

  return sections;
}

function emptyMemoryDeltaSections(): Record<MemoryDeltaSectionKey, string[]> {
  return {
    canon: [],
    foreshadowing: [],
    plot_threads: [],
    character_state: [],
    style: [],
  };
}

function memoryDeltaSectionKeys(): MemoryDeltaSectionKey[] {
  return ['canon', 'foreshadowing', 'plot_threads', 'character_state', 'style'];
}

function sectionKeyForHeading(heading: string): MemoryDeltaSectionKey | null {
  const normalized = heading.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.startsWith('canon')) return 'canon';
  if (normalized.startsWith('foreshadowing')) return 'foreshadowing';
  if (normalized.startsWith('plot_threads')) return 'plot_threads';
  if (normalized.startsWith('character_state')) return 'character_state';
  if (normalized.startsWith('style')) return 'style';
  return null;
}

function isActionableMemoryDeltaItem(item: string): boolean {
  const compact = item.replace(/\s+/g, '');
  if (!compact || compact === '无' || compact === '(无)') return false;
  if (compact.includes('待memory-curator')) return false;
  return true;
}

function appendToMarkdownHeading(content: string, heading: string, linesToAppend: string[]): string {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  const lines = normalized.trimEnd().split('\n');
  let headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    lines.push('', heading);
    headingIndex = lines.length - 1;
  }

  let insertIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index] ?? '')) {
      insertIndex = index;
      break;
    }
  }

  const before = lines.slice(0, insertIndex);
  const after = lines.slice(insertIndex);
  while (before.length > 0 && before[before.length - 1] === '') before.pop();
  const nextLines = [
    ...before,
    '',
    ...linesToAppend,
    ...(after.length > 0 ? ['', ...after] : []),
  ];
  return `${nextLines.join('\n').trimEnd()}\n`;
}

async function appendYamlMemoryDeltaSection(
  memoryDir: string,
  file: string,
  section: MemoryDeltaSectionKey,
  items: readonly string[],
  safeName: string,
  mergedAt: string,
  changedFiles: string[],
): Promise<void> {
  if (items.length === 0) return;
  const path = join(memoryDir, file);
  const existing = await readOptional(path) ?? defaultYamlMemoryContent(file);
  await writeFile(path, appendYamlCommentBlock(existing, section, items, safeName, mergedAt), 'utf8');
  changedFiles.push(`memory/${file}`);
}

function defaultYamlMemoryContent(file: string): string {
  if (file === 'foreshadowing.yaml') return 'hooks: []\n';
  if (file === 'plot_threads.yaml') return 'threads: []\n';
  if (file === 'character_state.yaml') return 'protagonist: {}\n';
  return '';
}

function appendYamlCommentBlock(
  content: string,
  section: MemoryDeltaSectionKey,
  items: readonly string[],
  safeName: string,
  mergedAt: string,
): string {
  const base = content.trimEnd();
  const block = [
    `# merged: ${safeName} at ${mergedAt}`,
    `# section: ${section}`,
    ...items.map((item) => `# - ${yamlCommentText(item)}`),
  ].join('\n');
  return `${base}${base ? '\n\n' : ''}${block}\n`;
}

function yamlCommentText(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
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
