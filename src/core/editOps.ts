import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { AuthorOsError } from './schema.ts';

export type EditScope = 'book' | 'author' | 'both';

export type EditOp =
  | { file: string; op: 'append-after-heading'; anchor: string; content: string }
  | { file: string; op: 'prepend-before-heading'; anchor: string; content: string }
  | { file: string; op: 'replace-section'; anchor: string; content: string }
  | { file: string; op: 'replace-text'; find: string; replace: string }
  | { file: string; op: 'append-to-file'; content: string }
  | { file: string; op: 'create-file'; content: string }
  | { file: string; op: 'set-yaml-key'; key: string; value: unknown }
  | { file: string; op: 'append-yaml-array-item'; key: string; item: Record<string, unknown> }
  | { file: string; op: 'delete-yaml-array-item'; key: string; predicate: Record<string, unknown> };

export interface ApplyEditOpsResult {
  fileChanges: Array<{ file: string; before: string | null; after: string }>;
  edits: EditOp[];
}

const knownOps = new Set([
  'append-after-heading',
  'prepend-before-heading',
  'replace-section',
  'replace-text',
  'append-to-file',
  'create-file',
  'set-yaml-key',
  'append-yaml-array-item',
  'delete-yaml-array-item',
]);

export function parseEditsBlock(raw: string): EditOp[] {
  const items = parseYamlArray(raw);
  const edits = items.map(toEditOp);
  if (edits.length === 0) {
    return [];
  }
  return edits;
}

export function renderEditsYaml(edits: readonly EditOp[]): string {
  if (edits.length === 0) return '[]\n';
  return `${edits.map((edit) => renderYamlValue(edit, 0, true)).join('\n')}\n`;
}

export async function applyEditOps(args: {
  baseDir: string;
  scope: EditScope;
  edits: readonly EditOp[];
  now?: Date;
}): Promise<ApplyEditOpsResult> {
  const now = args.now ?? new Date();
  const edits = args.edits.map((edit) => normalizeEditFile(edit, now));
  validateScope(edits, args.scope);

  const byFile = new Map<string, EditOp[]>();
  for (const edit of edits) {
    byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  }

  const fileChanges: ApplyEditOpsResult['fileChanges'] = [];
  for (const [file, fileEdits] of byFile.entries()) {
    const absPath = join(args.baseDir, file);
    const before = await readOptional(absPath);
    let after = before ?? '';
    for (const edit of fileEdits) {
      after = await applyOneEdit(absPath, after, edit, before);
    }
    await mkdir(dirname(absPath), { recursive: true });
    if (fileEdits.some((edit) => edit.op === 'create-file') && before !== null) {
      throw new AuthorOsError(`create-file target already exists: ${file}`);
    }
    await writeFile(absPath, ensureTrailingNewline(after), 'utf8');
    fileChanges.push({ file, before, after: ensureTrailingNewline(after) });
  }

  return { fileChanges, edits };
}

export async function previewEditOpsForFile(args: {
  baseDir: string;
  scope: EditScope;
  edits: readonly EditOp[];
  file: string;
  now?: Date;
}): Promise<string> {
  const now = args.now ?? new Date();
  const edits = args.edits.map((edit) => normalizeEditFile(edit, now));
  validateScope(edits, args.scope);
  const file = sanitizeRelativeFile(args.file);
  const fileEdits = edits.filter((edit) => edit.file === file);
  if (fileEdits.length === 0) {
    throw new AuthorOsError(`drill target is not present in [edits]: ${file}`);
  }

  const absPath = join(args.baseDir, file);
  const before = await readOptional(absPath);
  let after = before ?? '';
  for (const edit of fileEdits) {
    after = await applyOneEdit(absPath, after, edit, before);
  }
  return ensureTrailingNewline(after);
}

async function applyOneEdit(absPath: string, current: string, edit: EditOp, before: string | null): Promise<string> {
  if (edit.op === 'create-file') {
    if (before !== null) throw new AuthorOsError(`create-file target already exists: ${edit.file}`);
    return edit.content;
  }
  if (edit.op === 'append-to-file') {
    return appendToFile(current, edit.content);
  }
  if (edit.op === 'append-after-heading') {
    return appendAfterHeading(current, edit.anchor, edit.content, edit.file);
  }
  if (edit.op === 'prepend-before-heading') {
    return prependBeforeHeading(current, edit.anchor, edit.content, edit.file);
  }
  if (edit.op === 'replace-section') {
    return replaceSection(current, edit.anchor, edit.content, edit.file);
  }
  if (edit.op === 'replace-text') {
    return replaceText(current, edit.find, edit.replace, edit.file);
  }

  const doc = parseSimpleYaml(current);
  if (edit.op === 'set-yaml-key') {
    setYamlPath(doc, edit.key, edit.value);
  } else if (edit.op === 'append-yaml-array-item') {
    const array = getYamlPath(doc, edit.key);
    if (!Array.isArray(array)) throw new AuthorOsError(`yaml key is not an array in ${edit.file}: ${edit.key}`);
    array.push(edit.item);
  } else if (edit.op === 'delete-yaml-array-item') {
    const array = getYamlPath(doc, edit.key);
    if (!Array.isArray(array)) throw new AuthorOsError(`yaml key is not an array in ${edit.file}: ${edit.key}`);
    const index = array.findIndex((item) => isPlainObject(item) && matchesPredicate(item, edit.predicate));
    if (index < 0) throw new AuthorOsError(`yaml array item not found in ${edit.file}: ${edit.key}`);
    array.splice(index, 1);
  }
  await ensureFileLooksYaml(absPath, edit.file);
  return renderYamlDocument(doc);
}

function appendAfterHeading(input: string, anchor: string, content: string, file: string): string {
  const lines = splitLines(input);
  const found = findUniqueHeading(lines, anchor, file);
  const end = sectionEnd(lines, found.index, found.level);
  return insertLines(lines, end, content);
}

function prependBeforeHeading(input: string, anchor: string, content: string, file: string): string {
  const lines = splitLines(input);
  const found = findUniqueHeading(lines, anchor, file);
  return insertLines(lines, found.index, content);
}

function replaceSection(input: string, anchor: string, content: string, file: string): string {
  const lines = splitLines(input);
  const found = findUniqueHeading(lines, anchor, file);
  const end = sectionEnd(lines, found.index, found.level);
  const next = [...lines.slice(0, found.index + 1), '', ...trimBlock(content), '', ...lines.slice(end)];
  return next.join('\n');
}

function replaceText(input: string, find: string, replace: string, file: string): string {
  const lines = splitLines(input);
  const target = normalizeBlock(find);
  const matches: number[] = [];
  for (let index = 0; index <= lines.length - target.length; index += 1) {
    const candidate = lines.slice(index, index + target.length).map(normalizeLine);
    if (candidate.every((line, offset) => line === target[offset])) {
      matches.push(index);
    }
  }
  if (matches.length === 0) throw new AuthorOsError(`text block not found in ${file}.`);
  if (matches.length > 1) throw new AuthorOsError(`text block matched multiple times in ${file}.`);
  lines.splice(matches[0]!, target.length, ...trimBlock(replace));
  return lines.join('\n');
}

function appendToFile(input: string, content: string): string {
  const base = input.trimEnd();
  return [base, ...trimBlock(content)].filter((part) => part.length > 0).join('\n\n');
}

function insertLines(lines: string[], index: number, content: string): string {
  const insert = trimBlock(content);
  const next = [...lines.slice(0, index), ...insert, '', ...lines.slice(index)];
  return next.join('\n');
}

function findUniqueHeading(lines: string[], anchor: string, file: string): { index: number; level: number } {
  const normalized = anchor.trim();
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim() === normalized);
  if (matches.length === 0) throw new AuthorOsError(`anchor not found in ${file}: ${normalized}`);
  if (matches.length > 1) throw new AuthorOsError(`anchor matched multiple times in ${file}: ${normalized}`);
  const level = matches[0]!.line.trim().match(/^(#+)\s/)?.[1]?.length ?? 99;
  return { index: matches[0]!.index, level };
}

function sectionEnd(lines: string[], headingIndex: number, level: number): number {
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const match = lines[index]!.trim().match(/^(#+)\s/);
    if (match && match[1]!.length <= level) return index;
  }
  return lines.length;
}

function splitLines(input: string): string[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function trimBlock(input: string): string[] {
  return input.replace(/\r\n?/g, '\n').trim().split('\n');
}

function normalizeBlock(input: string): string[] {
  return input.replace(/\r\n?/g, '\n').split('\n').map(normalizeLine);
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

function normalizeEditFile(edit: EditOp, now: Date): EditOp {
  let file = sanitizeRelativeFile(edit.file);
  if (file === 'memory/console-*.delta.md' || file === 'memory/console-NEW.delta.md') {
    file = `memory/console-${timestampForFile(now)}.delta.md`;
  }
  return { ...edit, file } as EditOp;
}

function validateScope(edits: readonly EditOp[], scope: EditScope): void {
  const denied = edits.filter((edit) => !isAllowedForScope(edit, scope)).map((edit) => edit.file);
  if (denied.length > 0) {
    throw new AuthorOsError(`edit file not allowed in ${scope} scope: ${[...new Set(denied)].join(', ')}`);
  }
}

function isAllowedForScope(edit: EditOp, scope: EditScope): boolean {
  if (scope === 'both') return isAllowedForScope(edit, 'book') || isAllowedForScope(edit, 'author');
  if (scope === 'book') {
    if (['product.md', 'outline.md', 'world.md', 'characters.yaml', 'review_rules.md'].includes(edit.file)) return true;
    if (/^memory\/console-[^/]+\.delta\.md$/.test(edit.file)) return edit.op === 'create-file' || edit.op === 'append-to-file';
    if (/^\.authoros\/agents\/[^/]+\.md$/.test(edit.file)) return true;
    if (edit.file === '.authoros/overrides/weights.yaml' || edit.file === '.authoros/overrides/readers.yaml') return true;
    return false;
  }

  if (edit.file === 'author.md' || edit.file === 'style.md') return true;
  if (/^preferences\/[^/]+\.ya?ml$/.test(edit.file)) return true;
  if (/^agents\/[^/]+\.md$/.test(edit.file)) return true;
  if (/^templates\/[^/]+\/.+/.test(edit.file) && !/^templates\/[^/]+\/meta\.yaml$/.test(edit.file)) return true;
  return false;
}

function toEditOp(input: Record<string, unknown>): EditOp {
  const file = stringField(input, 'file');
  const op = stringField(input, 'op');
  if (!knownOps.has(op)) throw new AuthorOsError(`unknown edit op: ${op}`);
  if (op === 'append-after-heading' || op === 'prepend-before-heading' || op === 'replace-section') {
    return { file, op, anchor: stringField(input, 'anchor'), content: stringField(input, 'content') };
  }
  if (op === 'replace-text') {
    return { file, op, find: stringField(input, 'find'), replace: stringField(input, 'replace') };
  }
  if (op === 'append-to-file' || op === 'create-file') {
    return { file, op, content: stringField(input, 'content') };
  }
  if (op === 'set-yaml-key') {
    return { file, op, key: stringField(input, 'key'), value: input.value };
  }
  if (op === 'append-yaml-array-item') {
    if (!isPlainObject(input.item)) throw new AuthorOsError('append-yaml-array-item requires object item.');
    return { file, op, key: stringField(input, 'key'), item: input.item };
  }
  if (!isPlainObject(input.predicate)) throw new AuthorOsError('delete-yaml-array-item requires object predicate.');
  return { file, op: 'delete-yaml-array-item', key: stringField(input, 'key'), predicate: input.predicate };
}

function parseYamlArray(raw: string): Array<Record<string, unknown>> {
  const text = raw.trim();
  if (!text || text === '[]') return [];
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const items: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const itemMatch = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (itemMatch) {
      current = {};
      items.push(current);
      assignYamlField(current, itemMatch[1]!.trim(), itemMatch[2]!.trim(), lines, index);
      if (itemMatch[2]!.trim() === '|') index = consumeBlockScalar(current, itemMatch[1]!.trim(), lines, index);
      continue;
    }
    if (!current) throw new AuthorOsError('edits YAML must be an array of objects.');
    const fieldMatch = line.match(/^\s{2}([^:]+):\s*(.*)$/);
    if (!fieldMatch) throw new AuthorOsError(`invalid edits YAML line: ${line}`);
    const key = fieldMatch[1]!.trim();
    const value = fieldMatch[2]!.trim();
    if (value === '|') {
      index = consumeBlockScalar(current, key, lines, index);
    } else if (value === '') {
      index = consumeNestedObject(current, key, lines, index);
    } else {
      current[key] = parseScalarOrInlineMap(value);
    }
  }
  return items;
}

function assignYamlField(target: Record<string, unknown>, key: string, value: string, lines: string[], index: number): void {
  if (value !== '|') target[key] = parseScalarOrInlineMap(value);
}

function consumeBlockScalar(target: Record<string, unknown>, key: string, lines: string[], start: number): number {
  const out: string[] = [];
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      out.push('');
      continue;
    }
    if (!line.startsWith('    ')) break;
    out.push(line.slice(4));
  }
  target[key] = out.join('\n').trimEnd();
  return index - 1;
}

function consumeNestedObject(target: Record<string, unknown>, key: string, lines: string[], start: number): number {
  const out: Record<string, unknown> = {};
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const match = line.match(/^\s{4}([^:]+):\s*(.*)$/);
    if (!match) break;
    out[match[1]!.trim()] = parseScalarOrInlineMap(match[2]!.trim());
  }
  target[key] = out;
  return index - 1;
}

function parseScalarOrInlineMap(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const body = trimmed.slice(1, -1).trim();
    if (!body) return {};
    const out: Record<string, unknown> = {};
    for (const part of body.split(',')) {
      const [key, ...rest] = part.split(':');
      out[key!.trim()] = parseScalar(rest.join(':').trim());
    }
    return out;
  }
  return parseScalar(trimmed);
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[]; key?: string; parent?: Record<string, unknown> }> = [{ indent: -1, value: root }];
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const frame = stack[stack.length - 1]!;
    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(frame.value)) continue;
      const itemText = trimmed.slice(2).trim();
      const item: Record<string, unknown> = {};
      if (itemText.includes(':')) {
        const [key, ...rest] = itemText.split(':');
        item[key!.trim()] = parseScalar(rest.join(':').trim());
      }
      frame.value.push(item);
      stack.push({ indent, value: item });
      continue;
    }
    if (Array.isArray(frame.value)) continue;
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!.trim();
    const valueText = match[2]!.trim();
    const value = valueText ? parseScalar(valueText) : emptyYamlContainer(lines, lineIndex, indent);
    frame.value[key] = value;
    if (!valueText) stack.push({ indent, value: value as Record<string, unknown> | unknown[] });
  }
  normalizeYamlArrays(root);
  return root;
}

function emptyYamlContainer(lines: string[], lineIndex: number, parentIndent: number): Record<string, unknown> | unknown[] {
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= parentIndent) return {};
    return line.trim().startsWith('- ') ? [] : {};
  }
  return {};
}

function normalizeYamlArrays(node: unknown): void {
  if (!isPlainObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (isPlainObject(value) && Object.keys(value).length === 0 && (key === 'major' || key === 'antagonists' || key === 'hooks' || key === 'threads')) {
      node[key] = [];
    } else if (isPlainObject(value)) {
      normalizeYamlArrays(value);
    }
  }
}

function getYamlPath(doc: Record<string, unknown>, path: string): unknown {
  let current: unknown = doc;
  for (const part of path.split('.')) {
    current = stepYamlPath(current, part);
  }
  if (current === undefined) throw new AuthorOsError(`yaml key path not found: ${path}`);
  return current;
}

function setYamlPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: unknown = doc;
  for (const part of parts.slice(0, -1)) {
    current = stepYamlPath(current, part);
  }
  if (!isPlainObject(current)) throw new AuthorOsError(`yaml key path not found: ${path}`);
  const last = parts[parts.length - 1]!;
  if (!Object.hasOwn(current, last)) throw new AuthorOsError(`yaml key path not found: ${path}`);
  current[last] = value;
}

function stepYamlPath(current: unknown, part: string): unknown {
  const pred = part.match(/^(.+)\[([^=]+)=([^\]]+)\]$/);
  if (pred) {
    if (!isPlainObject(current)) return undefined;
    const array = current[pred[1]!];
    if (!Array.isArray(array)) return undefined;
    return array.find((item) => isPlainObject(item) && String(item[pred[2]!] ?? '') === pred[3]);
  }
  return isPlainObject(current) ? current[part] : undefined;
}

function matchesPredicate(item: Record<string, unknown>, predicate: Record<string, unknown>): boolean {
  return Object.entries(predicate).every(([key, value]) => String(item[key] ?? '') === String(value));
}

function renderYamlDocument(doc: Record<string, unknown>): string {
  return `${renderYamlValue(doc, 0, false)}\n`;
}

function renderYamlValue(value: unknown, indent: number, asArrayItem: boolean): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return asArrayItem ? `${pad}- []` : `${pad}[]`;
    return value.map((item) => `${pad}- ${renderYamlInlineOrNested(item, indent + 2)}`).join('\n');
  }
  if (isPlainObject(value)) {
    return Object.entries(value).map(([key, child], index) => {
      const prefix = asArrayItem && index === 0 ? `${pad}- ${key}:` : `${pad}${key}:`;
      if (isPlainObject(child) || Array.isArray(child)) {
        if (Array.isArray(child) && child.length === 0) return `${prefix} []`;
        return `${prefix}\n${renderYamlValue(child, indent + (asArrayItem && index === 0 ? 4 : 2), false)}`;
      }
      return `${prefix} ${formatScalar(child)}`;
    }).join('\n');
  }
  return `${pad}${formatScalar(value)}`;
}

function renderYamlInlineOrNested(value: unknown, indent: number): string {
  if (!isPlainObject(value)) return formatScalar(value);
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const [firstKey, firstValue] = entries[0]!;
  const rest = entries.slice(1).map(([key, child]) => `${' '.repeat(indent)}${key}: ${formatScalar(child)}`);
  return [`${firstKey}: ${formatScalar(firstValue)}`, ...rest].join('\n');
}

function formatScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value ?? '');
  if (/^[\w.-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AuthorOsError(`edit op missing required string field: ${field}`);
  }
  return value;
}

function sanitizeRelativeFile(input: string): string {
  const cleaned = input.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!cleaned || isAbsolute(cleaned) || cleaned.split('/').includes('..')) {
    throw new AuthorOsError(`invalid edit file path: ${input}`);
  }
  return normalize(cleaned).split(sep).join('/');
}

async function ensureFileLooksYaml(absPath: string, file: string): Promise<void> {
  if (!/\.ya?ml$/.test(file)) throw new AuthorOsError(`yaml edit requires a YAML file: ${file}`);
  try {
    const info = await stat(absPath);
    if (!info.isFile()) throw new AuthorOsError(`yaml target is not a file: ${file}`);
  } catch (error) {
    if (isMissingFileError(error)) throw new AuthorOsError(`yaml target does not exist: ${file}`);
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

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function timestampForFile(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
