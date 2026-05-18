# Web Resident Session Shell v1.3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact Web resident session shell showing service health, current book, current task, and a restore action.

**Architecture:** Extend `CockpitOverview` with a derived `session` object built from existing shelf/current/job state. Render it in the existing single-file Web app header. Do not add native macOS, Electron, or new persistence in this slice.

**Tech Stack:** TypeScript, Node test runner, file-based AuthorOS private root, single-page HTML/vanilla JS.

---

## File Structure

- Modify `src/web/cockpit.ts`: add session types and derive session state.
- Modify `src/web/public/app.html`: add the resident shell strip and renderer.
- Modify `tests/web-cockpit.test.ts`: add API-level session assertions.
- Modify `tests/web-app-html.test.ts`: add static HTML/render-hook assertions.

## Task 1: Cockpit Session Data

**Files:**
- Modify: `tests/web-cockpit.test.ts`
- Modify: `src/web/cockpit.ts`

- [ ] **Step 1: Write the failing empty-state test**

Add assertions in `cockpit overview handles an empty bookshelf`:

```ts
assert.equal(overview.session.service.label, '本机服务在线');
assert.equal(overview.session.currentBook.label, '暂无当前书');
assert.equal(overview.session.currentTask, null);
assert.equal(overview.session.lastCompleted, null);
assert.equal(overview.session.resume.label, '开一本新书后可恢复现场');
```

- [ ] **Step 2: Write the failing current-task test**

In `cockpit overview reports current book latest chapter and model status`, add a running job before the completed job:

```ts
const running = jobs.createJob('continue_book', '正在写第 2 章');
```

Then assert:

```ts
assert.equal(overview.session.currentBook.label, 'Demo Book');
assert.equal(overview.session.currentTask?.jobId, running.id);
assert.equal(overview.session.currentTask?.label, '继续写作');
assert.equal(overview.session.lastCompleted?.label, '继续写作');
assert.equal(overview.session.resume.label, '恢复 Demo Book');
```

- [ ] **Step 3: Run red test**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: FAIL because `overview.session` is missing.

- [ ] **Step 4: Implement minimal session data**

In `src/web/cockpit.ts`, add:

```ts
export interface CockpitSessionOverview {
  service: { status: 'online'; label: string };
  currentBook: { id?: string; label: string };
  currentTask: CockpitSessionTask | null;
  lastCompleted: CockpitSessionTask | null;
  resume: { label: string; available: boolean };
}

export interface CockpitSessionTask {
  jobId: string;
  action: string;
  label: string;
  status: WebJob['status'];
  detail: string;
  updatedAt: string;
}
```

Add `session: CockpitSessionOverview` to `CockpitOverview`, derive it from `jobs.list()` and the current book, and prefer the newest running job for `currentTask`.

- [ ] **Step 5: Run green test**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: PASS.

## Task 2: Header Resident Shell UI

**Files:**
- Modify: `tests/web-app-html.test.ts`
- Modify: `src/web/public/app.html`

- [ ] **Step 1: Write the failing HTML assertions**

Add assertions:

```ts
assert.match(html, /data-testid="resident-shell"/);
assert.match(html, /常驻会话/);
assert.match(html, /residentService/);
assert.match(html, /residentBook/);
assert.match(html, /residentTask/);
assert.match(html, /resumeSession/);
assert.match(html, /renderResidentShell/);
```

- [ ] **Step 2: Run red test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: FAIL because the resident shell markup and renderer are missing.

- [ ] **Step 3: Implement minimal UI**

Add a `resident-shell` block inside `<header>` with fields for service/book/task and a `resumeSession` button. Add `renderResidentShell(session)` and call it from `renderCockpit(data)`.

- [ ] **Step 4: Run green test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: PASS.

## Task 3: Verification and Commit

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/web-cockpit.test.ts tests/web-app-html.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests and build**

```bash
node --test tests/*.test.ts
node scripts/build.mjs
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Restart local Web service and smoke test**

```bash
node src/cli.ts web --root private-author --port 59273
curl -sS -o /tmp/authoros-cockpit.json -w "%{http_code}" http://127.0.0.1:59273/api/cockpit
curl -sS http://127.0.0.1:59273/ | rg "常驻会话|resident-shell|resumeSession"
```

Expected: API returns `200`, HTML contains the resident shell markers.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-resident-session-shell-design.md docs/superpowers/plans/2026-05-18-resident-session-shell-v1-3a.md src/web/cockpit.ts src/web/public/app.html tests/web-cockpit.test.ts tests/web-app-html.test.ts
git commit -m "feat: add resident session shell"
```
