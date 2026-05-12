import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorOsError } from './schema.ts';

export interface CascadeContext {
  builtinRoot: string;
  authorRoot: string | null;
  bookRoot: string | null;
}

export async function loadCascadedMarkdown(
  ctx: CascadeContext,
  relativePath: string,
): Promise<string> {
  const layers = await readExistingLayers(ctx, relativePath);
  const last = layers.at(-1);
  if (!last) {
    throw new AuthorOsError(`Cascaded markdown not found: ${relativePath}`);
  }
  return last;
}

export async function loadCascadedYaml<T>(
  ctx: CascadeContext,
  relativePath: string,
): Promise<T> {
  const layers = await readExistingLayers(ctx, relativePath);
  if (layers.length === 0) {
    throw new AuthorOsError(`Cascaded YAML not found: ${relativePath}`);
  }

  let merged: unknown = {};
  for (const layer of layers) {
    merged = deepMerge(merged, parseSimpleYaml(layer));
  }
  return merged as T;
}

async function readExistingLayers(ctx: CascadeContext, relativePath: string): Promise<string[]> {
  const roots = [ctx.builtinRoot, ctx.authorRoot, ctx.bookRoot].filter((root): root is string => Boolean(root));
  const layers: string[] = [];
  for (const root of roots) {
    try {
      layers.push(await readFile(join(root, relativePath), 'utf8'));
    } catch (error) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
  }
  return layers;
}

function deepMerge(base: unknown, next: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(next)) {
    return mergeArrays(base, next);
  }
  if (isPlainObject(base) && isPlainObject(next)) {
    const output: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(next)) {
      output[key] = key in output ? deepMerge(output[key], value) : value;
    }
    return output;
  }
  return next;
}

function mergeArrays(base: unknown[], next: unknown[]): unknown[] {
  if (!base.every(hasId) || !next.every(hasId)) {
    return next;
  }

  const merged = base.map((item) => ({ ...(item as Record<string, unknown>) }));
  const indexById = new Map(merged.map((item, index) => [String(item.id), index]));
  for (const item of next as Array<Record<string, unknown>>) {
    const id = String(item.id);
    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, merged.length);
      merged.push({ ...item });
      continue;
    }
    merged[existingIndex] = deepMerge(merged[existingIndex], item) as Record<string, unknown>;
  }
  return merged;
}

interface StackFrame {
  indent: number;
  value: Record<string, unknown> | unknown[];
  parent?: StackFrame;
  parentKey?: string;
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const parsedLines = raw.split(/\r?\n/)
    .map((line) => ({ line }))
    .filter((entry) => {
      const trimmed = stripComment(entry.line).trim();
      return trimmed.length > 0;
    });
  const stack: StackFrame[] = [{ indent: -1, value: root }];

  for (let i = 0; i < parsedLines.length; i += 1) {
    const line = stripComment(parsedLines[i]!.line);
    const indent = countIndent(line);
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!;

    if (trimmed.startsWith('- ')) {
      const arrayParent = ensureArrayParent(parent);
      const itemText = trimmed.slice(2).trim();
      const item = parseArrayItem(itemText);
      arrayParent.push(item);
      if (isPlainObject(item)) {
        stack.push({ indent, value: item, parent });
      }
      continue;
    }

    const keyMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!keyMatch || Array.isArray(parent.value)) continue;
    const key = keyMatch[1]!.trim();
    const valueText = keyMatch[2]!.trim();
    const value = valueText
      ? parseScalar(valueText)
      : nextChildIsArray(parsedLines, i, indent) ? [] : {};
    parent.value[key] = value;
    if (isPlainObject(value) || Array.isArray(value)) {
      stack.push({ indent, value, parent, parentKey: key });
    }
  }

  return root;
}

function ensureArrayParent(parent: StackFrame): unknown[] {
  if (Array.isArray(parent.value)) return parent.value;
  if (parent.parent && parent.parentKey !== undefined && isPlainObject(parent.parent.value)) {
    const replacement: unknown[] = [];
    parent.parent.value[parent.parentKey] = replacement;
    parent.value = replacement;
    return replacement;
  }
  return [];
}

function parseArrayItem(itemText: string): unknown {
  if (!itemText) return {};
  const keyMatch = itemText.match(/^([^:]+):\s*(.*)$/);
  if (keyMatch) {
    return { [keyMatch[1]!.trim()]: parseScalar(keyMatch[2]!.trim()) };
  }
  return parseScalar(itemText);
}

function parseScalar(valueText: string): unknown {
  const trimmed = valueText.trim();
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function nextChildIsArray(lines: Array<{ line: string }>, currentIndex: number, indent: number): boolean {
  for (let i = currentIndex + 1; i < lines.length; i += 1) {
    const line = stripComment(lines[i]!.line);
    const nextIndent = countIndent(line);
    if (nextIndent <= indent) return false;
    return line.trim().startsWith('- ');
  }
  return false;
}

function hasId(value: unknown): value is { id: unknown } {
  return isPlainObject(value) && 'id' in value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripComment(line: string): string {
  const index = line.indexOf('#');
  return index >= 0 ? line.slice(0, index) : line;
}

function countIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
