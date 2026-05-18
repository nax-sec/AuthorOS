# Job Completion Closure v1.3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add actionable completion copy to Web jobs and announce it in the cockpit chat when a task finishes.

**Architecture:** Introduce a small pure `src/web/job-completion.ts` module. `src/web/server.ts` wraps successful command results before `jobs.complete()`. `src/web/public/app.html` reads the completion copy from SSE events and displays it as an assistant message.

**Tech Stack:** TypeScript, Node test runner, vanilla browser JS, existing SSE job stream.

---

## File Structure

- Create `src/web/job-completion.ts`: pure completion copy builder.
- Create `tests/web-job-completion.test.ts`: focused unit tests.
- Modify `src/web/server.ts`: wrap command job results.
- Modify `src/web/public/app.html`: announce completion copy on completed SSE events.
- Modify `tests/web-app-html.test.ts`: static shell assertions.

## Task 1: Completion Copy Module

**Files:**
- Create: `tests/web-job-completion.test.ts`
- Create: `src/web/job-completion.ts`

- [ ] **Step 1: Write failing tests**

Create tests that import `withJobCompletion` and assert:

```ts
const result = withJobCompletion('new_book_and_continue', { book: { title: 'Demo Book' }, chapter: 1 });
assert.equal(result.completion.title, '《Demo Book》已建好，第 1 章已写好。');
assert.match(result.completion.next, /读最新章/);
```

Also assert style preview says正文未覆盖:

```ts
const preview = withJobCompletion('style_rewrite', { chapter: 2, pending: 'pending-style.json' });
assert.match(preview.completion.detail, /正文还没有被覆盖/);
```

- [ ] **Step 2: Run red test**

```bash
node --test tests/web-job-completion.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `src/web/job-completion.ts`**

Export `JobCompletionCopy`, `CompletedCommandType`, and `withJobCompletion()`. Support command types used by `runCommandJob()`: `new_book`, `new_book_and_continue`, `continue`, `feedback`, `apply`, `style_rewrite`, `style_apply`, `read`, `download_chapter`, `download_all`, and `status`.

- [ ] **Step 4: Run green test**

```bash
node --test tests/web-job-completion.test.ts
```

Expected: PASS.

## Task 2: Server Integration

**Files:**
- Modify: `src/web/server.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing server assertion**

In an existing job-history test, assert completed job result includes `completion.title` and `completion.next`.

- [ ] **Step 2: Run red test**

```bash
node --test tests/web-server.test.ts
```

Expected: FAIL because job results are not wrapped yet.

- [ ] **Step 3: Wrap successful command results**

Import `withJobCompletion` and replace successful `jobs.complete(jobId, result)` calls inside `runCommandJob()` with a helper that calls:

```ts
jobs.complete(jobId, withJobCompletion(command.type, result));
```

- [ ] **Step 4: Run green test**

```bash
node --test tests/web-server.test.ts
```

Expected: PASS.

## Task 3: Frontend Announcement

**Files:**
- Modify: `tests/web-app-html.test.ts`
- Modify: `src/web/public/app.html`

- [ ] **Step 1: Write failing HTML assertions**

Assert the HTML contains:

```ts
assert.match(html, /announceJobCompletion/);
assert.match(html, /任务完成/);
assert.match(html, /下一步建议/);
```

- [ ] **Step 2: Run red test**

```bash
node --test tests/web-app-html.test.ts
```

Expected: FAIL until the frontend function exists.

- [ ] **Step 3: Implement frontend announcement**

Add `announceJobCompletion(event)` and call it from `watchJob()` when `data.type === 'completed'`.

- [ ] **Step 4: Run green test**

```bash
node --test tests/web-app-html.test.ts
```

Expected: PASS.

## Task 4: Verification and Commit

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/web-job-completion.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
```

- [ ] **Step 2: Run full verification**

```bash
node --test tests/*.test.ts
node scripts/build.mjs
git diff --check
```

- [ ] **Step 3: Restart and smoke**

```bash
node src/cli.ts web --root private-author --port 59273
curl -sS -o /tmp/authoros-cockpit.json -w "%{http_code}" http://127.0.0.1:59273/api/cockpit
curl -sS http://127.0.0.1:59273/ | rg "announceJobCompletion|任务完成|下一步建议"
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-job-completion-closure-design.md docs/superpowers/plans/2026-05-18-job-completion-closure-v1-3b.md src/web/job-completion.ts src/web/server.ts src/web/public/app.html tests/web-job-completion.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: announce completed web jobs"
```
