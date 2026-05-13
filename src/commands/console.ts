import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { bookSchema } from '../core/bookSchema.ts';
import { defaultAgentProfileContent, readAgentProfile } from '../core/agentProfiles.ts';
import { resolveAuthorDir } from '../core/authorSchema.ts';
import { listChanges, recordChange, rollback as rollbackChange, type ChangeRecord } from '../core/changes.ts';
import type { LlmClient } from '../core/llm.ts';
import type { EnvLike } from '../core/modelConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export type ConsoleScope = 'book' | 'author' | 'both';

export interface ParsedConsoleOutput {
  raw: string;
  scope: ConsoleScope;
  impact: string;
  diff: string;
  next: string;
}

export interface ConsoleIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export type ConsoleAsk = (prompt: string) => Promise<string>;

export interface RunConsoleOptions {
  instruction?: string;
  llm: LlmClient;
  env?: EnvLike;
  now?: Date;
  scope?: ConsoleScope;
  write?: boolean;
}

export interface ConsoleApplyResult {
  id: string;
  files: string[];
}

export interface ConsoleRunResult {
  parsed: ParsedConsoleOutput;
  dryRun: boolean;
  apply?: ConsoleApplyResult;
}

interface FilePatch {
  file: string;
  hunks: Hunk[];
}

interface Hunk {
  oldStart: number;
  lines: string[];
}

const blockNames = ['scope', 'impact', 'diff', 'next'] as const;
const blockedBookPathPrefixes = ['chapters/', 'reviews/', 'decisions/', 'feedback/'];
const blockedBookFiles = new Set([
  'memory/canon.md',
  'memory/foreshadowing.yaml',
  'memory/plot_threads.yaml',
  'memory/character_state.yaml',
  'memory/style.md',
]);

export function parseConsoleOutput(raw: string): ParsedConsoleOutput {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const markerRegex = /^\s*\[(scope|impact|diff|next)\]\s*(.*)$/gim;
  const markers: Array<{ name: typeof blockNames[number]; index: number; end: number; inline: string }> = [];

  for (const match of normalized.matchAll(markerRegex)) {
    const name = match[1]!.toLowerCase() as typeof blockNames[number];
    if (markers.some((marker) => marker.name === name)) {
      throw consoleStructureError(`duplicate [${name}] block`);
    }
    markers.push({
      name,
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      inline: match[2] ?? '',
    });
  }

  for (const required of blockNames) {
    if (!markers.some((marker) => marker.name === required)) {
      throw consoleStructureError(`missing [${required}] block`);
    }
  }
  for (let index = 0; index < blockNames.length; index += 1) {
    if (markers[index]?.name !== blockNames[index]) {
      throw consoleStructureError(`expected [${blockNames[index]}] before [${markers[index]?.name ?? 'end'}]`);
    }
  }

  const byName = new Map<typeof blockNames[number], string>();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const next = markers[index + 1];
    const bodyStart = marker.end;
    const bodyEnd = next?.index ?? normalized.length;
    const inline = marker.inline.trim();
    const body = normalized.slice(bodyStart, bodyEnd).trim();
    byName.set(marker.name, [inline, body].filter(Boolean).join('\n').trim());
  }

  const scope = byName.get('scope') ?? '';
  if (scope !== 'book' && scope !== 'author' && scope !== 'both') {
    throw consoleStructureError(`invalid [scope] value: ${scope || '(empty)'}`);
  }

  return {
    raw,
    scope,
    impact: nonEmptyBlock(byName, 'impact'),
    diff: nonEmptyBlock(byName, 'diff'),
    next: nonEmptyBlock(byName, 'next'),
  };
}

export async function runConsoleOneShot(projectDir: string, options: RunConsoleOptions): Promise<ConsoleRunResult> {
  const instruction = normalizedInstruction(options.instruction);
  if (!instruction) {
    throw new AuthorOsError('author console one-shot requires an instruction.');
  }

  const parsed = await invokeConsoleAgent(projectDir, instruction, options);
  if (!options.write) {
    return { parsed, dryRun: true };
  }

  return {
    parsed,
    dryRun: false,
    apply: await applyConsoleOutput(projectDir, parsed, {
      userPrompt: instruction,
      env: options.env,
      now: options.now,
    }),
  };
}

export async function runConsoleRepl(
  projectDir: string,
  options: Omit<RunConsoleOptions, 'instruction' | 'write'> & { ask: ConsoleAsk; io: ConsoleIo },
): Promise<void> {
  options.io.stdout(await renderConsoleBanner(projectDir));
  while (true) {
    const input = (await options.ask('console> ')).trim();
    if (!input || input === 'exit' || input === 'quit') return;

    let parsed = await invokeConsoleAgent(projectDir, input, options);
    options.io.stdout(renderConsoleDryRun({ parsed, dryRun: true }));

    while (true) {
      const action = (await options.ask('apply / edit / abort / drill <file> > ')).trim();
      if (!action) continue;
      if (action === 'abort') {
        options.io.stdout('aborted\n');
        break;
      }
      if (action === 'apply') {
        const applied = await applyConsoleOutput(projectDir, parsed, {
          userPrompt: input,
          env: options.env,
          now: options.now,
        });
        options.io.stdout(`applied: ${applied.id}\nfiles: ${applied.files.join(', ')}\n\n[next]\n${parsed.next}\n`);
        break;
      }
      if (action === 'edit') {
        parsed = await editParsedDiff(parsed, options.env, options.io);
        continue;
      }
      if (action.startsWith('drill ')) {
        const file = action.slice('drill '.length).trim();
        options.io.stdout(await renderDrillPreview(projectDir, parsed, file, options.env));
        continue;
      }
      options.io.stdout('unknown action. Use apply, edit, abort, or drill <file>.\n');
    }
  }
}

export function renderConsoleDryRun(result: ConsoleRunResult): string {
  const lines = [
    `[scope] ${result.parsed.scope}`,
    '[impact]',
    result.parsed.impact,
    '[diff]',
    result.parsed.diff,
    '[next]',
    result.parsed.next,
  ];
  if (result.dryRun) {
    lines.push('', '(dry-run; use --write to apply)');
  } else if (result.apply) {
    lines.push('', `applied: ${result.apply.id}`, `files: ${result.apply.files.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function invokeConsoleAgent(
  projectDir: string,
  instruction: string,
  options: Pick<RunConsoleOptions, 'llm' | 'env' | 'scope'>,
): Promise<ParsedConsoleOutput> {
  let reply: string;
  try {
    reply = await options.llm.generate(await buildConsolePrompt(projectDir, instruction, options), {
      temperature: 0.2,
      maxTokens: 2400,
    });
  } catch (error) {
    throw new AuthorOsError(`[agent: author-console] ${errorMessage(error)}`);
  }

  let parsed: ParsedConsoleOutput;
  try {
    parsed = parseConsoleOutput(reply);
  } catch (error) {
    if (error instanceof AuthorOsError) {
      throw new AuthorOsError(`${error.message}\n\nraw agent output:\n${reply}`);
    }
    throw error;
  }
  if (options.scope && parsed.scope !== options.scope) {
    throw new AuthorOsError(`console scope mismatch: requested ${options.scope}, agent returned ${parsed.scope}.`);
  }
  return parsed;
}

async function buildConsolePrompt(
  projectDir: string,
  instruction: string,
  options: Pick<RunConsoleOptions, 'env' | 'scope'>,
): Promise<string> {
  const profile = await readConsoleProfile(projectDir);
  const context = await renderConsoleContext(projectDir);
  const scopeLock = options.scope ? `Locked scope: ${options.scope}. Do not return another scope.` : 'Scope is unlocked. Choose book, author, or both.';

  return [
    'AUTHOR_CONSOLE',
    '',
    profile,
    '',
    'hard schema boundary:',
    '- bookSchema.ts and authorSchema.ts are the source of truth. Do not remove required fields.',
    '- Never directly edit chapters/, reviews/, decisions/, or feedback/. For chapter prose, put an author revise --instruction command in [next].',
    '- Never directly edit memory/canon.md or memory/*.yaml. If memory changes are needed, create a console delta file in the diff.',
    '',
    scopeLock,
    '',
    'current context:',
    context,
    '',
    'author instruction:',
    instruction,
    '',
    'Output MUST be exactly this structure (no commentary outside these blocks):',
    '',
    '[scope] book | author | both',
    '[impact]',
    '  <severity>: <file> - <reason>',
    '  <severity>: <file> - <reason>',
    '[diff]',
    '--- <file>',
    '@@ ...',
    '<unified diff>',
    '',
    '--- <file>',
    '@@ ...',
    '<unified diff>',
    '[next]',
    '  <command 1>',
    '  <command 2>',
  ].join('\n');
}

async function readConsoleProfile(projectDir: string): Promise<string> {
  try {
    return await readAgentProfile(projectDir, 'author-console');
  } catch {
    return defaultAgentProfileContent('author-console');
  }
}

async function renderConsoleContext(projectDir: string): Promise<string> {
  const files = [
    ...bookSchema.identityFiles.map((entry) => entry.file),
    ...bookSchema.memoryFiles.map((entry) => entry.file),
    '.authoros/strategy.json',
  ];
  const sections: string[] = [];
  for (const file of files) {
    const content = await readOptional(join(projectDir, file));
    if (content !== null) {
      sections.push(`--- ${file}\n${truncate(content, 2500)}`);
    }
  }
  sections.push(await renderChapterSummary(projectDir));
  return sections.filter(Boolean).join('\n\n');
}

async function renderChapterSummary(projectDir: string): Promise<string> {
  let entries: string[];
  try {
    entries = (await readdir(join(projectDir, 'chapters')))
      .filter((file) => /^\d{4}\.md$/.test(file))
      .sort();
  } catch {
    return 'chapters: none';
  }
  if (entries.length === 0) return 'chapters: none';
  const latest = entries[entries.length - 1]!;
  const latestBody = await readOptional(join(projectDir, 'chapters', latest)) ?? '';
  return [
    `chapters_written: ${entries.length}`,
    `latest_chapter: ${latest}`,
    `latest_chapter_excerpt: ${excerptEdges(latestBody, 200)}`,
  ].join('\n');
}

export async function applyConsoleOutput(
  projectDir: string,
  parsed: ParsedConsoleOutput,
  options: { userPrompt: string; env?: EnvLike; now?: Date },
): Promise<ConsoleApplyResult> {
  const patches = parseUnifiedDiff(parsed.diff);
  const baseDir = baseDirForScope(projectDir, parsed.scope, options.env);
  const fileChanges: Array<{ file: string; before: string | null; after: string }> = [];

  for (const patch of patches) {
    assertConsoleFileAllowed(parsed.scope, patch.file);
    const absPath = join(baseDir, patch.file);
    const before = await readOptional(absPath);
    const after = applyPatchToText(before ?? '', patch);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, after, 'utf8');
    fileChanges.push({ file: patch.file, before, after });
  }

  return await recordChange({
    baseDir,
    scope: parsed.scope,
    agent: 'author-console',
    userPrompt: options.userPrompt,
    agentOutput: parsed.raw,
    fileChanges,
    now: options.now,
  });
}

export async function getConsoleChanges(
  projectDir: string,
  options: { scope?: ConsoleScope; env?: EnvLike } = {},
): Promise<ChangeRecord[]> {
  return await listChanges(baseDirForScope(projectDir, options.scope ?? 'book', options.env));
}

export async function rollbackConsoleChange(
  projectDir: string,
  changeId: string,
  options: { scope?: ConsoleScope; env?: EnvLike; now?: Date } = {},
): Promise<ChangeRecord> {
  return await rollbackChange(baseDirForScope(projectDir, options.scope ?? 'book', options.env), changeId, {
    now: options.now,
  });
}

export function renderConsoleLog(changes: ChangeRecord[]): string {
  if (changes.length === 0) return 'Changes: none\n';
  return [
    'Changes:',
    ...changes.map((change) => [
      `${change.id}  ${change.timestamp}  ${change.scope}  ${change.agent}`,
      `  files: ${change.files.join(', ') || '(none)'}`,
      `  prompt: ${change.userPrompt}`,
      ...(change.rollbackOf ? [`  rollback_of: ${change.rollbackOf}`] : []),
    ].join('\n')),
    '',
  ].join('\n');
}

export function renderConsoleRollback(record: ChangeRecord): string {
  return [
    `rollback: ${record.id}`,
    `rollback_of: ${record.rollbackOf ?? '(unknown)'}`,
    `files: ${record.files.join(', ')}`,
    '',
  ].join('\n');
}

async function renderDrillPreview(
  projectDir: string,
  parsed: ParsedConsoleOutput,
  requestedFile: string,
  env: EnvLike | undefined,
): Promise<string> {
  const file = sanitizeRelativeFile(requestedFile);
  const patch = parseUnifiedDiff(parsed.diff).find((entry) => entry.file === file);
  if (!patch) {
    throw new AuthorOsError(`drill target is not present in [diff]: ${file}`);
  }
  const baseDir = baseDirForScope(projectDir, parsed.scope, env);
  const before = await readOptional(join(baseDir, file)) ?? '';
  const after = applyPatchToText(before, patch);
  return `Preview: ${file}\n${after}\n`;
}

async function editParsedDiff(parsed: ParsedConsoleOutput, env: EnvLike | undefined, io: ConsoleIo): Promise<ParsedConsoleOutput> {
  const tempDir = await mkdtemp(join(tmpdir(), 'authoros-console-edit-'));
  const tempFile = join(tempDir, 'diff.patch');
  await writeFile(tempFile, parsed.diff, 'utf8');
  io.stdout(`edit file: ${tempFile}\n`);

  const editor = env && Object.hasOwn(env, 'EDITOR')
    ? env.EDITOR?.trim()
    : process.env.EDITOR?.trim();
  if (!editor) {
    io.stdout('EDITOR is not set; diff left unchanged.\n');
    return parsed;
  }

  const result = spawnSync(editor, [tempFile], { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new AuthorOsError(`editor exited with status ${result.status ?? 'unknown'}.`);
  }

  return { ...parsed, diff: await readFile(tempFile, 'utf8') };
}

function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.replace(/\r\n?/g, '\n').split('\n');
  const patches: FilePatch[] = [];
  let current: FilePatch | null = null;
  let currentHunk: Hunk | null = null;

  for (const line of lines) {
    const fileMatch = line.match(/^---\s+(.+?)\s*$/);
    if (fileMatch) {
      current = { file: sanitizeRelativeFile(fileMatch[1]!), hunks: [] };
      patches.push(current);
      currentHunk = null;
      continue;
    }

    if (!current || line.startsWith('+++ ')) continue;

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentHunk = { oldStart: Number(hunkMatch[1]), lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk && (/^[ +\-\\]/.test(line) || line === '')) {
      currentHunk.lines.push(line);
    }
  }

  if (patches.length === 0) {
    throw new AuthorOsError('console diff is empty; expected at least one --- <file> section.');
  }
  for (const patch of patches) {
    if (patch.hunks.length === 0) {
      throw new AuthorOsError(`console diff for ${patch.file} has no hunks.`);
    }
  }
  return patches;
}

function applyPatchToText(input: string, patch: FilePatch): string {
  try {
    return applyPatchToTextStrict(input, patch);
  } catch (error) {
    const fuzzy = fuzzyApplyPatchToText(input, patch);
    if (fuzzy !== null) return fuzzy;
    throw error;
  }
}

function applyPatchToTextStrict(input: string, patch: FilePatch): string {
  const original = splitTextLines(input);
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of patch.hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    while (cursor < hunkStart) {
      output.push(original[cursor++] ?? '');
    }

    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue;
      const text = line.slice(1);
      if (line.startsWith(' ')) {
        assertOriginalLine(patch.file, original[cursor], text);
        output.push(original[cursor] ?? text);
        cursor += 1;
      } else if (line.startsWith('-')) {
        assertOriginalLine(patch.file, original[cursor], text);
        cursor += 1;
      } else if (line.startsWith('+')) {
        output.push(text);
      }
    }
  }

  while (cursor < original.length) {
    output.push(original[cursor++] ?? '');
  }
  return `${output.join('\n')}\n`;
}

function fuzzyApplyPatchToText(input: string, patch: FilePatch): string | null {
  const output = splitTextLines(input);
  let offset = 0;
  for (const hunk of patch.hunks) {
    const removeLines = hunk.lines
      .filter((line) => line.startsWith('-'))
      .map((line) => line.slice(1));
    const addLines = hunk.lines
      .filter((line) => line.startsWith('+'))
      .map((line) => line.slice(1));
    if (removeLines.length === 0) return null;

    const targetIndex = Math.max(0, hunk.oldStart - 1 + offset);
    const index = findNearestLineBlock(output, removeLines, targetIndex, 5);
    if (index === null) return null;
    output.splice(index, removeLines.length, ...addLines);
    offset += addLines.length - removeLines.length;
  }
  return `${output.join('\n')}\n`;
}

function findNearestLineBlock(lines: string[], expected: string[], targetIndex: number, windowSize: number): number | null {
  const matches: Array<{ index: number; distance: number }> = [];
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (expected.every((line, offset) => sameLineIgnoringTrailingWhitespace(lines[index + offset], line))) {
      const distance = Math.abs(index - targetIndex);
      if (distance <= windowSize) {
        matches.push({ index, distance });
      }
    }
  }
  matches.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return matches[0]?.index ?? null;
}

function splitTextLines(input: string): string[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) return [];
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function assertOriginalLine(file: string, actual: string | undefined, expected: string): void {
  if (!sameLineIgnoringTrailingWhitespace(actual, expected)) {
    throw new AuthorOsError(
      `console diff does not apply cleanly to ${file}. Expected "${expected}", got "${actual ?? '(end of file)'}".`,
    );
  }
}

function sameLineIgnoringTrailingWhitespace(actual: string | undefined, expected: string): boolean {
  return actual?.trimEnd() === expected.trimEnd();
}

function sanitizeRelativeFile(input: string): string {
  const cleaned = input.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!cleaned || isAbsolute(cleaned) || cleaned.split('/').includes('..')) {
    throw new AuthorOsError(`invalid console diff file path: ${input}`);
  }
  return normalize(cleaned).split(sep).join('/');
}

function assertConsoleFileAllowed(scope: ConsoleScope, file: string): void {
  if (scope === 'author') return;
  if (blockedBookPathPrefixes.some((prefix) => file.startsWith(prefix)) || blockedBookFiles.has(file)) {
    throw new AuthorOsError(
      `author-console cannot directly edit ${file}. Put a safe follow-up command in [next] instead.`,
    );
  }
}

function baseDirForScope(projectDir: string, scope: ConsoleScope, env: EnvLike | undefined): string {
  if (scope === 'author') return resolveAuthorDir(undefined, env);
  return projectDir;
}

async function renderConsoleBanner(projectDir: string): Promise<string> {
  const config = await readOptional(join(projectDir, '.authoros/config.yaml')) ?? '';
  const projectName = config.match(/project_name:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? basename(projectDir);
  const chapters = await listChapterFiles(projectDir);
  const latest = chapters[chapters.length - 1] ?? 'none';
  return [
    'Author Console',
    `book: ${projectName}`,
    `chapters_written: ${chapters.length}`,
    `latest_chapter: ${latest}`,
    '',
  ].join('\n');
}

async function listChapterFiles(projectDir: string): Promise<string[]> {
  try {
    return (await readdir(join(projectDir, 'chapters')))
      .filter((file) => /^\d{4}\.md$/.test(file))
      .sort();
  } catch {
    return [];
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function nonEmptyBlock(blocks: Map<typeof blockNames[number], string>, name: typeof blockNames[number]): string {
  const value = blocks.get(name)?.trim() ?? '';
  if (!value) {
    throw consoleStructureError(`empty [${name}] block`);
  }
  return value;
}

function consoleStructureError(detail: string): AuthorOsError {
  return new AuthorOsError(`console output structure invalid (${detail}). Re-run with rephrased instruction.`);
}

function normalizedInstruction(instruction: string | undefined): string {
  return instruction?.trim() ?? '';
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...<truncated>` : value;
}

function excerptEdges(value: string, size: number): string {
  const normalized = value.trim();
  if (normalized.length <= size * 2) return normalized;
  return `${normalized.slice(0, size)}\n...\n${normalized.slice(-size)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
