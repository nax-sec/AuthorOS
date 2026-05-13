import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { bookSchema } from '../core/bookSchema.ts';
import { defaultAgentProfileContent, readAgentProfile } from '../core/agentProfiles.ts';
import { resolveAuthorDir } from '../core/authorSchema.ts';
import { listChanges, recordChange, rollback as rollbackChange, type ChangeRecord } from '../core/changes.ts';
import { applyEditOps, parseEditsBlock, previewEditOpsForFile, renderEditsYaml } from '../core/editOps.ts';
import type { LlmClient } from '../core/llm.ts';
import type { EnvLike } from '../core/modelConfig.ts';
import { AuthorOsError } from '../core/schema.ts';

export type ConsoleScope = 'book' | 'author' | 'both';

export interface ParsedConsoleOutput {
  raw: string;
  scope: ConsoleScope;
  impact: string;
  edits: string;
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
  noops?: string[];
}

export interface ConsoleRunResult {
  parsed: ParsedConsoleOutput;
  dryRun: boolean;
  apply?: ConsoleApplyResult;
}

const blockNames = ['scope', 'impact', 'edits', 'next'] as const;

export function parseConsoleOutput(raw: string): ParsedConsoleOutput {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const markerRegex = /^[ \t]*\[(scope|impact|edits|next)\][ \t]*(.*)$/gim;
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
    edits: nonEmptyBlock(byName, 'edits'),
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
        const noops = applied.noops && applied.noops.length > 0 ? `${applied.noops.join('\n')}\n` : '';
        options.io.stdout(`applied: ${applied.id}\nfiles: ${applied.files.join(', ')}\n${noops}\n[next]\n${parsed.next}\n`);
        break;
      }
      if (action === 'edit') {
        parsed = await editParsedEdits(parsed, options.env, options.io);
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
    '[edits]',
    result.parsed.edits,
    '[next]',
    result.parsed.next,
  ];
  if (result.dryRun) {
    lines.push('', '(dry-run; use --write to apply)');
  } else if (result.apply) {
    lines.push('', `applied: ${result.apply.id}`, `files: ${result.apply.files.join(', ')}`);
    if (result.apply.noops && result.apply.noops.length > 0) {
      lines.push(...result.apply.noops);
    }
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
      maxTokens: 5000,
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
    '- Never directly edit memory/canon.md or memory/*.yaml. If memory changes are needed, create a console delta file in [edits].',
    '',
    scopeLock,
    'Scope selection rules:',
    '- Use scope `book` when editing book files: product.md, author.md, world.md, outline.md, characters.yaml, review_rules.md, memory/console-*.delta.md, or .authoros/overrides/*.yaml.',
    '- Use scope `author` only for author-level files outside the book directory: author.md/style.md/preferences/agents/templates.',
    '- If the user names a book file such as review_rules.md, outline.md, or memory/console-*.delta.md, return [scope] book.',
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
    '[edits]',
    '# append a section after an existing heading',
    '- file: review_rules.md',
    '  op: append-after-heading',
    '  anchor: "## 必查项"',
    '  content: |',
    '    - **new check item**',
    '',
    '# rename a string across the whole file',
    '- file: outline.md',
    '  op: rename-text',
    '  from: "OldName"',
    '  to: "NewName"',
    '',
    '# replace a unique text block with new wording',
    '- file: world.md',
    '  op: replace-text',
    '  find: |',
    '    <exact old text, must be unique>',
    '  replace: |',
    '    <new text>',
    '',
    '# replace a whole section with new content',
    '- file: product.md',
    '  op: replace-section',
    '  anchor: "## 禁区"',
    '  content: |',
    '    <new content>',
    '',
    '# prepend before a heading (rarely used)',
    '- file: outline.md',
    '  op: prepend-before-heading',
    '  anchor: "## 主线阶段"',
    '  content: |',
    '    <inserted before that heading>',
    '',
    '# set a yaml scalar field',
    '- file: characters.yaml',
    '  op: set-yaml-key',
    '  key: "protagonist.desire"',
    '  value: "find the truth"',
    '',
    '# append item to yaml array',
    '- file: memory/foreshadowing.yaml',
    '  op: append-yaml-array-item',
    '  key: "hooks"',
    '  item:',
    '    id: H003',
    '    title: "新伏笔"',
    '    status: open',
    '',
    '# delete yaml array item by predicate',
    '- file: memory/foreshadowing.yaml',
    '  op: delete-yaml-array-item',
    '  key: "hooks"',
    '  predicate:',
    '    id: H001',
    '',
    '# create a new console delta file',
    '- file: memory/console-*.delta.md',
    '  op: create-file',
    '  content: |',
    '    # Console Delta - <summary>',
    '    <body>',
    '',
    '# append to an existing file (delta files only)',
    '- file: memory/console-*.delta.md',
    '  op: append-to-file',
    '  content: |',
    '    <appended content>',
    '',
    'Supported ops: append-after-heading, prepend-before-heading, replace-section, replace-text, rename-text, append-to-file, create-file, set-yaml-key, append-yaml-array-item, delete-yaml-array-item.',
    'Use anchors/headings or exact text; do not emit unified diffs.',
    '',
    'Op selection rules (CRITICAL - follow this decision tree before choosing op):',
    '',
    '- Adding a new section/bullet/item under an existing heading',
    '  -> use `append-after-heading` with the heading as anchor.',
    '  -> DO NOT use `replace-text` to copy the last line and append after it.',
    '',
    '- Renaming a string (character name, place name, term) across a file',
    '  -> use ONE `rename-text` op per file. It replaces all occurrences.',
    '  -> DO NOT emit multiple `replace-text` ops for the same rename.',
    '',
    '- Replacing a specific paragraph or sentence with new wording',
    '  -> use `replace-text` with the exact text as `find` (must be unique in file).',
    '  -> If text is not unique, include more surrounding context.',
    '',
    '- Editing a YAML scalar field',
    '  -> use `set-yaml-key`. DO NOT use replace-text on yaml files.',
    '',
    '- Adding an item to a YAML array',
    '  -> use `append-yaml-array-item`. DO NOT use replace-text.',
    '',
    '- Replacing an entire section (heading + content) with new heading + content',
    '  -> use `replace-section`.',
    '',
    '- Creating a new delta file (memory/console-*.delta.md)',
    '  -> use `create-file`. The `file` field may end with `*.delta.md` and console will assign a timestamp.',
    '  -> Use the exact file field `memory/console-*.delta.md`; do not invent a concrete delta filename.',
    '  -> Do not include memory/canon.md or memory/*.yaml in [edits]; for canon/memory requests, write a proposal into memory/console-*.delta.md instead.',
    '',
    'When in doubt about op choice, prefer the more specific op. `replace-text` is the last resort, not the default.',
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
    return 'chapters: none\nno chapters drafted yet';
  }
  if (entries.length === 0) return 'chapters: none\nno chapters drafted yet';
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
  const baseDir = baseDirForScope(projectDir, parsed.scope, options.env);
  const edits = parseEditsBlock(parsed.edits);
  const applied = await applyEditOps({ baseDir, scope: parsed.scope, edits, now: options.now });
  const editsYaml = renderEditsYaml(applied.edits);

  const change = await recordChange({
    baseDir,
    scope: parsed.scope,
    agent: 'author-console',
    userPrompt: options.userPrompt,
    agentOutput: parsed.raw,
    fileChanges: applied.fileChanges,
    editsYaml,
    editOps: applied.edits.map((edit) => edit.op),
    now: options.now,
  });
  return { ...change, noops: applied.noops };
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
  const baseDir = baseDirForScope(projectDir, parsed.scope, env);
  const edits = parseEditsBlock(parsed.edits);
  const after = await previewEditOpsForFile({
    baseDir,
    scope: parsed.scope,
    edits,
    file: requestedFile,
  });
  return `Preview: ${requestedFile}\n${after}\n`;
}

async function editParsedEdits(parsed: ParsedConsoleOutput, env: EnvLike | undefined, io: ConsoleIo): Promise<ParsedConsoleOutput> {
  const tempDir = await mkdtemp(join(tmpdir(), 'authoros-console-edit-'));
  const tempFile = join(tempDir, 'edits.yaml');
  await writeFile(tempFile, parsed.edits, 'utf8');
  io.stdout(`edits file: ${tempFile}\n`);

  const editor = env && Object.hasOwn(env, 'EDITOR')
    ? env.EDITOR?.trim()
    : process.env.EDITOR?.trim();
  if (!editor) {
    io.stdout('EDITOR is not set; edits left unchanged.\n');
    return parsed;
  }

  const result = spawnSync(editor, [tempFile], { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new AuthorOsError(`editor exited with status ${result.status ?? 'unknown'}.`);
  }

  return { ...parsed, edits: await readFile(tempFile, 'utf8') };
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
