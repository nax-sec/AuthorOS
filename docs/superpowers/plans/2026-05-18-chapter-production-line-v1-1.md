# Chapter Production Line v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web cockpit show the chapter production line: next chapter card, quality loop stages, pending preview boundary, memory delta visibility, and recovery guidance for failed jobs.

**Architecture:** Add a focused Web quality module that derives presentation-ready workflow state from the existing book state, pending feedback file, memory deltas, and persisted jobs. Extend `getCockpitOverview()` with this derived state, then render it in the single-file Web app without adding a frontend build pipeline. Keep CLI commands as the durable core; v1.1 is visibility and guidance, not a new autopilot.

**Tech Stack:** Node.js 24 native TypeScript execution, `node:test`, existing private bookshelf commands, file-backed Markdown/JSON metadata, existing `src/web/public/app.html`.

---

## Scope

This plan implements the v1.1 slice from `docs/superpowers/specs/2026-05-18-personal-cockpit-style-engine-design.md`:

- Chapter queue and next chapter card.
- Phase-level recovery guidance.
- Draft and preview comparison boundary for pending feedback.
- Quality loop panel.
- Memory review visibility.

This plan does not implement style extraction, anti-AI-voice rewrite, style rewrite preview, or a native resident shell. Those remain v1.2/v1.3.

## File Structure

- Create `src/web/quality.ts`
  - Owns presentation-ready workflow state for the current book.
  - Reads existing project state and memory delta metadata.
  - Reads pending private feedback JSON only for preview metadata.
  - Derives next chapter card, quality stages, quality signals, and failure recovery guidance.

- Create `tests/web-quality.test.ts`
  - Unit tests for next chapter card, pending preview summary, memory delta visibility, and failed job guidance.

- Modify `src/web/cockpit.ts`
  - Adds `quality` to `CockpitOverview`.
  - Calls `getQualityOverview()` only when there is a current book.

- Modify `tests/web-cockpit.test.ts`
  - Verifies cockpit overview includes quality state and leaves it `null` for an empty bookshelf.

- Modify `src/web/public/app.html`
  - Adds a Quality Loop panel and preview/memory cards.
  - Renders `cockpit.quality` from `/api/cockpit`.

- Modify `tests/web-app-html.test.ts`
  - Smoke-tests the new panel and required client hooks.

---

### Task 1: Add Web Quality Overview Module

**Files:**
- Create: `src/web/quality.ts`
- Create: `tests/web-quality.test.ts`

- [ ] **Step 1: Write failing tests for quality derivation**

Create `tests/web-quality.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectState } from '../src/commands/state.ts';
import { getQualityOverview } from '../src/web/quality.ts';
import { createJobStore } from '../src/web/jobs.ts';

async function withTempBook(body: (bookDir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'authoros-quality-'));
  try {
    await mkdir(join(root, 'plans'), { recursive: true });
    await mkdir(join(root, 'chapters'), { recursive: true });
    await mkdir(join(root, 'reviews'), { recursive: true });
    await mkdir(join(root, 'decisions'), { recursive: true });
    await mkdir(join(root, 'memory'), { recursive: true });
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('quality overview derives next chapter card and stage states', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await writeFile(join(bookDir, 'reviews/0001.internal.md'), 'internal review', 'utf8');
    await writeFile(join(bookDir, 'plans/0002.md'), 'plan two', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.nextChapter.chapter, 2);
    assert.equal(overview.nextChapter.message, '继续写');
    assert.deepEqual(overview.nextChapter.blockers, []);
    assert.equal(overview.chapters[0].chapter, 1);
    assert.equal(overview.chapters[0].stages.find((stage) => stage.key === 'draft')?.status, 'done');
    assert.equal(overview.chapters[0].stages.find((stage) => stage.key === 'readerSimReview')?.status, 'missing');
    assert.equal(overview.chapters[1].stages.find((stage) => stage.key === 'draft')?.status, 'next');
  });
});

test('quality overview reports pending feedback preview without applying it', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await mkdir(join(bookDir, '.authoros/private'), { recursive: true });
    await writeFile(join(bookDir, '.authoros/private/pending-feedback.json'), JSON.stringify({
      book_id: 'demo',
      chapter: 1,
      text: '结尾压力不够',
      instruction: 'revise chapter 1',
      created_at: '2026-05-18T08:00:00.000Z',
    }), 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.pendingPreview?.kind, 'feedback');
    assert.equal(overview.pendingPreview?.chapter, 1);
    assert.equal(overview.pendingPreview?.text, '结尾压力不够');
    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label.includes('修改预览')), true);
  });
});

test('quality overview lists pending memory deltas', async () => {
  await withTempBook(async (bookDir) => {
    await writeFile(join(bookDir, 'plans/0001.md'), 'plan one', 'utf8');
    await writeFile(join(bookDir, 'chapters/0001.md'), 'draft one', 'utf8');
    await writeFile(join(bookDir, 'memory/chapter-0001.delta.md'), '# delta', 'utf8');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, createJobStore());

    assert.equal(overview.memoryDeltas.length, 1);
    assert.equal(overview.memoryDeltas[0].name, 'chapter-0001.delta.md');
    assert.equal(overview.signals.some((signal) => signal.kind === 'warning' && signal.label.includes('记忆更新待审阅')), true);
  });
});

test('quality overview gives recovery guidance for the latest failed job', async () => {
  await withTempBook(async (bookDir) => {
    const jobs = createJobStore({ now: () => new Date('2026-05-18T09:00:00Z') });
    const job = jobs.createJob('continue_book', '开始写下一章');
    jobs.append(job.id, 'planning', '正在规划下一章');
    jobs.fail(job.id, 'model timeout');
    const state = await getProjectState(bookDir);

    const overview = await getQualityOverview(bookDir, state, jobs);

    assert.equal(overview.recovery?.jobId, job.id);
    assert.equal(overview.recovery?.failedPhase, 'planning');
    assert.equal(overview.recovery?.message, 'model timeout');
    assert.match(overview.recovery?.suggestion ?? '', /继续写/);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-quality.test.ts
```

Expected: fail because `src/web/quality.ts` does not exist.

- [ ] **Step 3: Implement `src/web/quality.ts`**

Create `src/web/quality.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listMemoryDeltas, type PendingMemoryDelta } from '../commands/memory.ts';
import type { ChapterState, ProjectStateResult } from '../commands/state.ts';
import type { JobStore, WebJob } from './jobs.ts';

export type QualityStageStatus = 'done' | 'next' | 'missing' | 'optional';
export type QualitySignalKind = 'ok' | 'warning' | 'danger';

export interface QualityStage {
  key: keyof Omit<ChapterState, 'chapter' | 'chapterId'> | 'memoryDelta';
  label: string;
  status: QualityStageStatus;
}

export interface QualityChapter {
  chapter: number;
  chapterId: string;
  stages: QualityStage[];
}

export interface QualityNextChapterCard {
  chapter: number;
  state: 'needs_plan' | 'ready_to_draft' | 'ready_to_review';
  label: string;
  message: string;
  blockers: string[];
  stages: QualityStage[];
}

export interface QualityPendingPreview {
  kind: 'feedback';
  chapter: number;
  text: string;
  instruction: string;
  createdAt: string;
  path: string;
}

export interface QualityRecovery {
  jobId: string;
  action: string;
  failedPhase: string;
  message: string;
  suggestion: string;
}

export interface QualitySignal {
  kind: QualitySignalKind;
  label: string;
}

export interface QualityOverview {
  nextChapter: QualityNextChapterCard;
  chapters: QualityChapter[];
  pendingPreview: QualityPendingPreview | null;
  memoryDeltas: PendingMemoryDelta[];
  recovery: QualityRecovery | null;
  signals: QualitySignal[];
}

const stageLabels: Record<QualityStage['key'], string> = {
  plan: '计划',
  draft: '正文',
  internalReview: '内评',
  readerSimReview: '读者模拟',
  feedbackRaw: '真实反馈',
  feedbackAnalysis: '反馈分析',
  decision: '决策',
  memoryDelta: '记忆',
};

export async function getQualityOverview(
  projectDir: string,
  state: ProjectStateResult,
  jobs: JobStore,
): Promise<QualityOverview> {
  const pendingPreview = await readPendingFeedback(projectDir);
  const memoryDeltas = await listMemoryDeltas(projectDir);
  const chapters = state.chapters.map((chapter) => renderChapter(chapter, state, memoryDeltas));
  const nextChapter = deriveNextChapter(state, memoryDeltas);
  const recovery = deriveRecovery(jobs.list());
  return {
    nextChapter,
    chapters,
    pendingPreview,
    memoryDeltas,
    recovery,
    signals: deriveSignals({ pendingPreview, memoryDeltas, recovery }),
  };
}

function renderChapter(
  chapter: ChapterState,
  state: ProjectStateResult,
  memoryDeltas: readonly PendingMemoryDelta[],
): QualityChapter {
  const memoryPending = memoryDeltas.some((delta) => delta.name === `chapter-${chapter.chapterId}.delta.md`);
  return {
    chapter: chapter.chapter,
    chapterId: chapter.chapterId,
    stages: [
      stage('plan', chapter.plan ? 'done' : chapter.chapter === state.nextPlanChapter ? 'next' : 'missing'),
      stage('draft', chapter.draft ? 'done' : chapter.chapter === state.nextDraftChapter ? 'next' : 'missing'),
      stage('internalReview', chapter.internalReview ? 'done' : chapter.draft ? 'missing' : 'optional'),
      stage('readerSimReview', chapter.readerSimReview ? 'done' : chapter.draft ? 'missing' : 'optional'),
      stage('decision', chapter.decision ? 'done' : chapter.chapter === state.nextDecisionChapter && chapter.draft ? 'next' : 'missing'),
      stage('memoryDelta', memoryPending ? 'next' : chapter.decision ? 'missing' : 'optional'),
    ],
  };
}

function deriveNextChapter(
  state: ProjectStateResult,
  memoryDeltas: readonly PendingMemoryDelta[],
): QualityNextChapterCard {
  const chapter = state.nextDraftChapter;
  const existing = state.chapters.find((item) => item.chapter === chapter);
  const stages = existing
    ? renderChapter(existing, state, memoryDeltas).stages
    : [
        stage('plan', chapter === state.nextPlanChapter ? 'next' : 'done'),
        stage('draft', 'next'),
        stage('internalReview', 'optional'),
        stage('readerSimReview', 'optional'),
        stage('decision', 'optional'),
        stage('memoryDelta', 'optional'),
      ];
  const blockers = existing?.plan === false && chapter !== state.nextPlanChapter
    ? [`第 ${chapter} 章缺少计划`]
    : [];
  return {
    chapter,
    state: existing?.draft ? 'ready_to_review' : existing?.plan ? 'ready_to_draft' : 'needs_plan',
    label: `第 ${chapter} 章生产线`,
    message: '继续写',
    blockers,
    stages,
  };
}

function deriveRecovery(jobs: readonly WebJob[]): QualityRecovery | null {
  const failed = jobs.find((job) => job.status === 'failed');
  if (!failed) return null;
  const lastPhase = [...failed.events].reverse().find((event) => event.type !== 'failed');
  return {
    jobId: failed.id,
    action: failed.action,
    failedPhase: lastPhase?.type ?? failed.action,
    message: failed.error ?? '任务失败',
    suggestion: recoverySuggestion(failed.action),
  };
}

function recoverySuggestion(action: string): string {
  if (action === 'continue_book') return '检查模型配置后，可以再次发送“继续写”。';
  if (action === 'feedback_preview') return '确认当前章存在后，可以重新发送修改意见。';
  if (action === 'feedback_apply') return '确认待应用修改仍存在后，再发送“确认应用修改”。';
  if (action === 'read_chapter') return '确认已有正文后，再读取最新章。';
  return '查看失败原因后，重新执行上一步。';
}

function deriveSignals(input: {
  pendingPreview: QualityPendingPreview | null;
  memoryDeltas: readonly PendingMemoryDelta[];
  recovery: QualityRecovery | null;
}): QualitySignal[] {
  const signals: QualitySignal[] = [];
  if (input.recovery) signals.push({ kind: 'danger', label: `上次任务失败：${input.recovery.failedPhase}` });
  if (input.pendingPreview) signals.push({ kind: 'warning', label: `第 ${input.pendingPreview.chapter} 章有修改预览待确认` });
  if (input.memoryDeltas.length > 0) signals.push({ kind: 'warning', label: `记忆更新待审阅：${input.memoryDeltas.length} 个` });
  if (signals.length === 0) signals.push({ kind: 'ok', label: '质量环路暂无阻塞' });
  return signals;
}

function stage(key: QualityStage['key'], status: QualityStageStatus): QualityStage {
  return { key, label: stageLabels[key], status };
}

async function readPendingFeedback(projectDir: string): Promise<QualityPendingPreview | null> {
  const path = join(projectDir, '.authoros/private/pending-feedback.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as Partial<{
    chapter: unknown;
    text: unknown;
    instruction: unknown;
    created_at: unknown;
  }>;
  if (!Number.isInteger(parsed.chapter) || typeof parsed.text !== 'string' || typeof parsed.instruction !== 'string' || typeof parsed.created_at !== 'string') {
    throw new Error('Invalid pending private feedback.');
  }
  return {
    kind: 'feedback',
    chapter: parsed.chapter,
    text: parsed.text,
    instruction: parsed.instruction,
    createdAt: parsed.created_at,
    path: '.authoros/private/pending-feedback.json',
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/web-quality.test.ts
```

Expected: all `tests/web-quality.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/quality.ts tests/web-quality.test.ts
git commit -m "feat: add chapter quality overview"
```

---

### Task 2: Add Quality State To Cockpit Overview

**Files:**
- Modify: `src/web/cockpit.ts`
- Modify: `tests/web-cockpit.test.ts`

- [ ] **Step 1: Add failing cockpit integration tests**

Append these assertions to existing tests in `tests/web-cockpit.test.ts`.

In `cockpit overview handles an empty bookshelf`, add:

```ts
    assert.equal(overview.quality, null);
```

In `cockpit overview reports current book latest chapter and model status`, add:

```ts
    assert.equal(overview.quality?.nextChapter.chapter, 2);
    assert.equal(overview.quality?.signals[0].label.length > 0, true);
```

In `cockpit overview detects pending feedback`, add:

```ts
    assert.equal(overview.quality?.pendingPreview?.kind, 'feedback');
    assert.equal(overview.quality?.pendingPreview?.chapter, 1);
```

Add this new test:

```ts
test('cockpit overview includes pending memory delta visibility', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await mkdir(join(root, 'books/demo/memory'), { recursive: true });
    await writeFile(join(root, 'books/demo/memory/chapter-0001.delta.md'), '# delta', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.quality?.memoryDeltas.length, 1);
    assert.equal(overview.quality?.memoryDeltas[0].name, 'chapter-0001.delta.md');
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: fail because `CockpitOverview` does not have `quality`.

- [ ] **Step 3: Integrate `getQualityOverview`**

In `src/web/cockpit.ts`, add imports:

```ts
import { getQualityOverview, type QualityOverview } from './quality.ts';
```

Add this property to `CockpitOverview`:

```ts
  quality: QualityOverview | null;
```

In the empty bookshelf return object, add:

```ts
      quality: null,
```

In the current-book branch, compute the project dir and quality:

```ts
  const projectDir = join(root, status.book.path);
  const model = await resolveProjectModelConfig(projectDir, env);
  const latestChapter = await tryLatestChapter(root);
  const pendingFeedback = await fileExists(join(projectDir, '.authoros/private/pending-feedback.json'));
  const quality = await getQualityOverview(projectDir, status.state, jobs);
```

Then include:

```ts
    quality,
```

Do not keep a duplicate `resolveProjectModelConfig(join(root, status.book.path), env)` line after adding `projectDir`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-cockpit.test.ts
```

Expected: both focused test files pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/cockpit.ts tests/web-cockpit.test.ts
git commit -m "feat: include quality state in cockpit overview"
```

---

### Task 3: Render Quality Loop In The Web Cockpit

**Files:**
- Modify: `src/web/public/app.html`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Add failing HTML smoke expectations**

In `tests/web-app-html.test.ts`, add these assertions inside the existing test:

```ts
  assert.match(html, /data-testid="quality-loop"/);
  assert.match(html, /data-testid="next-chapter-card"/);
  assert.match(html, /data-testid="pending-preview"/);
  assert.match(html, /renderQuality/);
  assert.match(html, /renderStagePill/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail because the current HTML lacks the quality panel and render hooks.

- [ ] **Step 3: Add the Quality Loop panel markup**

In `src/web/public/app.html`, inside `<section class="workspace">`, after the current book panel and before the current chapter article block, add:

```html
      <section class="panel quality-loop" data-testid="quality-loop">
        <div class="row">
          <h2>质量环路</h2>
          <span id="qualitySignal" class="muted">等待状态。</span>
        </div>
        <div id="nextChapterCard" data-testid="next-chapter-card" class="next-chapter-card">加载中...</div>
        <div id="qualityStages" class="stage-grid"></div>
        <div id="pendingPreview" data-testid="pending-preview" class="preview-card muted">没有待确认预览。</div>
        <div id="memoryReview" class="preview-card muted">没有待审阅记忆更新。</div>
        <div id="recoveryHint" class="preview-card muted">没有失败恢复项。</div>
      </section>
```

- [ ] **Step 4: Add compact styles**

In the `<style>` block, add:

```css
    .quality-loop { display: grid; gap: 12px; }
    .next-chapter-card, .preview-card { border: 1px solid #e5e9f0; border-radius: 7px; background: #fafbfc; padding: 10px; }
    .stage-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .stage-pill { border: 1px solid #d9dee7; border-radius: 999px; padding: 5px 9px; font-size: 12px; background: #f8fafc; color: #344054; }
    .stage-pill.done { border-color: #9ad4b0; background: #ecfdf3; color: #166534; }
    .stage-pill.next { border-color: #9db7ff; background: #eef4ff; color: #1d4ed8; }
    .stage-pill.missing { border-color: #ffd18a; background: #fff7ed; color: #9a3412; }
    .signal-danger { color: #b42318; }
    .signal-warning { color: #b54708; }
    .signal-ok { color: #167647; }
```

- [ ] **Step 5: Wire DOM nodes and rendering functions**

In the `<script>` block, add these element lookups after `currentBookMeta`:

```js
    const qualitySignal = document.querySelector('#qualitySignal');
    const nextChapterCard = document.querySelector('#nextChapterCard');
    const qualityStages = document.querySelector('#qualityStages');
    const pendingPreview = document.querySelector('#pendingPreview');
    const memoryReview = document.querySelector('#memoryReview');
    const recoveryHint = document.querySelector('#recoveryHint');
```

In `renderCockpit(data)`, after rendering `nextActionHint`, add:

```js
      renderQuality(data.quality);
```

Add these functions before `refreshJobs()`:

```js
    function renderQuality(quality) {
      if (!quality) {
        qualitySignal.textContent = '还没有当前书。';
        qualitySignal.className = 'muted';
        nextChapterCard.textContent = '开书后会显示下一章生产线。';
        qualityStages.innerHTML = '';
        pendingPreview.textContent = '没有待确认预览。';
        memoryReview.textContent = '没有待审阅记忆更新。';
        recoveryHint.textContent = '没有失败恢复项。';
        return;
      }

      const signal = (quality.signals || [])[0];
      qualitySignal.textContent = signal ? signal.label : '质量环路暂无阻塞';
      qualitySignal.className = signal ? `muted signal-${signal.kind}` : 'muted signal-ok';
      nextChapterCard.textContent = `${quality.nextChapter.label} · ${quality.nextChapter.blockers.length ? quality.nextChapter.blockers.join('；') : '可继续'}`;
      qualityStages.innerHTML = '';
      for (const stage of quality.nextChapter.stages || []) {
        qualityStages.appendChild(renderStagePill(stage));
      }
      pendingPreview.textContent = quality.pendingPreview
        ? `第 ${quality.pendingPreview.chapter} 章修改预览待确认：${quality.pendingPreview.text}`
        : '没有待确认预览。';
      memoryReview.textContent = quality.memoryDeltas && quality.memoryDeltas.length
        ? `待审阅记忆更新：${quality.memoryDeltas.map(delta => delta.name).join('、')}`
        : '没有待审阅记忆更新。';
      recoveryHint.textContent = quality.recovery
        ? `${quality.recovery.action} 在 ${quality.recovery.failedPhase} 失败：${quality.recovery.message}。${quality.recovery.suggestion}`
        : '没有失败恢复项。';
    }

    function renderStagePill(stage) {
      const pill = document.createElement('span');
      pill.className = `stage-pill ${stage.status}`;
      pill.textContent = `${stage.label} · ${stage.status}`;
      return pill;
    }
```

Use only `textContent` and DOM node creation for data from the API.

- [ ] **Step 6: Run focused test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/public/app.html tests/web-app-html.test.ts
git commit -m "feat: render cockpit quality loop"
```

---

### Task 4: Focused Integration Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused Web tests**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-cockpit.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
```

Expected:

```text
fail 0
```

- [ ] **Step 2: Check git status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree.

---

### Task 5: Browser Smoke Test Quality Loop

**Files:**
- No source edits expected.

- [ ] **Step 1: Start the local Web server**

Run:

```bash
AUTHOROS_PRIVATE_ROOT="$PWD/tmp/quality-smoke" AUTHOROS_WEB_AGENT=rule node src/cli.ts web --root "$PWD/tmp/quality-smoke" --port 8787
```

Expected output includes:

```text
AuthorOS web listening: http://127.0.0.1:8787
```

- [ ] **Step 2: Open the cockpit in Browser**

Use the Browser plugin to open:

```text
http://127.0.0.1:8787
```

Expected visible sections:

- `AuthorOS Personal Cockpit`
- `质量环路`
- `第 1 章生产线` appears only after a book exists; with no book, the panel should say a book is needed.

- [ ] **Step 3: Trigger the empty-root recovery path**

In the assistant input, send:

```text
读最新章
```

Expected:

- Task center shows a failed `read_chapter` job.
- Quality loop recovery area shows a readable failure suggestion after cockpit refresh.
- The page remains usable.

- [ ] **Step 4: Stop the local server**

Stop the `node src/cli.ts web` process with Ctrl+C.

- [ ] **Step 5: Remove smoke data**

Run:

```bash
rm -rf tmp/quality-smoke
```

Expected: no tracked files are removed.

---

### Task 6: Full Verification

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

- Chapter queue and next chapter card: Task 1 derives `nextChapter`; Task 3 renders `nextChapterCard`.
- Phase-level recovery guidance: Task 1 derives `recovery`; Task 3 renders `recoveryHint`; Task 5 browser-smokes an empty-root failure path.
- Draft and preview comparison boundary: Task 1 reads pending feedback as `pendingPreview`; Task 3 renders it as a separate preview card and does not apply changes.
- Quality loop panel: Task 3 adds visible panel and stage pills.
- Memory review visibility: Task 1 lists pending memory deltas; Task 3 renders them.

Deferred:

- Full diff viewer remains later work.
- Style extraction, style binding, anti-AI-voice checks, and style rewrite previews remain v1.2.
- Native resident shell remains v1.3.

Completeness scan:

- No banned marker strings, vague implementation tasks, or unspecified tests remain.
- Each source-changing task has exact files, concrete tests, commands, expected results, and commit commands.

Type consistency:

- `QualityOverview` is introduced in Task 1 and referenced as `quality` in Task 2 and Task 3.
- Frontend uses `quality.nextChapter`, `quality.signals`, `quality.pendingPreview`, `quality.memoryDeltas`, and `quality.recovery`, matching Task 1 interfaces.
