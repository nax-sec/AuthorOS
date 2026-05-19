import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PendingNewBook, WebAgentAction, WebAgentSession, WebAgentTurn } from './agent.ts';

interface StoredWebAgentSession {
  version: 1;
  session: WebAgentSession;
}

export function webAgentSessionPath(root: string): string {
  return join(root, '.authoros/web/session.json');
}

export function loadWebAgentSession(root: string): WebAgentSession {
  try {
    const raw = JSON.parse(readFileSync(webAgentSessionPath(root), 'utf8')) as unknown;
    return parseStoredSession(raw).session;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid web agent session JSON: ${webAgentSessionPath(root)}`);
    }
    throw error;
  }
}

export function saveWebAgentSession(root: string, session: WebAgentSession): void {
  const payload: StoredWebAgentSession = {
    version: 1,
    session: cloneSession(session),
  };
  const path = webAgentSessionPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseStoredSession(value: unknown): StoredWebAgentSession {
  if (!value || typeof value !== 'object') throw invalidSession();
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw invalidSession();
  return {
    version: 1,
    session: parseSession(record.session),
  };
}

function parseSession(value: unknown): WebAgentSession {
  if (!value || typeof value !== 'object') throw invalidSession();
  const record = value as Record<string, unknown>;
  const pending = record.pendingNewBook;
  const turns = record.turns;
  const session: WebAgentSession = {};
  if (pending !== undefined) session.pendingNewBook = parsePendingNewBook(pending);
  if (turns !== undefined) {
    if (!Array.isArray(turns)) throw invalidSession();
    session.turns = turns.map(parseTurn);
  }
  return session;
}

function parsePendingNewBook(value: unknown): PendingNewBook {
  if (!value || typeof value !== 'object') throw invalidSession();
  const record = value as Record<string, unknown>;
  const stage = record.stage;
  if (stage !== 'intake' && stage !== 'confirm') throw invalidSession();
  const seed = record.seed;
  if (typeof seed !== 'string') throw invalidSession();
  const pending: PendingNewBook = { stage, seed };
  if ('brief' in record) {
    if (typeof record.brief !== 'string') throw invalidSession();
    pending.brief = record.brief;
  }
  return pending;
}

function cloneSession(session: WebAgentSession): WebAgentSession {
  return {
    pendingNewBook: session.pendingNewBook ? { ...session.pendingNewBook } : undefined,
    turns: session.turns ? session.turns.map((turn) => ({ ...turn })) : undefined,
  };
}

function parseTurn(value: unknown): WebAgentTurn {
  if (!value || typeof value !== 'object') throw invalidSession();
  const record = value as Record<string, unknown>;
  const role = record.role;
  if (role !== 'user' && role !== 'assistant') throw invalidSession();
  const text = record.text;
  if (typeof text !== 'string') throw invalidSession();
  const turn: WebAgentTurn = { role, text };
  if ('action' in record) {
    if (!isWebAgentAction(record.action)) throw invalidSession();
    turn.action = record.action;
  }
  return turn;
}

function isWebAgentAction(value: unknown): value is WebAgentAction {
  return typeof value === 'string' && [
    'new_book_intake',
    'new_book_confirm',
    'new_book_confirmed',
    'create_book_and_continue',
    'continue_book',
    'read_chapter',
    'feedback_preview',
    'feedback_apply',
    'style_rewrite_preview',
    'style_rewrite_apply',
    'internal_review',
    'reader_sim_review',
    'chapter_decision',
    'memory_update',
    'download_current_chapter',
    'download_all_chapters',
    'status',
    'unknown',
  ].includes(value);
}

function invalidSession(): Error {
  return new Error('Invalid web agent session.');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
