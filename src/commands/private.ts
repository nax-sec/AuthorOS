import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { initProject } from './init.ts';
import { renderPlanResult, createChapterPlan, type PlanResult } from './plan.ts';
import { renderWriteResult, createChapterDraft, type WriteResult } from './write.ts';
import { getProjectState, renderProjectState, type ProjectStateResult } from './state.ts';
import { renderReviseResult, reviseChapter, type ReviseResult } from './revise.ts';
import { renderSetupResult, setupFromConcept, type SetupResult } from './setup.ts';
import type { LlmClient } from '../core/llm.ts';
import { AuthorOsError } from '../core/schema.ts';
import { formatChapterNumber } from '../core/paths.ts';

export interface PrivateBook {
  id: string;
  title: string;
  concept: string;
  path: string;
  created_at: string;
  last_active_at: string;
}

export interface PrivateShelf {
  version: 1;
  current: string | null;
  books: PrivateBook[];
}

export interface PrivateNewResult {
  root: string;
  book: PrivateBook;
  setup: SetupResult;
}

export interface PrivateContinueResult {
  book: PrivateBook;
  plan: PlanResult;
  write: WriteResult;
}

export interface PrivateReadResult {
  book: PrivateBook;
  chapter: number;
  path: string;
  content: string;
}

export interface PrivateFeedbackResult {
  book: PrivateBook;
  chapter: number;
  pendingPath: string;
  revise: ReviseResult;
}

export interface PrivateApplyResult {
  book: PrivateBook;
  chapter: number;
  revise: ReviseResult;
}

export interface PrivatePendingFeedback {
  book_id: string;
  chapter: number;
  text: string;
  instruction: string;
  created_at: string;
}

type SetupIo = { stdout: (message: string) => void };

export async function createPrivateBook(opts: {
  root: string;
  title?: string;
  concept: string;
  template?: string;
  authorDir?: string | null;
  llm: LlmClient;
  now?: Date;
  io?: SetupIo;
  noDistill?: boolean;
}): Promise<PrivateNewResult> {
  const root = resolve(opts.root);
  const concept = opts.concept.trim();
  if (!concept) throw new AuthorOsError('author private new requires --concept <text>.');
  const title = opts.title?.trim() || firstLine(concept);
  const now = (opts.now ?? new Date()).toISOString();
  const shelf = await loadPrivateShelf(root);
  const id = uniqueBookId(slugifyBookId(title), shelf);
  const booksDir = privateBooksDir(root);

  const init = await initProject({
    projectName: title,
    template: opts.template ?? 'urban_power_anomaly',
    cwd: booksDir,
    targetDir: id,
    authorDir: opts.authorDir,
  });

  const setup = await setupFromConcept({
    projectDir: init.targetDir,
    projectName: init.projectName,
    template: init.template,
    authorDir: opts.authorDir,
    concept,
    llm: opts.llm,
    io: opts.io,
    noDistill: opts.noDistill,
  });

  const book: PrivateBook = {
    id,
    title,
    concept,
    path: `books/${id}`,
    created_at: now,
    last_active_at: now,
  };
  shelf.books.push(book);
  shelf.current = id;
  await savePrivateShelf(root, shelf);

  return { root, book, setup };
}

export async function listPrivateBooks(root: string): Promise<PrivateShelf> {
  return await loadPrivateShelf(resolve(root));
}

export async function switchPrivateBook(root: string, id: string, now?: Date): Promise<PrivateBook> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = findBook(shelf, id);
  book.last_active_at = (now ?? new Date()).toISOString();
  shelf.current = book.id;
  await savePrivateShelf(resolvedRoot, shelf);
  return book;
}

export async function getCurrentPrivateBook(root: string): Promise<PrivateBook> {
  const shelf = await loadPrivateShelf(resolve(root));
  return currentBook(shelf);
}

export async function getPrivateStatus(root: string): Promise<{ book: PrivateBook; state: ProjectStateResult }> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  return {
    book,
    state: await getProjectState(bookDir(resolvedRoot, book)),
  };
}

export async function continuePrivateBook(root: string, opts: {
  llm: LlmClient;
  now?: Date;
}): Promise<PrivateContinueResult> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const plan = await createChapterPlan(projectDir, {
    next: true,
    llm: opts.llm,
    now: opts.now,
    write: true,
  });
  const write = await createChapterDraft(projectDir, {
    next: true,
    llm: opts.llm,
    now: opts.now,
    write: true,
  });
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, plan, write };
}

export async function readPrivateChapter(root: string, opts: {
  chapter?: number | 'latest';
} = {}): Promise<PrivateReadResult> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const chapter = opts.chapter === undefined || opts.chapter === 'latest'
    ? await latestChapter(projectDir)
    : opts.chapter;
  const chapterId = formatChapterNumber(chapter);
  const relativePath = `chapters/${chapterId}.md`;
  const content = await readFile(join(projectDir, relativePath), 'utf8');
  return { book, chapter, path: relativePath, content };
}

export async function previewPrivateFeedback(root: string, opts: {
  chapter?: number | 'latest';
  text: string;
  llm: LlmClient;
  now?: Date;
}): Promise<PrivateFeedbackResult> {
  const text = opts.text.trim();
  if (!text) throw new AuthorOsError('author private feedback requires --text <reader feedback>.');

  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const chapter = opts.chapter === undefined || opts.chapter === 'latest'
    ? await latestChapter(projectDir)
    : opts.chapter;
  const instruction = buildPrivateFeedbackInstruction(chapter, text);

  await ensurePrivateReviewPlaceholder(projectDir, chapter, opts.now);
  const revise = await reviseChapter(projectDir, {
    chapter,
    llm: opts.llm,
    now: opts.now,
    write: false,
    instruction,
  });

  const pending: PrivatePendingFeedback = {
    book_id: book.id,
    chapter,
    text,
    instruction,
    created_at: (opts.now ?? new Date()).toISOString(),
  };
  const pendingPath = await writePendingFeedback(projectDir, pending);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, chapter, pendingPath, revise };
}

export async function applyPrivateFeedback(root: string, opts: {
  llm: LlmClient;
  now?: Date;
}): Promise<PrivateApplyResult> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const pendingPath = pendingFeedbackPath(projectDir);
  const pending = parsePendingFeedback(await readFile(pendingPath, 'utf8'));
  if (pending.book_id !== book.id) {
    throw new AuthorOsError(`Pending feedback belongs to "${pending.book_id}", but current book is "${book.id}".`);
  }

  await ensurePrivateReviewPlaceholder(projectDir, pending.chapter, opts.now);
  const revise = await reviseChapter(projectDir, {
    chapter: pending.chapter,
    llm: opts.llm,
    now: opts.now,
    write: true,
    instruction: pending.instruction,
  });
  await unlink(pendingPath);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, chapter: pending.chapter, revise };
}

export function renderPrivateNewResult(result: PrivateNewResult): string {
  return [
    `Private Author: new book ${result.book.id}`,
    `title: ${result.book.title}`,
    `root: ${result.root}`,
    `path: ${result.book.path}`,
    '',
    renderSetupResult(result.setup).trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateList(shelf: PrivateShelf): string {
  const lines = ['Private Author: bookshelf'];
  if (shelf.books.length === 0) {
    lines.push('no books yet');
  } else {
    for (const book of shelf.books) {
      const marker = book.id === shelf.current ? '*' : ' ';
      lines.push(`${marker} ${book.id} — ${book.title}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderPrivateCurrent(book: PrivateBook): string {
  return [
    `Current private book: ${book.id} — ${book.title}`,
    `path: ${book.path}`,
    '',
  ].join('\n');
}

export function renderPrivateStatus(result: { book: PrivateBook; state: ProjectStateResult }): string {
  return [
    `Private Author: status ${result.book.id} — ${result.book.title}`,
    '',
    renderProjectState(result.state).trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateContinueResult(result: PrivateContinueResult): string {
  return [
    `Private Author: continued ${result.book.id} chapter ${result.write.chapter}`,
    '',
    renderPlanResult(result.plan).trimEnd(),
    '',
    renderWriteResult(result.write).trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateReadResult(result: PrivateReadResult): string {
  return [
    `Private Author: read ${result.book.id} chapter ${result.chapter}`,
    `path: ${result.path}`,
    '',
    result.content.trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateFeedbackResult(result: PrivateFeedbackResult): string {
  return [
    `Private Author: feedback preview ${result.book.id} chapter ${result.chapter}`,
    `pending: ${result.pendingPath}`,
    '',
    renderReviseResult(result.revise).trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateApplyResult(result: PrivateApplyResult): string {
  return [
    `Private Author: feedback applied ${result.book.id} chapter ${result.chapter}`,
    '',
    renderReviseResult(result.revise).trimEnd(),
    '',
  ].join('\n');
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() || 'book';
}

function privateBooksDir(root: string): string {
  return join(root, 'books');
}

function privateShelfPath(root: string): string {
  return join(root, 'bookshelf.json');
}

function bookDir(root: string, book: PrivateBook): string {
  return join(root, book.path);
}

async function loadPrivateShelf(root: string): Promise<PrivateShelf> {
  try {
    const parsed = JSON.parse(await readFile(privateShelfPath(root), 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.books)) {
      throw new AuthorOsError(`Invalid private bookshelf: ${privateShelfPath(root)}`);
    }
    return {
      version: 1,
      current: typeof parsed.current === 'string' ? parsed.current : null,
      books: parsed.books.map(parseBook),
    };
  } catch (error) {
    if (isMissingFileError(error)) return { version: 1, current: null, books: [] };
    if (error instanceof SyntaxError) {
      throw new AuthorOsError(`Invalid JSON in private bookshelf: ${privateShelfPath(root)}`);
    }
    throw error;
  }
}

async function savePrivateShelf(root: string, shelf: PrivateShelf): Promise<void> {
  await mkdir(root, { recursive: true });
  await mkdir(privateBooksDir(root), { recursive: true });
  await writeFile(privateShelfPath(root), `${JSON.stringify(shelf, null, 2)}\n`, 'utf8');
}

function parseBook(value: unknown): PrivateBook {
  if (!value || typeof value !== 'object') {
    throw new AuthorOsError('Invalid private book entry.');
  }
  const book = value as Record<string, unknown>;
  const id = stringField(book, 'id');
  return {
    id,
    title: stringField(book, 'title'),
    concept: stringField(book, 'concept'),
    path: stringField(book, 'path') || `books/${id}`,
    created_at: stringField(book, 'created_at'),
    last_active_at: stringField(book, 'last_active_at'),
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new AuthorOsError(`Invalid private book field: ${key}`);
  return value;
}

function currentBook(shelf: PrivateShelf): PrivateBook {
  if (!shelf.current) {
    throw new AuthorOsError('No current private book. Run `author private new --concept "<idea>"` first.');
  }
  return findBook(shelf, shelf.current);
}

function findBook(shelf: PrivateShelf, id: string): PrivateBook {
  const book = shelf.books.find((item) => item.id === id);
  if (!book) throw new AuthorOsError(`Private book not found: ${id}`);
  return book;
}

async function touchCurrentBook(root: string, shelf: PrivateShelf, book: PrivateBook, now?: Date): Promise<void> {
  book.last_active_at = (now ?? new Date()).toISOString();
  shelf.current = book.id;
  await savePrivateShelf(root, shelf);
}

function slugifyBookId(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `book-${shortHash(input)}`;
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

function uniqueBookId(base: string, shelf: PrivateShelf): string {
  const used = new Set(shelf.books.map((book) => book.id));
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${String(index).padStart(3, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new AuthorOsError(`Could not create a unique private book id for "${base}".`);
}

async function latestChapter(projectDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(join(projectDir, 'chapters'));
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new AuthorOsError('No drafted chapters yet. Run `author private continue` first.');
    }
    throw error;
  }
  const chapters = entries
    .map((entry) => entry.match(/^(\d{4})\.md$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number(value));
  if (chapters.length === 0) {
    throw new AuthorOsError('No drafted chapters yet. Run `author private continue` first.');
  }
  return Math.max(...chapters);
}

function buildPrivateFeedbackInstruction(chapter: number, text: string): string {
  return [
    `Private reader feedback for chapter ${chapter}:`,
    text,
    '',
    'Revise the chapter to address this feedback while preserving existing plot beats and the ending hook unless the feedback directly targets them.',
  ].join('\n');
}

async function ensurePrivateReviewPlaceholder(projectDir: string, chapter: number, now?: Date): Promise<void> {
  const chapterId = formatChapterNumber(chapter);
  const reviewDir = join(projectDir, 'reviews');
  const reviewPath = join(reviewDir, `${chapterId}.internal.md`);
  if (await fileExists(reviewPath)) return;
  await mkdir(reviewDir, { recursive: true });
  await writeFile(reviewPath, [
    `# Private feedback placeholder — chapter ${chapter}`,
    '',
    `generated: ${(now ?? new Date()).toISOString()}`,
    '',
    'No internal review has been run for this private-reader pass.',
    'The reader feedback is passed to revise as revision_directive and should be treated as the active trigger.',
    '',
  ].join('\n'), 'utf8');
}

async function writePendingFeedback(projectDir: string, pending: PrivatePendingFeedback): Promise<string> {
  const dir = join(projectDir, '.authoros/private');
  await mkdir(dir, { recursive: true });
  const path = pendingFeedbackPath(projectDir);
  await writeFile(path, `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
  return '.authoros/private/pending-feedback.json';
}

function pendingFeedbackPath(projectDir: string): string {
  return join(projectDir, '.authoros/private/pending-feedback.json');
}

function parsePendingFeedback(raw: string): PrivatePendingFeedback {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthorOsError('Invalid pending private feedback JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new AuthorOsError('Invalid pending private feedback.');
  }
  const value = parsed as Record<string, unknown>;
  const chapter = value.chapter;
  if (!Number.isInteger(chapter) || (chapter as number) < 1) {
    throw new AuthorOsError('Invalid pending private feedback chapter.');
  }
  return {
    book_id: stringField(value, 'book_id'),
    chapter: chapter as number,
    text: stringField(value, 'text'),
    instruction: stringField(value, 'instruction'),
    created_at: stringField(value, 'created_at'),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}
