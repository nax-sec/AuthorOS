import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { EnvLike } from '../core/modelConfig.ts';
import { resolveAuthorDir } from '../core/authorSchema.ts';
import { AuthorOsError } from '../core/schema.ts';
import { resolveTemplateDir, supportedTemplateKeys } from '../core/templates.ts';

export interface TemplateEntry {
  key: string;
  name: string;
  status: string;
  source: 'seed' | 'author' | 'seed+author';
  createdFromBook?: string;
}

export async function listTemplates(dir: string | undefined, env: EnvLike): Promise<TemplateEntry[]> {
  const authorDir = resolveAuthorDir(dir, env);
  const authorKeys = await listAuthorTemplateKeys(authorDir);
  const seedKeys = new Set<string>(supportedTemplateKeys);
  const allKeys = [...new Set([...supportedTemplateKeys, ...authorKeys])].sort();
  const entries: TemplateEntry[] = [];

  for (const key of allKeys) {
    const inSeed = seedKeys.has(key);
    const inAuthor = authorKeys.includes(key);
    const source = inSeed && inAuthor ? 'seed+author' : inAuthor ? 'author' : 'seed';
    const metaPath = inAuthor
      ? join(authorDir, 'templates', key, 'meta.yaml')
      : join(await resolveTemplateDir(key), 'meta.yaml');
    const meta = parseMeta(await readFile(metaPath, 'utf8'));
    entries.push({
      key,
      name: meta.name ?? key,
      status: meta.status ?? 'active',
      source,
      createdFromBook: meta.createdFrom?.book_name,
    });
  }
  return entries;
}

export async function showTemplate(key: string, dir: string | undefined, env: EnvLike): Promise<{ key: string; source: string; meta: string; files: string[] }> {
  const authorDir = resolveAuthorDir(dir, env);
  const source = await resolveTemplateSource(key, authorDir);
  const root = source.path;
  return {
    key,
    source: source.source,
    meta: await readFile(join(root, 'meta.yaml'), 'utf8'),
    files: await listFiles(root),
  };
}

export async function promoteTemplate(key: string, dir: string | undefined, env: EnvLike): Promise<{ key: string }> {
  const authorDir = resolveAuthorDir(dir, env);
  const metaPath = join(authorDir, 'templates', key, 'meta.yaml');
  const raw = await readFile(metaPath, 'utf8').catch((error) => {
    if (isMissingFileError(error)) {
      throw new AuthorOsError(`author template not found: ${key}`);
    }
    throw error;
  });
  const meta = parseMeta(raw);
  if (meta.status !== 'candidate') {
    throw new AuthorOsError(`template ${key} is not a candidate.`);
  }
  await writeFile(metaPath, promoteMeta(raw), 'utf8');
  return { key };
}

export async function forgetTemplate(key: string, dir: string | undefined, env: EnvLike): Promise<{ key: string }> {
  if ((supportedTemplateKeys as readonly string[]).includes(key)) {
    throw new AuthorOsError('seed templates cannot be forgotten.');
  }
  const authorDir = resolveAuthorDir(dir, env);
  const templateDir = join(authorDir, 'templates', key);
  if (!await isDirectory(templateDir)) {
    throw new AuthorOsError(`author template not found: ${key}`);
  }
  await rm(templateDir, { recursive: true, force: true });
  return { key };
}

export async function exportTemplate(key: string, outputFile: string, dir: string | undefined, env: EnvLike): Promise<{ key: string; outputFile: string }> {
  if (!outputFile?.trim()) {
    throw new AuthorOsError('author template export requires an output file path.');
  }
  const authorDir = resolveAuthorDir(dir, env);
  const source = await resolveTemplateSource(key, authorDir);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeZipFromDirectory(source.path, outputFile);
  return { key, outputFile };
}

export function renderTemplateList(entries: TemplateEntry[]): string {
  const lines = [
    'Templates:',
    '  source      status     key                       name',
  ];
  for (const entry of entries) {
    const suffix = entry.createdFromBook ? ` (created from "${entry.createdFromBook}")` : '';
    lines.push(
      `  ${pad(entry.source, 11)} ${pad(entry.status, 10)} ${pad(entry.key, 25)} ${entry.name}${suffix}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function renderTemplateShow(result: { key: string; source: string; meta: string; files: string[] }): string {
  return [
    `Template: ${result.key}`,
    `source: ${result.source}`,
    '',
    'meta.yaml',
    '---',
    result.meta.trimEnd(),
    '',
    'files',
    '---',
    ...result.files.map((file) => `- ${file}`),
    '',
  ].join('\n');
}

export function renderTemplatePromote(result: { key: string }): string {
  return `Template promoted ${result.key} to active.\n`;
}

export function renderTemplateForget(result: { key: string }): string {
  return `Template forgot ${result.key}.\n`;
}

export function renderTemplateExport(result: { key: string; outputFile: string }): string {
  return `Template exported ${result.key} to ${result.outputFile}.\n`;
}

async function listAuthorTemplateKeys(authorDir: string): Promise<string[]> {
  const templatesDir = join(authorDir, 'templates');
  try {
    const entries = await readdir(templatesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

async function resolveTemplateSource(key: string, authorDir: string): Promise<{ source: 'seed' | 'author' | 'seed+author'; path: string }> {
  const authorPath = join(authorDir, 'templates', key);
  const hasAuthor = await isDirectory(authorPath);
  const hasSeed = (supportedTemplateKeys as readonly string[]).includes(key);
  if (hasAuthor) {
    return { source: hasSeed ? 'seed+author' : 'author', path: authorPath };
  }
  if (hasSeed) {
    return { source: 'seed', path: await resolveTemplateDir(key) };
  }
  throw new AuthorOsError(`template not found: ${key}`);
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        out.push(relative(root, path).replace(/\\/g, '/'));
      }
    }
  }
  return out.sort();
}

interface ParsedMeta {
  name?: string;
  status?: string;
  createdFrom?: { book_name?: string };
}

function parseMeta(raw: string): ParsedMeta {
  const meta: ParsedMeta = {};
  let inCreatedFrom = false;
  for (const line of raw.split(/\r?\n/)) {
    const top = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (top) {
      inCreatedFrom = top[1] === 'created_from';
      if (top[1] === 'name') meta.name = stripScalar(top[2] ?? '');
      if (top[1] === 'status') meta.status = stripScalar(top[2] ?? '');
      if (inCreatedFrom) meta.createdFrom = {};
      continue;
    }
    if (inCreatedFrom) {
      const nested = line.match(/^\s+([a-zA-Z0-9_]+):\s*(.*)$/);
      if (nested && nested[1] === 'book_name') {
        meta.createdFrom ??= {};
        meta.createdFrom.book_name = stripScalar(nested[2] ?? '');
      }
    }
  }
  return meta;
}

function promoteMeta(raw: string): string {
  return raw
    .replace(/^status:\s*candidate\s*$/m, 'status: active')
    .split(/\r?\n/)
    .filter((line) => !/^\s+distill_run_id:\s*/.test(line))
    .join('\n')
    .replace(/\n*$/, '\n');
}

async function writeZipFromDirectory(root: string, outputFile: string): Promise<void> {
  const files = await listFiles(root);
  const records: Array<{ name: string; crc: number; size: number; offset: number }> = [];
  const chunks: Buffer[] = [];
  let offset = 0;

  for (const name of files) {
    const data = await readFile(join(root, name));
    const nameBytes = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);
    records.push({ name: name.replace(/\\/g, '/'), crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  for (const record of records) {
    const nameBytes = Buffer.from(record.name, 'utf8');
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(record.crc, 16);
    central.writeUInt32LE(record.size, 20);
    central.writeUInt32LE(record.size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(record.offset, 42);
    chunks.push(central, nameBytes);
    offset += central.length + nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  await writeFile(outputFile, Buffer.concat(chunks));
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function stripScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
