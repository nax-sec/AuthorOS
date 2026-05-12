import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AuthorOsError } from './schema.ts';

export interface ChangeRecord {
  id: string;
  timestamp: string;
  scope: 'book' | 'author' | 'both';
  agent: string;
  userPrompt: string;
  files: string[];
  rollbackOf?: string;
}

export interface RecordChangeOptions {
  baseDir: string;
  scope: ChangeRecord['scope'];
  agent: string;
  userPrompt: string;
  agentOutput: string;
  fileChanges: Array<{ file: string; before: string | null; after: string }>;
  rollbackOf?: string;
  now?: Date;
}

interface ChangeMeta extends ChangeRecord {
  change_id?: string;
  dir: string;
  fileStates: Array<{ file: string; beforeExists: boolean; afterExists: boolean }>;
}

export async function recordChange(opts: RecordChangeOptions): Promise<ChangeRecord> {
  const now = opts.now ?? new Date();
  const files = opts.fileChanges.map((change) => sanitizeRelativeFile(change.file));
  const id = `CHG-${shortHash(`${now.toISOString()}:${opts.agent}:${opts.userPrompt}:${files.join(',')}:${randomSuffix()}`)}`;
  const dirName = `${timestampSlug(now)}-${id.slice(4).toLowerCase()}`;
  const changeDir = join(opts.baseDir, 'changes', dirName);

  await mkdir(join(opts.baseDir, 'changes'), { recursive: true });
  await mkdir(changeDir, { recursive: false });
  await writeFile(join(changeDir, 'user_prompt.txt'), ensureTrailingNewline(opts.userPrompt), 'utf8');
  await writeFile(join(changeDir, 'agent_output.md'), ensureTrailingNewline(opts.agentOutput), 'utf8');

  const fileStates: ChangeMeta['fileStates'] = [];
  for (let index = 0; index < opts.fileChanges.length; index += 1) {
    const file = files[index]!;
    const change = opts.fileChanges[index]!;
    fileStates.push({ file, beforeExists: change.before !== null, afterExists: true });
    if (change.before !== null) {
      await writeSnapshot(changeDir, 'before', file, change.before);
    }
    await writeSnapshot(changeDir, 'after', file, change.after);
  }

  const record: ChangeRecord = {
    id,
    timestamp: now.toISOString(),
    scope: opts.scope,
    agent: opts.agent,
    userPrompt: opts.userPrompt,
    files,
    ...(opts.rollbackOf ? { rollbackOf: opts.rollbackOf } : {}),
  };
  const meta: ChangeMeta = { ...record, change_id: record.id, dir: dirName, fileStates };
  await writeFile(join(changeDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return record;
}

export async function listChanges(baseDir: string): Promise<ChangeRecord[]> {
  const metas = await listChangeMetas(baseDir);
  return metas
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.dir.localeCompare(left.dir))
    .map(({ dir: _dir, fileStates: _fileStates, ...record }) => record);
}

export async function rollback(
  baseDir: string,
  changeId: string,
  options: { now?: Date } = {},
): Promise<ChangeRecord> {
  const original = await findChangeMeta(baseDir, changeId);
  const fileChanges: RecordChangeOptions['fileChanges'] = [];

  for (const state of original.fileStates) {
    const target = join(baseDir, state.file);
    const current = await readOptional(target);
    if (state.beforeExists) {
      const restored = await readFile(join(baseDir, 'changes', original.dir, 'before', state.file), 'utf8');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, restored, 'utf8');
      fileChanges.push({ file: state.file, before: current, after: restored });
    } else {
      await rm(target, { force: true });
      fileChanges.push({ file: state.file, before: current, after: '' });
    }
  }

  return await recordChange({
    baseDir,
    scope: original.scope,
    agent: original.agent,
    userPrompt: `rollback ${original.id}`,
    agentOutput: renderRollbackAgentOutput(original),
    fileChanges,
    rollbackOf: original.id,
    now: options.now,
  });
}

async function listChangeMetas(baseDir: string): Promise<ChangeMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(join(baseDir, 'changes'));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const metas: ChangeMeta[] = [];
  for (const entry of entries) {
    try {
      const meta = JSON.parse(await readFile(join(baseDir, 'changes', entry, 'meta.json'), 'utf8')) as Partial<ChangeMeta>;
      const id = typeof meta.id === 'string' ? meta.id : meta.change_id;
      if (typeof id === 'string' && typeof meta.timestamp === 'string') {
        metas.push({
          id,
          timestamp: meta.timestamp,
          scope: meta.scope ?? 'book',
          agent: meta.agent ?? 'unknown',
          userPrompt: meta.userPrompt ?? '',
          files: Array.isArray(meta.files) ? meta.files : [],
          ...(meta.rollbackOf ? { rollbackOf: meta.rollbackOf } : {}),
          dir: meta.dir ?? entry,
          fileStates: Array.isArray(meta.fileStates)
            ? meta.fileStates
            : (Array.isArray(meta.files) ? meta.files : []).map((file) => ({
              file,
              beforeExists: true,
              afterExists: true,
            })),
        });
      }
    } catch {
      // Ignore incomplete change directories; they should not poison list/rollback.
    }
  }
  return metas;
}

async function findChangeMeta(baseDir: string, changeId: string): Promise<ChangeMeta> {
  const metas = await listChangeMetas(baseDir);
  const found = metas.find((meta) => meta.id === changeId);
  if (!found) {
    throw new AuthorOsError(`change not found: ${changeId}`);
  }
  return found;
}

async function writeSnapshot(changeDir: string, kind: 'before' | 'after', file: string, content: string): Promise<void> {
  const target = join(changeDir, kind, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function renderRollbackAgentOutput(original: ChangeRecord): string {
  return [
    `[scope] ${original.scope}`,
    '[impact]',
    `  high: ${original.files.join(', ')} - rollback ${original.id}`,
    '[diff]',
    '  rollback restored before snapshots',
    '[next]',
    '  review restored files',
    '',
  ].join('\n');
}

function sanitizeRelativeFile(input: string): string {
  const cleaned = input.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!cleaned || isAbsolute(cleaned) || cleaned.split('/').includes('..')) {
    throw new AuthorOsError(`invalid change file path: ${input}`);
  }
  return normalize(cleaned).split(sep).join('/');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function timestampSlug(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).slice(0, 6).toUpperCase().padStart(4, '0');
}

function randomSuffix(): string {
  return randomBytes(4).toString('hex');
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
