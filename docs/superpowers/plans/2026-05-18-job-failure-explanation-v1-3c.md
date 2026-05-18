# Job Failure Explanation v1.3c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured, user-readable failure explanations for Web jobs and announce them in the cockpit when watched jobs fail.

**Architecture:** Create a pure `src/web/job-failure.ts` classifier. Extend `JobStore.fail()` with optional structured data while preserving existing callers. Use the classifier in `runCommandJob()`, and update the frontend recovery/announcement paths to prefer structured failure data.

**Tech Stack:** TypeScript, Node test runner, existing Web job store, vanilla browser JS.

---

## File Structure

- Create `src/web/job-failure.ts`: pure error classifier.
- Create `tests/web-job-failure.test.ts`: classifier tests.
- Modify `src/web/jobs.ts`: optional failure data support.
- Modify `tests/web-jobs.test.ts`: failure data persistence/event tests.
- Modify `src/web/server.ts`: classify command job errors.
- Modify `tests/web-server.test.ts`: server failure result assertion.
- Modify `src/web/public/app.html`: failed-job announcement and structured recovery text.
- Modify `tests/web-app-html.test.ts`: static frontend assertions.

## Task 1: Failure Classifier

**Files:**
- Create: `tests/web-job-failure.test.ts`
- Create: `src/web/job-failure.ts`

- [ ] **Step 1: Write failing classifier tests**

Assert timeout, finish_reason length, network, and missing key/model map to readable Chinese titles.

- [ ] **Step 2: Run red test**

```bash
node --test tests/web-job-failure.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement classifier**

Export:

```ts
export type JobFailureKind = 'model_timeout' | 'model_length' | 'network' | 'model_config' | 'unknown';
export interface JobFailureExplanation { kind: JobFailureKind; title: string; detail: string; next: string; }
export function explainJobFailure(error: unknown): JobFailureExplanation;
```

- [ ] **Step 4: Run green test**

```bash
node --test tests/web-job-failure.test.ts
```

Expected: PASS.

## Task 2: Job Store and Server Integration

**Files:**
- Modify: `src/web/jobs.ts`
- Modify: `tests/web-jobs.test.ts`
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing job-store test**

Add a test asserting `jobs.fail(job.id, failure.title, failure)` stores `job.failure` and the failed event data.

- [ ] **Step 2: Write failing server test**

Add a server test with a writing LLM that throws `OpenAI-compatible response did not include message content (finish_reason: length).` and assert job failure kind is `model_length`.

- [ ] **Step 3: Run red tests**

```bash
node --test tests/web-jobs.test.ts tests/web-server.test.ts
```

Expected: FAIL because fail data is not supported and server is not classifying errors.

- [ ] **Step 4: Implement job-store and server integration**

Extend `WebJob` with optional `failure`, `JobStore.fail()` with optional `data`, and call `jobs.fail(jobId, failure.title, failure)` inside `runCommandJob()` catch.

- [ ] **Step 5: Run green tests**

```bash
node --test tests/web-jobs.test.ts tests/web-server.test.ts
```

Expected: PASS.

## Task 3: Frontend Recovery and Failure Announcement

**Files:**
- Modify: `src/web/public/app.html`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing HTML assertions**

Assert the HTML contains:

```ts
assert.match(html, /announceJobFailure/);
assert.match(html, /failureDetail/);
assert.match(html, /任务失败/);
```

- [ ] **Step 2: Run red test**

```bash
node --test tests/web-app-html.test.ts
```

Expected: FAIL until frontend uses structured failure data.

- [ ] **Step 3: Implement frontend usage**

Add `failureDetail(jobOrEvent)` helper, update `deriveBooklessRecovery()`, `renderRecovery()`, and `watchJob()` failed branch.

- [ ] **Step 4: Run green test**

```bash
node --test tests/web-app-html.test.ts
```

Expected: PASS.

## Task 4: Verification and Commit

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/web-job-failure.test.ts tests/web-jobs.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
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
curl -sS http://127.0.0.1:59273/ | rg "announceJobFailure|任务失败|failureDetail"
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-job-failure-explanation-design.md docs/superpowers/plans/2026-05-18-job-failure-explanation-v1-3c.md src/web/job-failure.ts src/web/jobs.ts src/web/server.ts src/web/public/app.html tests/web-job-failure.test.ts tests/web-jobs.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: explain failed web jobs"
```
