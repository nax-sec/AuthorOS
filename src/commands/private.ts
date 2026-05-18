import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { initProject } from './init.ts';
import { renderPlanResult, createChapterPlan, type PlanResult } from './plan.ts';
import { renderWriteResult, createChapterDraft, type WriteResult } from './write.ts';
import { getProjectState, renderProjectState, type ProjectStateResult } from './state.ts';
import { renderReviseResult, reviseChapter, type ReviseResult } from './revise.ts';
import { renderSetupResult, setupFromConcept, type SetupResult } from './setup.ts';
import { readStyleBinding, type StyleProfile } from './style.ts';
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

export type PrivateStyleRewriteIntent = 'imitate_style' | 'remove_ai_voice' | 'style_polish';

export interface PrivateStyleRewriteResult {
  book: PrivateBook;
  chapter: number;
  pendingPath: string;
  profile: StyleProfile;
  revise: ReviseResult;
}

export interface PrivateStyleApplyResult {
  book: PrivateBook;
  chapter: number;
  profileId: string;
  profileName: string;
  chapterPath: string;
  draftBackupPath: string | null;
}

export interface PrivatePendingFeedback {
  book_id: string;
  chapter: number;
  text: string;
  instruction: string;
  created_at: string;
  original_hash?: string;
  preview_content?: string;
  rationale?: string;
  original_char_count?: number;
  revised_char_count?: number | null;
}

export interface PrivatePendingStyleRewrite {
  version: 1;
  book_id: string;
  chapter: number;
  profile_id: string;
  profile_name: string;
  intent: PrivateStyleRewriteIntent;
  text: string;
  instruction: string;
  created_at: string;
  original_hash: string;
  preview_content: string;
  rationale: string;
  original_char_count: number;
  revised_char_count: number | null;
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
  const chapterId = formatChapterNumber(chapter);
  const originalContent = await readFile(join(projectDir, 'chapters', `${chapterId}.md`), 'utf8');
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
  if (revise.previewContent) {
    pending.original_hash = sha256(originalContent);
    pending.preview_content = revise.previewContent;
    pending.rationale = revise.rationale;
    pending.original_char_count = revise.originalCharCount;
    pending.revised_char_count = revise.revisedCharCount;
  }
  const pendingPath = await writePendingFeedback(projectDir, pending);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, chapter, pendingPath, revise };
}

export async function applyPrivateFeedback(root: string, opts: {
  llm?: LlmClient;
  getLlm?: () => Promise<LlmClient>;
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

  if (pending.preview_content && pending.original_hash) {
    const revise = await applySavedFeedbackPreview(projectDir, pending, opts.now);
    await unlink(pendingPath);
    await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
    return { book, chapter: pending.chapter, revise };
  }

  await ensurePrivateReviewPlaceholder(projectDir, pending.chapter, opts.now);
  const llm = opts.llm ?? await opts.getLlm?.();
  if (!llm) {
    throw new AuthorOsError('Pending feedback does not include a saved preview and requires model access to apply.');
  }
  const revise = await reviseChapter(projectDir, {
    chapter: pending.chapter,
    llm,
    now: opts.now,
    write: true,
    instruction: pending.instruction,
  });
  await unlink(pendingPath);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, chapter: pending.chapter, revise };
}

async function applySavedFeedbackPreview(
  projectDir: string,
  pending: PrivatePendingFeedback,
  now?: Date,
): Promise<ReviseResult> {
  const previewContent = pending.preview_content;
  if (!previewContent || !pending.original_hash) {
    throw new AuthorOsError('Pending feedback does not include a saved preview.');
  }
  const chapterId = formatChapterNumber(pending.chapter);
  const relativeChapterPath = `chapters/${chapterId}.md`;
  const relativeBackupPath = `chapters/${chapterId}.draft.md`;
  const chapterPath = join(projectDir, relativeChapterPath);
  const currentContent = await readFile(chapterPath, 'utf8');
  if (sha256(currentContent) !== pending.original_hash) {
    throw new AuthorOsError('Current chapter has changed since the feedback preview was created. Generate a new feedback preview before applying.');
  }

  const backupPath = join(projectDir, relativeBackupPath);
  if (!await fileExists(backupPath)) {
    await mkdir(join(projectDir, chaptersDirectory()), { recursive: true });
    await copyFile(chapterPath, backupPath);
  }
  await writeFile(chapterPath, previewContent, 'utf8');
  return {
    chapter: pending.chapter,
    chapterId,
    chapterPath: relativeChapterPath,
    draftBackupPath: relativeBackupPath,
    changed: true,
    source: 'model',
    generatedAt: (now ?? new Date(pending.created_at)).toISOString(),
    rationale: pending.rationale ?? pending.text,
    originalCharCount: pending.original_char_count ?? 0,
    revisedCharCount: pending.revised_char_count ?? null,
    previewContent,
    written: true,
    contextInputs: [],
  };
}

export async function previewPrivateStyleRewrite(root: string, opts: {
  chapter?: number | 'latest';
  intent: PrivateStyleRewriteIntent;
  text?: string;
  llm: LlmClient;
  now?: Date;
}): Promise<PrivateStyleRewriteResult> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const style = await readStyleBinding(resolvedRoot, projectDir);
  if (!style) throw new AuthorOsError('No style profile bound to the current private book.');

  const chapter = opts.chapter === undefined || opts.chapter === 'latest'
    ? await latestChapter(projectDir)
    : opts.chapter;
  const chapterId = formatChapterNumber(chapter);
  const chapterPath = join(projectDir, 'chapters', `${chapterId}.md`);
  const originalContent = await readFile(chapterPath, 'utf8');
  const instruction = buildPrivateStyleRewriteInstruction(chapter, style.profile, opts.intent, opts.text ?? '');

  await ensurePrivateReviewPlaceholder(projectDir, chapter, opts.now);
  const revise = await reviseChapter(projectDir, {
    chapter,
    llm: opts.llm,
    now: opts.now,
    write: false,
    instruction,
  });
  if (!revise.previewContent) {
    throw new AuthorOsError('Style rewrite did not produce a changed preview.');
  }

  const pending: PrivatePendingStyleRewrite = {
    version: 1,
    book_id: book.id,
    chapter,
    profile_id: style.profile.id,
    profile_name: style.profile.name,
    intent: opts.intent,
    text: (opts.text ?? '').trim(),
    instruction,
    created_at: (opts.now ?? new Date()).toISOString(),
    original_hash: sha256(originalContent),
    preview_content: revise.previewContent,
    rationale: revise.rationale,
    original_char_count: revise.originalCharCount,
    revised_char_count: revise.revisedCharCount,
  };
  const pendingPath = await writePendingStyleRewrite(projectDir, pending);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return { book, chapter, pendingPath, profile: style.profile, revise };
}

export async function applyPrivateStyleRewrite(root: string, opts: {
  now?: Date;
} = {}): Promise<PrivateStyleApplyResult> {
  const resolvedRoot = resolve(root);
  const shelf = await loadPrivateShelf(resolvedRoot);
  const book = currentBook(shelf);
  const projectDir = bookDir(resolvedRoot, book);
  const pendingPath = pendingStyleRewritePath(projectDir);
  const pending = parsePendingStyleRewrite(await readFile(pendingPath, 'utf8'));
  if (pending.book_id !== book.id) {
    throw new AuthorOsError(`Pending style rewrite belongs to "${pending.book_id}", but current book is "${book.id}".`);
  }

  const chapterId = formatChapterNumber(pending.chapter);
  const relativeChapterPath = `chapters/${chapterId}.md`;
  const relativeBackupPath = `chapters/${chapterId}.draft.md`;
  const chapterPath = join(projectDir, relativeChapterPath);
  const currentContent = await readFile(chapterPath, 'utf8');
  if (sha256(currentContent) !== pending.original_hash) {
    throw new AuthorOsError('Current chapter has changed since the style rewrite preview was created. Generate a new style rewrite preview before applying.');
  }

  const backupPath = join(projectDir, relativeBackupPath);
  let draftBackupPath: string | null = null;
  if (!await fileExists(backupPath)) {
    await mkdir(join(projectDir, chaptersDirectory()), { recursive: true });
    await copyFile(chapterPath, backupPath);
    draftBackupPath = relativeBackupPath;
  } else {
    draftBackupPath = relativeBackupPath;
  }
  await writeFile(chapterPath, pending.preview_content, 'utf8');
  await unlink(pendingPath);
  await touchCurrentBook(resolvedRoot, shelf, book, opts.now);
  return {
    book,
    chapter: pending.chapter,
    profileId: pending.profile_id,
    profileName: pending.profile_name,
    chapterPath: relativeChapterPath,
    draftBackupPath,
  };
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

export function renderPrivateStyleRewriteResult(result: PrivateStyleRewriteResult): string {
  return [
    `Private Author: style rewrite preview ${result.book.id} chapter ${result.chapter}`,
    `profile: ${result.profile.name} (${result.profile.id})`,
    `pending: ${result.pendingPath}`,
    '',
    renderReviseResult(result.revise).trimEnd(),
    '',
  ].join('\n');
}

export function renderPrivateStyleApplyResult(result: PrivateStyleApplyResult): string {
  const lines = [
    `Private Author: style rewrite applied ${result.book.id} chapter ${result.chapter}`,
    `profile: ${result.profileName} (${result.profileId})`,
    `path: ${result.chapterPath}`,
  ];
  if (result.draftBackupPath) lines.push(`draft backup: ${result.draftBackupPath}`);
  lines.push('');
  return lines.join('\n');
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

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
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

function buildPrivateStyleRewriteInstruction(
  chapter: number,
  profile: StyleProfile,
  intent: PrivateStyleRewriteIntent,
  text: string,
): string {
  return [
    `Private style rewrite for chapter ${chapter}:`,
    `intent: ${intent}`,
    `style_profile: ${profile.name} (${profile.id})`,
    profile.description ? `style_description: ${profile.description}` : '',
    '',
    'style_rules:',
    ...renderStyleRules(profile),
    '',
    'author_request:',
    text.trim() || defaultStyleRewriteRequest(intent),
    '',
    'Rewrite the chapter as a preview only.',
    'Preserve plot beats, canon facts, character decisions, scene order, and ending hook.',
    'Apply only high-level style characteristics; do not copy distinctive sentences from reference text.',
    'Remove AI-like smoothness by using concrete scene evidence, uneven human cadence, and fewer generic summaries.',
  ].filter(Boolean).join('\n');
}

function renderStyleRules(profile: StyleProfile): string[] {
  return [
    ...profile.rules.sentenceRhythm.map((rule) => `- sentence rhythm: ${rule}`),
    ...profile.rules.paragraphDensity.map((rule) => `- paragraph density: ${rule}`),
    ...profile.rules.dialogue.map((rule) => `- dialogue: ${rule}`),
    ...profile.rules.narrativeDistance.map((rule) => `- narrative distance: ${rule}`),
    ...profile.rules.sensoryDetail.map((rule) => `- sensory detail: ${rule}`),
    ...profile.rules.imagery.map((rule) => `- imagery: ${rule}`),
    ...profile.rules.pacing.map((rule) => `- pacing: ${rule}`),
    ...profile.rules.avoid.map((rule) => `- avoid: ${rule}`),
    ...profile.rules.antiAiVoice.map((rule) => `- anti-AI voice: ${rule}`),
  ];
}

function defaultStyleRewriteRequest(intent: PrivateStyleRewriteIntent): string {
  if (intent === 'imitate_style') return 'Preserve the story content while moving the prose toward the bound style profile.';
  if (intent === 'remove_ai_voice') return 'Remove AI-like phrasing while preserving the chapter content.';
  return 'Polish the chapter according to the bound style profile.';
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

async function writePendingStyleRewrite(projectDir: string, pending: PrivatePendingStyleRewrite): Promise<string> {
  const dir = join(projectDir, '.authoros/private');
  await mkdir(dir, { recursive: true });
  const path = pendingStyleRewritePath(projectDir);
  await writeFile(path, `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
  return '.authoros/private/pending-style-rewrite.json';
}

function pendingStyleRewritePath(projectDir: string): string {
  return join(projectDir, '.authoros/private/pending-style-rewrite.json');
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
  const result: PrivatePendingFeedback = {
    book_id: stringField(value, 'book_id'),
    chapter: chapter as number,
    text: stringField(value, 'text'),
    instruction: stringField(value, 'instruction'),
    created_at: stringField(value, 'created_at'),
  };
  const originalHash = optionalStringField(value, 'original_hash');
  const previewContent = optionalStringField(value, 'preview_content');
  if (originalHash !== undefined || previewContent !== undefined) {
    if (!originalHash || !previewContent) {
      throw new AuthorOsError('Invalid pending private feedback preview content.');
    }
    if (!/^[a-f0-9]{64}$/.test(originalHash)) {
      throw new AuthorOsError('Invalid pending private feedback original_hash.');
    }
    result.original_hash = originalHash;
    result.preview_content = previewContent;
    result.rationale = optionalStringField(value, 'rationale') ?? '';
    const originalCharCount = value.original_char_count;
    if (originalCharCount !== undefined && !Number.isInteger(originalCharCount)) {
      throw new AuthorOsError('Invalid pending private feedback original_char_count.');
    }
    const revisedCharCount = value.revised_char_count;
    if (revisedCharCount !== undefined && revisedCharCount !== null && !Number.isInteger(revisedCharCount)) {
      throw new AuthorOsError('Invalid pending private feedback revised_char_count.');
    }
    result.original_char_count = originalCharCount as number | undefined;
    result.revised_char_count = revisedCharCount as number | null | undefined;
  }
  return result;
}

function parsePendingStyleRewrite(raw: string): PrivatePendingStyleRewrite {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthorOsError('Invalid pending style rewrite JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new AuthorOsError('Invalid pending style rewrite.');
  }
  const value = parsed as Record<string, unknown>;
  const chapter = value.chapter;
  const version = value.version;
  const revisedCharCount = value.revised_char_count;
  if (version !== 1) throw new AuthorOsError('Invalid pending style rewrite version.');
  if (!Number.isInteger(chapter) || (chapter as number) < 1) {
    throw new AuthorOsError('Invalid pending style rewrite chapter.');
  }
  if (!isStyleRewriteIntent(value.intent)) {
    throw new AuthorOsError('Invalid pending style rewrite intent.');
  }
  if (revisedCharCount !== null && !Number.isInteger(revisedCharCount)) {
    throw new AuthorOsError('Invalid pending style rewrite revised_char_count.');
  }
  const originalCharCount = value.original_char_count;
  if (!Number.isInteger(originalCharCount)) {
    throw new AuthorOsError('Invalid pending style rewrite original_char_count.');
  }
  const originalHash = stringField(value, 'original_hash');
  if (!/^[a-f0-9]{64}$/.test(originalHash)) {
    throw new AuthorOsError('Invalid pending style rewrite original_hash.');
  }
  return {
    version: 1,
    book_id: stringField(value, 'book_id'),
    chapter: chapter as number,
    profile_id: stringField(value, 'profile_id'),
    profile_name: stringField(value, 'profile_name'),
    intent: value.intent,
    text: stringField(value, 'text'),
    instruction: stringField(value, 'instruction'),
    created_at: stringField(value, 'created_at'),
    original_hash: originalHash,
    preview_content: stringField(value, 'preview_content'),
    rationale: stringField(value, 'rationale'),
    original_char_count: originalCharCount as number,
    revised_char_count: revisedCharCount as number | null,
  };
}

function isStyleRewriteIntent(value: unknown): value is PrivateStyleRewriteIntent {
  return value === 'imitate_style' || value === 'remove_ai_voice' || value === 'style_polish';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function chaptersDirectory(): string {
  return 'chapters';
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
