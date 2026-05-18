# Personal Cockpit v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable single-user AuthorOS Web cockpit with persistent task state, current-book overview, next actions, and automatic chapter display.

**Architecture:** Keep the CLI/private bookshelf commands as the durable core. Add focused Web modules for persistent job history and cockpit overview, then expose them through thin HTTP routes consumed by the existing browser UI. Keep the Web app as one HTML file for v1 to avoid adding a static asset pipeline while still reshaping the interface.

**Tech Stack:** Node.js 24 native TypeScript execution, `node:test`, file-backed JSON metadata, existing AuthorOS private bookshelf commands, existing `src/web/server.ts` HTTP server.

---

## Scope

This plan implements `v1: Personal Cockpit Skeleton` from the design spec:

- Personal home.
- Single-book workbench shell.
- Task center with persisted job history.
- Author Assistant command routing in Web.
- Web session status area.
- Chapter completion auto-display.
- Next action recommendations.

This plan does not implement the full Writing Style Engine, memory review approval UI, native macOS resident shell, or full diff viewer. Those become separate v1.1/v1.2/v1.3 plans after this skeleton is working.

## File Structure

- Modify `src/web/jobs.ts`
  - Keep the existing in-memory job lifecycle API.
  - Add job listing, initial hydration, and a persistence callback.

- Create `src/web/job-persistence.ts`
  - Own the file format for Web job history at `<root>/.authoros/web/jobs.json`.
  - Load and save a bounded list of recent jobs.

- Create `src/web/cockpit.ts`
  - Build the personal cockpit overview from bookshelf state, project state, model config, pending feedback, and job history.
  - Derive a simple next action.

- Modify `src/web/server.ts`
  - Create one persistent job store per root or room root.
  - Add `GET /api/jobs`.
  - Add `GET /api/cockpit`.
  - Keep room root and token isolation intact.

- Modify `src/web/public/app.html`
  - Replace the current three-column MVP with a cockpit layout.
  - Add session status, next action, current chapter reader, task center, and assistant chat.
  - Automatically load the latest chapter when writing jobs complete.

- Modify `tests/web-jobs.test.ts`
  - Cover job listing, hydration, and change notifications.

- Create `tests/web-job-persistence.test.ts`
  - Cover job history load/save behavior.

- Create `tests/web-cockpit.test.ts`
  - Cover overview derivation with no books, with a current book, pending feedback, model status, and job history.

- Modify `tests/web-server.test.ts`
  - Cover `/api/jobs`, `/api/cockpit`, persistence across server instances, and room isolation for cockpit data.

- Create `tests/web-app-html.test.ts`
  - Smoke-test that the cockpit shell contains the expected sections and client-side API hooks.

---

### Task 1: Make `JobStore` Listable And Hydratable

**Files:**
- Modify: `src/web/jobs.ts`
- Modify: `tests/web-jobs.test.ts`

- [ ] **Step 1: Add failing tests for listing, hydration, and persistence callbacks**

Append these tests to `tests/web-jobs.test.ts`:

```ts
test('job store lists newest jobs first', () => {
  const dates = [
    new Date('2026-05-14T10:00:00Z'),
    new Date('2026-05-14T10:01:00Z'),
    new Date('2026-05-14T10:02:00Z'),
  ];
  let index = 0;
  const jobs = createJobStore({ now: () => dates[index++] ?? dates.at(-1)! });

  const first = jobs.createJob('continue_book', '开始写下一章');
  const second = jobs.createJob('feedback_preview', '生成修改预览');

  assert.deepEqual(jobs.list().map((job) => job.id), [second.id, first.id]);
});

test('job store hydrates existing jobs and continues ids', () => {
  const jobs = createJobStore({
    now: () => new Date('2026-05-14T11:00:00Z'),
    initialJobs: [{
      id: 'job-7',
      action: 'continue_book',
      status: 'completed',
      createdAt: '2026-05-14T10:00:00.000Z',
      updatedAt: '2026-05-14T10:05:00.000Z',
      events: [{
        type: 'completed',
        message: '完成',
        at: '2026-05-14T10:05:00.000Z',
      }],
      result: { chapter: 1 },
    }],
  });

  const next = jobs.createJob('read_chapter', '读取最新章');

  assert.equal(next.id, 'job-8');
  assert.equal(jobs.get('job-7')?.status, 'completed');
});

test('job store calls onChange after mutations', () => {
  const snapshots: string[][] = [];
  const jobs = createJobStore({
    now: () => new Date('2026-05-14T10:00:00Z'),
    onChange: (items) => snapshots.push(items.map((job) => `${job.id}:${job.status}`)),
  });

  const job = jobs.createJob('continue_book', '开始写下一章');
  jobs.complete(job.id, { chapter: 1 });

  assert.deepEqual(snapshots, [
    ['job-1:running'],
    ['job-1:completed'],
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-jobs.test.ts
```

Expected: fail with errors that `jobs.list`, `initialJobs`, and `onChange` do not exist.

- [ ] **Step 3: Extend the `JobStore` interface and options**

In `src/web/jobs.ts`, replace the current `JobStore` interface and `createJobStore` signature with:

```ts
export interface JobStore {
  createJob(action: string, message: string): WebJob;
  append(id: string, type: string, message: string, data?: unknown): WebJob;
  complete(id: string, result?: unknown): WebJob;
  fail(id: string, message: string): WebJob;
  get(id: string): WebJob | undefined;
  list(): WebJob[];
  listEvents(id: string, after?: number): WebJobEvent[];
  subscribe(id: string, listener: (event: WebJobEvent) => void): () => void;
}

export interface CreateJobStoreOptions {
  now?: () => Date;
  initialJobs?: WebJob[];
  onChange?: (jobs: WebJob[]) => void;
}

export function createJobStore(opts: CreateJobStoreOptions = {}): JobStore {
```

- [ ] **Step 4: Hydrate initial jobs and continue numeric ids**

Inside `createJobStore`, replace the current map and `nextId` initialization with:

```ts
  const jobs = new Map<string, WebJob>();
  const listeners = new Map<string, Set<(event: WebJobEvent) => void>>();
  let nextId = 1;

  for (const job of opts.initialJobs ?? []) {
    jobs.set(job.id, cloneJob(job));
    const match = job.id.match(/^job-(\d+)$/);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }
```

Add this helper near the bottom of `src/web/jobs.ts`:

```ts
function cloneJob(job: WebJob): WebJob {
  return {
    ...job,
    events: job.events.map((event) => ({ ...event })),
  };
}
```

- [ ] **Step 5: Add persistence notifications**

Inside `createJobStore`, add:

```ts
  function snapshot(): WebJob[] {
    return [...jobs.values()].map(cloneJob);
  }

  function notifyChange(): void {
    opts.onChange?.(snapshot());
  }
```

Call `notifyChange()` after each state-changing operation:

```ts
    createJob(action, message) {
      const at = timestamp();
      const job: WebJob = {
        id: `job-${nextId++}`,
        action,
        status: 'running',
        createdAt: at,
        updatedAt: at,
        events: [],
      };
      jobs.set(job.id, job);
      push(job, 'received', message);
      notifyChange();
      return job;
    },
    append(id, type, message, data) {
      const job = push(requireJob(id), type, message, data);
      notifyChange();
      return job;
    },
    complete(id, result) {
      const job = requireJob(id);
      job.status = 'completed';
      job.result = result;
      push(job, 'completed', '完成', result);
      notifyChange();
      return job;
    },
    fail(id, message) {
      const job = requireJob(id);
      job.status = 'failed';
      job.error = message;
      push(job, 'failed', message);
      notifyChange();
      return job;
    },
    get(id) {
      const job = jobs.get(id);
      return job ? cloneJob(job) : undefined;
    },
    list() {
      return snapshot().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
node --test tests/web-jobs.test.ts
```

Expected: all `tests/web-jobs.test.ts` tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/jobs.ts tests/web-jobs.test.ts
git commit -m "feat: make web jobs listable and hydratable"
```

---

### Task 2: Add File-Backed Web Job History

**Files:**
- Create: `src/web/job-persistence.ts`
- Create: `tests/web-job-persistence.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

Create `tests/web-job-persistence.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWebJobHistory, saveWebJobHistory, webJobHistoryPath } from '../src/web/job-persistence.ts';
import type { WebJob } from '../src/web/jobs.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-web-jobs-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function job(id: string, createdAt: string): WebJob {
  return {
    id,
    action: 'continue_book',
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    events: [{ type: 'completed', message: '完成', at: createdAt }],
    result: { chapter: Number(id.replace('job-', '')) },
  };
}

test('web job history returns empty when missing', async () => {
  await withTempRoot(async (root) => {
    assert.deepEqual(loadWebJobHistory(root), []);
  });
});

test('web job history saves and loads recent jobs', async () => {
  await withTempRoot(async (root) => {
    saveWebJobHistory(root, [
      job('job-1', '2026-05-14T10:00:00.000Z'),
      job('job-2', '2026-05-14T11:00:00.000Z'),
    ]);

    assert.deepEqual(loadWebJobHistory(root).map((item) => item.id), ['job-1', 'job-2']);
    const raw = JSON.parse(await readFile(webJobHistoryPath(root), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.jobs.length, 2);
  });
});

test('web job history keeps only the newest limit by creation time', async () => {
  await withTempRoot(async (root) => {
    saveWebJobHistory(root, [
      job('job-1', '2026-05-14T10:00:00.000Z'),
      job('job-2', '2026-05-14T11:00:00.000Z'),
      job('job-3', '2026-05-14T12:00:00.000Z'),
    ], 2);

    assert.deepEqual(loadWebJobHistory(root).map((item) => item.id), ['job-2', 'job-3']);
  });
});

test('web job history rejects invalid json shape', async () => {
  await withTempRoot(async (root) => {
    const path = webJobHistoryPath(root);
    await writeFile(path, JSON.stringify({ version: 1, jobs: [{ id: 7 }] }), 'utf8');

    assert.throws(() => loadWebJobHistory(root), /Invalid web job history/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-job-persistence.test.ts
```

Expected: fail because `src/web/job-persistence.ts` does not exist.

- [ ] **Step 3: Implement job persistence**

Create `src/web/job-persistence.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WebJob, WebJobEvent, WebJobStatus } from './jobs.ts';

interface StoredWebJobHistory {
  version: 1;
  jobs: WebJob[];
}

const defaultLimit = 50;

export function webJobHistoryPath(root: string): string {
  return join(root, '.authoros/web/jobs.json');
}

export function loadWebJobHistory(root: string): WebJob[] {
  try {
    const raw = JSON.parse(readFileSync(webJobHistoryPath(root), 'utf8')) as unknown;
    return parseHistory(raw).jobs;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid web job history JSON: ${webJobHistoryPath(root)}`);
    }
    throw error;
  }
}

export function saveWebJobHistory(root: string, jobs: readonly WebJob[], limit = defaultLimit): void {
  const sorted = [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = sorted.slice(Math.max(0, sorted.length - limit));
  const payload: StoredWebJobHistory = {
    version: 1,
    jobs: recent.map(cloneJob),
  };
  const path = webJobHistoryPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseHistory(value: unknown): StoredWebJobHistory {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.jobs)) throw invalidHistory();
  return {
    version: 1,
    jobs: record.jobs.map(parseJob),
  };
}

function parseJob(value: unknown): WebJob {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  const status = parseStatus(record.status);
  const events = record.events;
  if (!Array.isArray(events)) throw invalidHistory();
  const job: WebJob = {
    id: stringField(record, 'id'),
    action: stringField(record, 'action'),
    status,
    createdAt: stringField(record, 'createdAt'),
    updatedAt: stringField(record, 'updatedAt'),
    events: events.map(parseEvent),
  };
  if ('result' in record) job.result = record.result;
  if (typeof record.error === 'string') job.error = record.error;
  return job;
}

function parseEvent(value: unknown): WebJobEvent {
  if (!value || typeof value !== 'object') throw invalidHistory();
  const record = value as Record<string, unknown>;
  const event: WebJobEvent = {
    type: stringField(record, 'type'),
    message: stringField(record, 'message'),
    at: stringField(record, 'at'),
  };
  if ('data' in record) event.data = record.data;
  return event;
}

function parseStatus(value: unknown): WebJobStatus {
  if (value === 'running' || value === 'completed' || value === 'failed') return value;
  throw invalidHistory();
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw invalidHistory();
  return value;
}

function cloneJob(job: WebJob): WebJob {
  return {
    ...job,
    events: job.events.map((event) => ({ ...event })),
  };
}

function invalidHistory(): Error {
  return new Error('Invalid web job history.');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test tests/web-job-persistence.test.ts
```

Expected: all `tests/web-job-persistence.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/job-persistence.ts tests/web-job-persistence.test.ts
git commit -m "feat: persist web job history"
```

---

### Task 3: Wire Persistent Job Stores Into The Web Server

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add failing server tests for job listing and persistence**

Append these tests to `tests/web-server.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-web-server-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('web server exposes job history', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      agentMode: 'rule',
      env: {},
    });

    const chat = await server.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '读最新章' }),
    }));
    assert.equal(chat.status, 200);

    const jobs = await server.fetch(new Request('http://local/api/jobs'));
    const body = await jobs.json();

    assert.equal(jobs.status, 200);
    assert.equal(body.jobs.length, 1);
    assert.equal(body.jobs[0].action, 'read_chapter');
  });
});

test('web server persists job history across server instances', async () => {
  await withTempRoot(async (root) => {
    const first = createWebServer({ root, agentMode: 'rule', env: {} });
    await first.fetch(new Request('http://local/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '继续写' }),
    }));

    const second = createWebServer({ root, agentMode: 'rule', env: {} });
    const response = await second.fetch(new Request('http://local/api/jobs'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.jobs[0].action, 'continue_book');
  });
});

test('web server keeps room job history isolated', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
      agentMode: 'rule',
    });

    await server.fetch(new Request('http://local/room/room1/api/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer 1' },
      body: JSON.stringify({ message: '读最新章' }),
    }));

    const room1 = await server.fetch(new Request('http://local/room/room1/api/jobs', {
      headers: { authorization: 'Bearer 1' },
    }));
    const room2 = await server.fetch(new Request('http://local/room/room2/api/jobs', {
      headers: { authorization: 'Bearer 2' },
    }));

    assert.equal((await room1.json()).jobs.length, 1);
    assert.equal((await room2.json()).jobs.length, 0);
  });
});
```

If duplicate imports conflict with existing imports, merge them at the top of `tests/web-server.test.ts`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: fail because `/api/jobs` is not implemented and job history is not persisted.

- [ ] **Step 3: Import job persistence in the server**

In `src/web/server.ts`, add:

```ts
import { loadWebJobHistory, saveWebJobHistory } from './job-persistence.ts';
```

- [ ] **Step 4: Replace runtime creation with root-aware persisted runtimes**

In `src/web/server.ts`, replace:

```ts
  const singleRuntime: WebRuntime = { session: createWebAgentSession(), jobs: createJobStore() };
  const roomRuntimes = new Map<string, WebRuntime>();
```

with:

```ts
  const singleRuntime = createRuntimeForRoot(options.root);
  const roomRuntimes = new Map<string, WebRuntime>();
```

Replace `runtimeForRoom` with:

```ts
function createRuntimeForRoot(root: string): WebRuntime {
  return {
    session: createWebAgentSession(),
    jobs: createJobStore({
      initialJobs: loadWebJobHistory(root),
      onChange: (jobs) => saveWebJobHistory(root, jobs),
    }),
  };
}

function runtimeForRoom(runtimes: Map<string, WebRuntime>, room: WebRoom): WebRuntime {
  const existing = runtimes.get(room.id);
  if (existing) return existing;
  const runtime = createRuntimeForRoot(room.root);
  runtimes.set(room.id, runtime);
  return runtime;
}
```

Update the runtime lookup inside `fetchHandler` from:

```ts
      const runtime = roomRoute?.room ? runtimeForRoom(roomRuntimes, roomRoute.room.id) : singleRuntime;
```

to:

```ts
      const runtime = roomRoute?.room ? runtimeForRoom(roomRuntimes, roomRoute.room) : singleRuntime;
```

- [ ] **Step 5: Add the jobs route**

In `fetchHandler`, after the `/api/status` route and before `/api/chat`, add:

```ts
      if (routePath === '/api/jobs' && request.method === 'GET') {
        return json({ jobs: runtime.jobs.list() });
      }
```

- [ ] **Step 6: Run the focused server test**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: all `tests/web-server.test.ts` tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/server.ts tests/web-server.test.ts
git commit -m "feat: expose persisted web job history"
```

---

### Task 4: Build The Cockpit Overview Module

**Files:**
- Create: `src/web/cockpit.ts`
- Create: `tests/web-cockpit.test.ts`

- [ ] **Step 1: Write failing cockpit overview tests**

Create `tests/web-cockpit.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCockpitOverview } from '../src/web/cockpit.ts';
import { createJobStore } from '../src/web/jobs.ts';

async function withTempRoot(body: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-cockpit-'));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeBook(root: string): Promise<void> {
  await mkdir(join(root, 'books/demo/chapters'), { recursive: true });
  await mkdir(join(root, 'books/demo/plans'), { recursive: true });
  await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
    version: 1,
    current: 'demo',
    books: [{
      id: 'demo',
      title: 'Demo Book',
      concept: 'A private test book.',
      path: 'books/demo',
      created_at: '2026-05-14T00:00:00.000Z',
      last_active_at: '2026-05-14T01:00:00.000Z',
    }],
  }, null, 2), 'utf8');
  await writeFile(join(root, 'books/demo/plans/0001.md'), 'plan', 'utf8');
  await writeFile(join(root, 'books/demo/chapters/0001.md'), 'chapter one body', 'utf8');
}

test('cockpit overview handles an empty bookshelf', async () => {
  await withTempRoot(async (root) => {
    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current, null);
    assert.equal(overview.nextAction.kind, 'new_book');
    assert.equal(overview.books.length, 0);
  });
});

test('cockpit overview reports current book latest chapter and model status', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-14T02:00:00Z') });
    const job = jobs.createJob('continue_book', '开始写下一章');
    jobs.complete(job.id, { chapter: 1 });

    const overview = await getCockpitOverview(root, {
      OPENAI_API_KEY: 'key',
      AUTHOROS_MODEL: 'gpt-test',
    }, jobs);

    assert.equal(overview.current?.book.title, 'Demo Book');
    assert.equal(overview.current?.latestChapter?.chapter, 1);
    assert.equal(overview.current?.latestChapter?.excerpt, 'chapter one body');
    assert.equal(overview.model.apiKeySet, true);
    assert.equal(overview.model.model, 'gpt-test');
    assert.equal(overview.jobs[0].id, job.id);
    assert.equal(overview.nextAction.kind, 'continue_book');
  });
});

test('cockpit overview detects pending feedback', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/private/pending-feedback.json'), JSON.stringify({
      book_id: 'demo',
      chapter: 1,
      text: 'make it sharper',
      instruction: 'revise',
      created_at: '2026-05-14T03:00:00.000Z',
    }), 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.current?.pendingFeedback, true);
    assert.equal(overview.nextAction.kind, 'apply_feedback');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: fail because `src/web/cockpit.ts` does not exist.

- [ ] **Step 3: Implement cockpit overview**

Create `src/web/cockpit.ts`:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPrivateStatus, listPrivateBooks, readPrivateChapter, type PrivateBook } from '../commands/private.ts';
import { resolveProjectModelConfig, type EnvLike, type ResolvedProjectModelConfig } from '../core/modelConfig.ts';
import type { ProjectStateResult } from '../commands/state.ts';
import type { JobStore, WebJob } from './jobs.ts';

export interface CockpitOverview {
  books: Array<Pick<PrivateBook, 'id' | 'title' | 'concept' | 'path' | 'last_active_at'>>;
  current: {
    book: PrivateBook;
    state: ProjectStateResult;
    latestChapter: { chapter: number; path: string; excerpt: string } | null;
    pendingFeedback: boolean;
  } | null;
  jobs: WebJob[];
  model: Pick<ResolvedProjectModelConfig, 'apiKeyEnv' | 'apiKeySet' | 'baseUrl' | 'model'>;
  nextAction: CockpitNextAction;
}

export type CockpitNextAction =
  | { kind: 'new_book'; label: string; message: string }
  | { kind: 'apply_feedback'; label: string; message: string }
  | { kind: 'continue_book'; label: string; message: string; chapter: number }
  | { kind: 'read_latest'; label: string; message: string; chapter: number };

export async function getCockpitOverview(
  root: string,
  env: EnvLike,
  jobs: JobStore,
): Promise<CockpitOverview> {
  const shelf = await listPrivateBooks(root);
  const model = await resolveProjectModelConfig(root, env);
  if (!shelf.current) {
    return {
      books: shelf.books.map(bookSummary),
      current: null,
      jobs: jobs.list(),
      model: modelSummary(model),
      nextAction: {
        kind: 'new_book',
        label: '开一本新书',
        message: '我想开一本新书',
      },
    };
  }

  const status = await getPrivateStatus(root);
  const latestChapter = await tryLatestChapter(root);
  const pendingFeedback = await fileExists(join(root, status.book.path, '.authoros/private/pending-feedback.json'));
  return {
    books: shelf.books.map(bookSummary),
    current: {
      book: status.book,
      state: status.state,
      latestChapter,
      pendingFeedback,
    },
    jobs: jobs.list(),
    model: modelSummary(model),
    nextAction: deriveNextAction(status.state, latestChapter?.chapter ?? null, pendingFeedback),
  };
}

function bookSummary(book: PrivateBook): CockpitOverview['books'][number] {
  return {
    id: book.id,
    title: book.title,
    concept: book.concept,
    path: book.path,
    last_active_at: book.last_active_at,
  };
}

function modelSummary(model: ResolvedProjectModelConfig): CockpitOverview['model'] {
  return {
    apiKeyEnv: model.apiKeyEnv,
    apiKeySet: model.apiKeySet,
    baseUrl: model.baseUrl,
    model: model.model,
  };
}

async function tryLatestChapter(root: string): Promise<CockpitOverview['current']['latestChapter']> {
  try {
    const latest = await readPrivateChapter(root, { chapter: 'latest' });
    return {
      chapter: latest.chapter,
      path: latest.path,
      excerpt: latest.content.trim().slice(0, 800),
    };
  } catch (error) {
    if (error instanceof Error && /No drafted chapters yet/.test(error.message)) return null;
    throw error;
  }
}

function deriveNextAction(
  state: ProjectStateResult,
  latestChapter: number | null,
  pendingFeedback: boolean,
): CockpitNextAction {
  if (pendingFeedback) {
    return {
      kind: 'apply_feedback',
      label: '处理待确认修改',
      message: '确认应用修改',
    };
  }
  if (latestChapter !== null) {
    const next = Math.max(state.nextDraftChapter, latestChapter + 1);
    return {
      kind: 'continue_book',
      label: `继续写第 ${next} 章`,
      message: '继续写',
      chapter: next,
    };
  }
  return {
    kind: 'continue_book',
    label: '写第 1 章',
    message: '继续写',
    chapter: 1,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: all `tests/web-cockpit.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/cockpit.ts tests/web-cockpit.test.ts
git commit -m "feat: add personal cockpit overview"
```

---

### Task 5: Expose The Cockpit API

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add failing server tests for `/api/cockpit`**

Append this test to `tests/web-server.test.ts`:

```ts
test('web server exposes cockpit overview', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { OPENAI_API_KEY: 'key', AUTHOROS_MODEL: 'gpt-test' },
    });

    const response = await server.fetch(new Request('http://local/api/cockpit'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.current, null);
    assert.equal(body.nextAction.kind, 'new_book');
    assert.equal(body.model.apiKeySet, true);
    assert.equal(body.model.model, 'gpt-test');
  });
});

test('web server keeps room cockpit overview isolated', async () => {
  await withTempRoot(async (root) => {
    const server = createWebServer({
      root,
      env: { AUTHOROS_WEB_ROOMS: '1,2' },
    });

    const ok = await server.fetch(new Request('http://local/room/room1/api/cockpit', {
      headers: { authorization: 'Bearer 1' },
    }));
    const wrongToken = await server.fetch(new Request('http://local/room/room1/api/cockpit', {
      headers: { authorization: 'Bearer 2' },
    }));

    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).nextAction.kind, 'new_book');
    assert.equal(wrongToken.status, 401);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: fail because `/api/cockpit` is not implemented.

- [ ] **Step 3: Import and route cockpit overview**

In `src/web/server.ts`, add:

```ts
import { getCockpitOverview } from './cockpit.ts';
```

Inside `fetchHandler`, after `/api/status` and before `/api/jobs`, add:

```ts
      if (routePath === '/api/cockpit' && request.method === 'GET') {
        return json(await getCockpitOverview(root, env, runtime.jobs));
      }
```

- [ ] **Step 4: Run the focused server test**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: all `tests/web-server.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts tests/web-server.test.ts
git commit -m "feat: expose personal cockpit api"
```

---

### Task 6: Add Cockpit Shell Smoke Tests

**Files:**
- Create: `tests/web-app-html.test.ts`
- Modify: `src/web/public/app.html`

- [ ] **Step 1: Write the failing HTML smoke test**

Create `tests/web-app-html.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appPath = new URL('../src/web/public/app.html', import.meta.url);

test('private web app exposes personal cockpit regions', async () => {
  const html = await readFile(appPath, 'utf8');

  assert.match(html, /AuthorOS Personal Cockpit/);
  assert.match(html, /data-testid="session-status"/);
  assert.match(html, /data-testid="next-action"/);
  assert.match(html, /data-testid="task-center"/);
  assert.match(html, /data-testid="chapter-reader"/);
  assert.match(html, /data-testid="assistant-chat"/);
  assert.match(html, /loadCockpit/);
  assert.match(html, /watchJob/);
  assert.match(html, /loadLatestChapter/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail because the current HTML still uses `AuthorOS Private Web` and lacks cockpit regions.

- [ ] **Step 3: Replace the page title and major regions**

In `src/web/public/app.html`, update:

```html
<title>AuthorOS Personal Cockpit</title>
```

Replace the `<header>` and `<main>` body structure with this v1 shell:

```html
  <header>
    <div>
      <h1>AuthorOS Personal Cockpit</h1>
      <span class="muted">本机私人 AI 作者</span>
    </div>
    <div id="sessionStatus" data-testid="session-status" class="status-pill">启动中</div>
  </header>
  <main class="cockpit">
    <aside class="sidebar">
      <section class="panel">
        <h2>书架</h2>
        <div id="books" class="stack muted">加载中...</div>
      </section>
      <section class="panel">
        <h2>下一步</h2>
        <button id="nextAction" data-testid="next-action" class="primary-wide">加载中</button>
        <p id="nextActionHint" class="muted">等待工作台状态。</p>
      </section>
    </aside>

    <section class="workspace">
      <div class="panel hero-panel">
        <div class="row between">
          <div>
            <h2 id="currentBookTitle">当前创作现场</h2>
            <p id="currentBookMeta" class="muted">还没有当前书。</p>
          </div>
          <button class="secondary" id="refresh">刷新</button>
        </div>
      </div>

      <div class="panel">
        <div class="row between">
          <h2>当前章节</h2>
          <div class="row compact">
            <button class="secondary" id="readLatest">读最新章</button>
            <button class="secondary" id="downloadChapter">下载当前章</button>
            <button class="secondary" id="downloadAll">下载全部</button>
          </div>
        </div>
        <article id="chapter" data-testid="chapter-reader" class="chapter-reader">还没有读取章节。</article>
      </div>
    </section>

    <aside class="assistant">
      <section class="panel">
        <h2>作者助理</h2>
        <div id="chatLog" data-testid="assistant-chat"></div>
        <div class="stack">
          <textarea id="message" placeholder="继续写、读最新章、开新书，或说哪里要改"></textarea>
          <button id="send">发送</button>
        </div>
      </section>

      <section class="panel">
        <h2>任务中心</h2>
        <div id="taskCenter" data-testid="task-center" class="stack muted">等待任务。</div>
      </section>
    </aside>
  </main>
```

- [ ] **Step 4: Replace the CSS with cockpit layout styles**

Replace the existing `<style>` block with:

```css
    :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f8; color: #1d2430; }
    header { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; border-bottom: 1px solid #d9dee7; background: #ffffff; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    h2 { font-size: 15px; margin: 0 0 12px; }
    button, input, textarea { font: inherit; }
    button { border: 1px solid #1f5eff; background: #1f5eff; color: white; border-radius: 7px; padding: 8px 12px; cursor: pointer; }
    button.secondary { background: #fff; color: #1d2430; border-color: #b9c2d0; }
    button.primary-wide { width: 100%; text-align: left; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    textarea { width: 100%; min-height: 84px; resize: vertical; border: 1px solid #b9c2d0; border-radius: 8px; padding: 10px; }
    .cockpit { display: grid; grid-template-columns: 270px minmax(0, 1fr) 340px; gap: 14px; padding: 14px; min-height: calc(100vh - 65px); }
    .sidebar, .assistant, .workspace { display: grid; align-content: start; gap: 14px; min-width: 0; }
    .panel { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; min-width: 0; }
    .hero-panel { border-left: 4px solid #1f5eff; }
    .row { display: flex; gap: 8px; align-items: center; }
    .row.between { justify-content: space-between; align-items: flex-start; }
    .row.compact { flex-wrap: wrap; justify-content: flex-end; }
    .stack { display: grid; gap: 10px; }
    .muted { color: #667085; font-size: 13px; }
    .status-pill { border: 1px solid #d9dee7; background: #f8fafc; border-radius: 999px; padding: 6px 10px; font-size: 13px; color: #344054; }
    #chatLog { min-height: 260px; max-height: 42vh; overflow: auto; display: flex; flex-direction: column; gap: 10px; white-space: pre-wrap; }
    .msg { padding: 10px 12px; border-radius: 8px; background: #fff; border: 1px solid #d9dee7; }
    .me { background: #eaf2ff; }
    .chapter-reader { white-space: pre-wrap; line-height: 1.8; min-height: 58vh; max-height: 72vh; overflow: auto; background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 18px; }
    .job { border: 1px solid #d9dee7; border-radius: 8px; padding: 10px; background: #fbfcfe; }
    .job strong { display: block; margin-bottom: 4px; }
    @media (max-width: 1100px) { .cockpit { grid-template-columns: 1fr; } .chapter-reader { min-height: 360px; } }
```

- [ ] **Step 5: Run the HTML smoke test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: the test still fails because the required functions are not yet present.

- [ ] **Step 6: Commit the shell after the next task, not now**

Do not commit this task alone. Task 7 adds the required script behavior and commits the HTML as a complete cockpit shell.

---

### Task 7: Implement Cockpit Client Behavior

**Files:**
- Modify: `src/web/public/app.html`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Add client hook expectations**

Add these assertions to `tests/web-app-html.test.ts`:

```ts
  assert.match(html, /api\('\/api\/cockpit'\)/);
  assert.match(html, /api\('\/api\/jobs'\)/);
  assert.match(html, /EventSource/);
  assert.match(html, /completed/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail until the script calls `/api/cockpit`, `/api/jobs`, and handles completed jobs.

- [ ] **Step 3: Replace the script block with cockpit behavior**

Replace the existing `<script>` block in `src/web/public/app.html` with:

```html
  <script>
    const chatLog = document.querySelector('#chatLog');
    const taskCenter = document.querySelector('#taskCenter');
    const chapter = document.querySelector('#chapter');
    const books = document.querySelector('#books');
    const sessionStatus = document.querySelector('#sessionStatus');
    const nextAction = document.querySelector('#nextAction');
    const nextActionHint = document.querySelector('#nextActionHint');
    const currentBookTitle = document.querySelector('#currentBookTitle');
    const currentBookMeta = document.querySelector('#currentBookMeta');
    const roomPrefix = (location.pathname.match(/^\/room\/[^/]+/) || [''])[0];
    const tokenKey = `authoros_token:${roomPrefix || 'single'}`;
    let token = sessionStorage.getItem(tokenKey) || '';
    let cockpit = null;

    function headers() {
      return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    }

    function addMessage(text, own = false) {
      const div = document.createElement('div');
      div.className = `msg${own ? ' me' : ''}`;
      div.textContent = text;
      chatLog.appendChild(div);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function api(path, options = {}) {
      const response = await fetch(`${roomPrefix}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      if (!response.ok) throw new Error((await response.json()).error || response.statusText);
      return response.json();
    }

    async function loginIfNeeded() {
      const session = await fetch('/api/session').then(response => response.json());
      if (!session.tokenRequired) return true;
      token = sessionStorage.getItem(tokenKey) || prompt('访问码（如果没有配置可留空）') || '';
      if (!token) return false;
      if (session.rooms && !roomPrefix) {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          alert((await response.json()).error || 'invalid access code');
          sessionStorage.removeItem(tokenKey);
          location.reload();
          return false;
        }
        const result = await response.json();
        sessionStorage.setItem(`authoros_token:${result.roomPath}`, token);
        location.href = result.roomPath;
        return false;
      }
      sessionStorage.setItem(tokenKey, token);
      return true;
    }

    async function loadCockpit() {
      cockpit = await api('/api/cockpit');
      renderCockpit(cockpit);
      renderJobs(cockpit.jobs || []);
      if (cockpit.current?.latestChapter) {
        await loadLatestChapter(false);
      }
    }

    function renderCockpit(data) {
      sessionStatus.textContent = data.model.apiKeySet && data.model.model
        ? `模型就绪：${data.model.model}`
        : `模型未就绪：${data.model.apiKeyEnv}`;
      books.textContent = data.books.length
        ? data.books.map(book => `${data.current?.book.id === book.id ? '* ' : '  '}${book.title} (${book.id})`).join('\n')
        : '还没有书。';
      currentBookTitle.textContent = data.current ? data.current.book.title : '当前创作现场';
      currentBookMeta.textContent = data.current
        ? `当前书：${data.current.book.id} · ${data.current.pendingFeedback ? '有待确认修改' : '无待确认修改'}`
        : '还没有当前书。可以让作者助理开一本新书。';
      nextAction.textContent = data.nextAction.label;
      nextAction.dataset.message = data.nextAction.message;
      nextAction.disabled = false;
      nextActionHint.textContent = data.current?.latestChapter
        ? `最新章：第 ${data.current.latestChapter.chapter} 章`
        : '点击后会把指令发送给作者助理。';
    }

    async function refreshJobs() {
      const result = await api('/api/jobs');
      renderJobs(result.jobs || []);
    }

    function renderJobs(jobs) {
      if (!jobs.length) {
        taskCenter.textContent = '还没有任务。';
        return;
      }
      taskCenter.innerHTML = '';
      for (const job of jobs.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'job';
        const last = job.events[job.events.length - 1];
        item.innerHTML = `<strong>${job.action} · ${job.status}</strong><span>${last ? last.message : job.createdAt}</span>`;
        taskCenter.appendChild(item);
      }
    }

    async function sendMessage(message) {
      if (!message.trim()) return;
      addMessage(message, true);
      const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
      addMessage(result.message);
      if (result.jobId) watchJob(result.jobId);
      await refreshJobs();
    }

    async function send() {
      const input = document.querySelector('#message');
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      try {
        await sendMessage(message);
      } catch (error) {
        addMessage(`失败：${error.message}`);
      }
    }

    async function loadLatestChapter(showErrors = true) {
      try {
        const result = await api('/api/chapters/latest');
        chapter.textContent = result.content || '这一章没有内容。';
      } catch (error) {
        if (showErrors) chapter.textContent = `读取失败：${error.message}`;
      }
    }

    function watchJob(id) {
      const events = new EventSource(`${roomPrefix}/api/jobs/${id}/events?token=${encodeURIComponent(token)}`);
      events.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await refreshJobs().catch(() => {});
        if (data.type === 'completed' || data.type === 'failed') {
          events.close();
          await loadCockpit().catch(() => {});
          if (data.type === 'completed') await loadLatestChapter(false);
        }
      };
    }

    document.querySelector('#send').addEventListener('click', send);
    document.querySelector('#message').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
    });
    document.querySelector('#nextAction').addEventListener('click', () => sendMessage(nextAction.dataset.message || '状态'));
    document.querySelector('#refresh').addEventListener('click', () => loadCockpit().catch(error => { sessionStatus.textContent = `刷新失败：${error.message}`; }));
    document.querySelector('#readLatest').addEventListener('click', () => loadLatestChapter(true));
    document.querySelector('#downloadChapter').addEventListener('click', () => location.href = `${roomPrefix}/download/chapter/latest?token=${encodeURIComponent(token)}`);
    document.querySelector('#downloadAll').addEventListener('click', () => location.href = `${roomPrefix}/download/chapters.zip?token=${encodeURIComponent(token)}`);

    loginIfNeeded()
      .then((ready) => ready ? loadCockpit() : undefined)
      .catch(error => {
        sessionStatus.textContent = `加载失败：${error.message}`;
        books.textContent = `加载失败：${error.message}`;
      });
  </script>
```

- [ ] **Step 4: Run the HTML smoke test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: `tests/web-app-html.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add src/web/public/app.html tests/web-app-html.test.ts
git commit -m "feat: add personal cockpit web shell"
```

---

### Task 8: Browser Smoke Test The Cockpit

**Files:**
- No source edits expected.

- [ ] **Step 1: Start the local Web server**

Run:

```bash
AUTHOROS_PRIVATE_ROOT="$PWD/tmp/cockpit-smoke" AUTHOROS_WEB_AGENT=rule node src/cli.ts web --root "$PWD/tmp/cockpit-smoke" --port 8787
```

Expected output includes:

```text
AuthorOS web listening: http://127.0.0.1:8787
```

Keep this server running until the browser checks finish.

- [ ] **Step 2: Open the cockpit in Browser**

Use the Browser plugin to open:

```text
http://127.0.0.1:8787
```

Expected visible sections:

- `AuthorOS Personal Cockpit`
- `书架`
- `下一步`
- `当前章节`
- `作者助理`
- `任务中心`

- [ ] **Step 3: Trigger a rule-mode job**

In the assistant input, send:

```text
读最新章
```

Expected:

- A user chat bubble appears.
- An assistant reply appears.
- Task center shows a `read_chapter` job.
- The job eventually fails with a readable no-chapter message because the smoke root has no book yet.
- The page remains usable.

- [ ] **Step 4: Stop the local server**

Stop the `node src/cli.ts web` process with Ctrl+C.

- [ ] **Step 5: Remove smoke data**

Run:

```bash
rm -rf tmp/cockpit-smoke
```

Expected: no tracked files are removed.

---

### Task 9: Full Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run all tests**

Run:

```bash
node --test tests/*.test.ts
```

Expected:

```text
fail 0
```

- [ ] **Step 2: Run the build**

Run:

```bash
node scripts/build.mjs
```

Expected:

```text
Build complete: dist/ ready.
```

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree after all task commits.

---

## Plan Self-Review

Spec coverage:

- Personal home: Task 4 cockpit overview and Task 7 UI.
- Single-book workbench shell: Task 6 and Task 7.
- Task center with persisted job history: Task 1, Task 2, Task 3, Task 7.
- Author Assistant command routing in Web: existing routing preserved, Task 7 makes it the primary visible command surface.
- Web session status area: Task 4 model/session data and Task 7 `sessionStatus`.
- Chapter completion auto-display: Task 7 `watchJob` and `loadLatestChapter`.
- Next action recommendations: Task 4 `deriveNextAction` and Task 7 `nextAction`.
- Room isolation: Task 3 and Task 5 server tests.

Deferred spec areas:

- Full Writing Style Engine has its own v1.2 plan.
- Memory review approval and draft diff viewer have their own v1.1 plan.
- Native resident shell has its own v1.3 plan.

Placeholder scan:

- No banned placeholder markers or placeholder tasks are present.
- Every source-changing task includes file paths, concrete test code, concrete implementation code, commands, expected outcomes, and commit commands.

Type consistency:

- `JobStore.list()` is introduced in Task 1 and used in Tasks 3 and 4.
- `loadWebJobHistory` and `saveWebJobHistory` are introduced in Task 2 and used in Task 3.
- `getCockpitOverview` is introduced in Task 4 and used in Task 5.
- `nextAction.message` is introduced in Task 4 and used by the frontend in Task 7.
