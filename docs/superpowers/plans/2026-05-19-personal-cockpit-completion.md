# Personal Cockpit Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the single-user AuthorOS Web cockpit as a daily writing desk with model confidence, chapter pipeline, preview comparison, rewrite intents, memory cards, asset inspection, book commitment, and session resume cues.

**Architecture:** Keep existing CLI/private bookshelf commands as the durable source of truth. Add small Web modules for derived cockpit data, expose focused HTTP routes, and reshape the current single-file browser UI in slices so tests can guard each user-facing surface.

**Tech Stack:** Node.js 24 native TypeScript, `node:test`, existing AuthorOS private bookshelf files, existing `src/web/server.ts` HTTP server, existing `src/web/public/app.html` browser client.

---

## File Structure

- Modify `src/web/quality.ts`
  - Add chapter production line records.
  - Add preview comparison derivation for feedback and style rewrite previews.
  - Expand rewrite intent labels that the UI can render without model calls.

- Create `src/web/assets.ts`
  - Read durable current-book assets safely from the current project directory.
  - Return a summary list plus individual asset detail payloads.
  - Include style profile and anti-AI voice rules as derived read-only assets.

- Create `src/web/commitment.ts`
  - Derive the book commitment card from `product.md`, `outline.md`, `characters.md`, and available memory files.
  - Return useful fallback labels when files are sparse or missing.

- Modify `src/web/cockpit.ts`
  - Add model health copy, daily session summary, commitment summary, and asset summary to `CockpitOverview`.
  - Reuse `getQualityOverview`, `getCockpitAssetOverview`, and `deriveBookCommitment`.

- Modify `src/web/agent.ts`
  - Route rewrite intent phrases into deterministic preview-generating commands.
  - Keep all rewrite commands preview-first.

- Modify `src/web/agent-llm.ts`
  - Teach the LLM router the expanded rewrite intents and map them to the same preview commands as the rule router.

- Modify `src/web/server.ts`
  - Add `GET /api/previews/current`.
  - Add `GET /api/assets`.
  - Add `GET /api/assets/:id`.
  - Preserve current-book room isolation and local API key masking.

- Modify `src/web/public/app.html`
  - Reshape the first screen into left rail, center writing desk, and right rail.
  - Render model health, chapter production line, preview comparison, rewrite intents, memory cards, assets, commitment card, and daily session.

- Modify tests:
  - `tests/web-quality.test.ts` for production line and preview comparison.
  - `tests/web-cockpit.test.ts` for model health, session, commitment, and assets.
  - `tests/web-server.test.ts` for new HTTP routes.
  - `tests/web-agent.test.ts` and `tests/web-agent-llm.test.ts` for rewrite intent routing.
  - `tests/web-app-html.test.ts` for browser shell landmarks and client hooks.

## Task 1: P0 Layout Data And Model Confidence

**Files:**
- Modify: `src/web/cockpit.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-cockpit.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing cockpit tests**

Append this test to `tests/web-cockpit.test.ts`:

```ts
test('cockpit overview includes model health and daily resume cues', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-19T09:00:00.000Z') });
    const running = jobs.createJob('continue_book', '继续写');
    const overview = await getCockpitOverview(root, { OPENAI_API_KEY: 'sk-test', AUTHOROS_MODEL: 'gpt-test' }, jobs);

    assert.equal(overview.modelHealth.status, 'ready');
    assert.equal(overview.modelHealth.sourceLabel, '环境变量');
    assert.match(overview.modelHealth.detail, /gpt-test/);
    assert.equal(overview.session.daily.currentTask?.jobId, running.id);
    assert.equal(overview.session.daily.lastActiveBook?.label, 'Demo Book');
    assert.match(overview.session.daily.nextRecommendedAction.label, /继续|处理|开/);
  });
});
```

Append these assertions to the existing shell smoke in `tests/web-app-html.test.ts`:

```ts
assert.match(html, /data-testid="model-health-card"/);
assert.match(html, /data-testid="daily-session-summary"/);
assert.match(html, /data-testid="cockpit-center"/);
assert.match(html, /function renderModelHealth/);
assert.match(html, /function renderDailySession/);
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-app-html.test.ts
```

Expected: fail because `modelHealth`, `session.daily`, and the new HTML hooks do not exist.

- [ ] **Step 3: Extend cockpit types and derivation**

Add these interfaces to `src/web/cockpit.ts`:

```ts
export interface CockpitModelHealth {
  status: 'ready' | 'missing_key' | 'configured_without_key';
  label: string;
  detail: string;
  sourceLabel: string;
  actionLabel: string;
}

export interface CockpitDailySession {
  openedAt: string;
  lastActiveBook: { id?: string; label: string } | null;
  currentTask: CockpitSessionTask | null;
  lastCompleted: CockpitSessionTask | null;
  chaptersTouched: number[];
  nextRecommendedAction: { label: string; message: string };
}
```

Add `modelHealth: CockpitModelHealth` to `CockpitOverview`, add `daily: CockpitDailySession` to `CockpitSessionOverview`, and derive them with:

```ts
function deriveModelHealth(model: Pick<ResolvedProjectModelConfig, 'apiKeySet' | 'apiKeySource' | 'baseUrl' | 'model'>): CockpitModelHealth {
  const sourceLabel = model.apiKeySource === 'env'
    ? '环境变量'
    : model.apiKeySource === 'local'
      ? '本地保存'
      : '未设置';
  if (model.apiKeySet) {
    return {
      status: 'ready',
      label: '模型可用',
      detail: `${model.model} / ${model.baseUrl}`,
      sourceLabel,
      actionLabel: '检查配置',
    };
  }
  return {
    status: model.model || model.baseUrl ? 'configured_without_key' : 'missing_key',
    label: '需要配置 API Key',
    detail: `${model.model} / ${model.baseUrl}`,
    sourceLabel,
    actionLabel: '保存 Key',
  };
}

function deriveDailySession(book: PrivateBook | null, jobs: readonly WebJob[], nextAction: CockpitNextAction): CockpitDailySession {
  const currentTask = jobs.find((job) => job.status === 'running');
  const lastCompleted = jobs.find((job) => job.status === 'completed');
  const chaptersTouched = [...new Set(jobs.flatMap((job) => {
    const result = isRecord(job.result) ? job.result : {};
    const chapter = result.chapter;
    return Number.isInteger(chapter) ? [chapter] : [];
  }))].slice(0, 5);
  return {
    openedAt: new Date().toISOString(),
    lastActiveBook: book ? { id: book.id, label: book.title } : null,
    currentTask: currentTask ? sessionTask(currentTask) : null,
    lastCompleted: lastCompleted ? sessionTask(lastCompleted) : null,
    chaptersTouched,
    nextRecommendedAction: { label: nextAction.label, message: nextAction.message },
  };
}
```

- [ ] **Step 4: Render the P0 shell hooks**

In `src/web/public/app.html`, add a center container and two render functions:

```html
<section class="panel rail-card" data-testid="model-health-card" id="modelHealthCard"></section>
<section class="panel rail-card" data-testid="daily-session-summary" id="dailySessionSummary"></section>
<main class="cockpit-center" data-testid="cockpit-center"></main>
```

Add JavaScript renderers:

```js
function renderModelHealth(modelHealth) {
  const status = modelHealth || {};
  return `<div class="panel-kicker">模型状态</div>
    <h2>${escapeHtml(status.label || '模型状态未知')}</h2>
    <p>${escapeHtml(status.detail || '打开配置后补齐模型信息。')}</p>
    <div class="meta-row"><span>${escapeHtml(status.sourceLabel || '未设置')}</span><button data-action="open-model-config">${escapeHtml(status.actionLabel || '配置')}</button></div>`;
}

function renderDailySession(session) {
  const daily = session?.daily || {};
  return `<div class="panel-kicker">今日现场</div>
    <h2>${escapeHtml(daily.lastActiveBook?.label || '暂无当前书')}</h2>
    <p>${escapeHtml(daily.currentTask?.detail || daily.lastCompleted?.detail || '打开一本书后继续写。')}</p>
    <button data-message="${escapeAttr(daily.nextRecommendedAction?.message || '继续写')}">${escapeHtml(daily.nextRecommendedAction?.label || '继续写')}</button>`;
}
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/cockpit.ts src/web/public/app.html tests/web-cockpit.test.ts tests/web-app-html.test.ts
git commit -m "feat: surface cockpit model confidence"
```

Expected: focused tests pass and the commit succeeds.

## Task 2: P1 Chapter Production Line

**Files:**
- Modify: `src/web/quality.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-quality.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing quality tests**

Append this test to `tests/web-quality.test.ts`:

```ts
test('quality overview derives scan-friendly chapter production line', async () => {
  await withTempProject(async ({ projectDir, state, jobs }) => {
    await writeFile(join(projectDir, 'reviews/0001.internal.md'), '内评', 'utf8');
    await mkdir(join(projectDir, 'memory'), { recursive: true });
    await writeFile(join(projectDir, 'memory/chapter-0001.delta.md'), '# delta', 'utf8');
    const overview = await getQualityOverview(projectDir, {
      ...state,
      chapters: [{
        chapter: 1,
        chapterId: '0001',
        plan: true,
        draft: true,
        internalReview: true,
        readerSimReview: false,
        feedbackRaw: false,
        feedbackAnalysis: false,
        decision: false,
      }],
    }, jobs);

    assert.equal(overview.productionLine[0].chapter, 1);
    assert.equal(overview.productionLine[0].nextStage.key, 'readerSimReview');
    assert.equal(overview.productionLine[0].primaryAction?.type, 'reader_sim_review');
    assert.equal(overview.productionLine[0].flags.some((flag) => flag.kind === 'memory_delta'), true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/web-quality.test.ts
```

Expected: fail because `productionLine` is missing.

- [ ] **Step 3: Add production line types and derivation**

Add to `src/web/quality.ts`:

```ts
export interface QualityProductionLineItem {
  chapter: number;
  chapterId: string;
  label: string;
  stages: QualityStage[];
  nextStage: QualityStage;
  blocker: string | null;
  primaryAction: QualityAction | null;
  flags: Array<{ kind: 'pending_feedback' | 'pending_style' | 'memory_delta'; label: string }>;
}
```

Add `productionLine: QualityProductionLineItem[]` to `QualityOverview` and derive it:

```ts
function deriveProductionLine(input: {
  state: ProjectStateResult;
  chapters: QualityChapter[];
  actions: readonly QualityAction[];
  pendingPreview: QualityPendingPreview | null;
  styleRewritePreview: QualityStyleRewritePreview | null;
  memoryDeltas: readonly PendingMemoryDelta[];
}): QualityProductionLineItem[] {
  return input.chapters.map((chapter) => {
    const next = chapter.stages.find((item) => item.status === 'next');
    const missing = chapter.stages.find((item) => item.status === 'missing');
    const nextStage = next ? next : missing ? missing : chapter.stages.at(-1)!;
    const matchedAction = input.actions.find((action) => action.chapter === chapter.chapter);
    const primaryAction = matchedAction ? matchedAction : null;
    const flags: QualityProductionLineItem['flags'] = [];
    if (input.pendingPreview?.chapter === chapter.chapter) flags.push({ kind: 'pending_feedback', label: '修改预览待确认' });
    if (input.styleRewritePreview?.chapter === chapter.chapter) flags.push({ kind: 'pending_style', label: '文风预览待确认' });
    if (input.memoryDeltas.some((delta) => delta.name === `chapter-${chapter.chapterId}.delta.md`)) {
      flags.push({ kind: 'memory_delta', label: '记忆更新待合并' });
    }
    return {
      chapter: chapter.chapter,
      chapterId: chapter.chapterId,
      label: `第 ${chapter.chapter} 章`,
      stages: chapter.stages,
      nextStage,
      blocker: primaryAction ? null : productionBlocker(nextStage),
      primaryAction,
      flags,
    };
  });
}
```

- [ ] **Step 4: Render production line in the center**

Add `data-testid="chapter-production-line"` to the HTML shell and add:

```js
function renderProductionLine(quality) {
  const items = quality?.productionLine || [];
  if (!items.length) return '<p class="muted">还没有章节进入生产线。</p>';
  return items.map((item) => `<article class="pipeline-row">
    <strong>${escapeHtml(item.label)}</strong>
    <span>${escapeHtml(item.nextStage?.label || '完成')}</span>
    <div>${(item.stages || []).map((stage) => `<span class="stage stage-${stage.status}">${escapeHtml(stage.label)}</span>`).join('')}</div>
    <p>${escapeHtml(item.blocker || item.flags?.map((flag) => flag.label).join(' / ') || '可继续推进')}</p>
    ${item.primaryAction ? `<button data-message="${escapeAttr(item.primaryAction.message)}">${escapeHtml(item.primaryAction.label)}</button>` : ''}
  </article>`).join('');
}
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/quality.ts src/web/public/app.html tests/web-quality.test.ts tests/web-app-html.test.ts
git commit -m "feat: add chapter production line"
```

Expected: focused tests pass and the commit succeeds.

## Task 3: P1 Preview Comparison

**Files:**
- Modify: `src/web/quality.ts`
- Modify: `src/web/server.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-quality.test.ts`
- Modify: `tests/web-server.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing comparison tests**

Append this test to `tests/web-quality.test.ts`:

```ts
test('quality overview derives current versus pending feedback preview comparison', async () => {
  await withTempProject(async ({ projectDir, state, jobs }) => {
    await mkdir(join(projectDir, 'chapters'), { recursive: true });
    await writeFile(join(projectDir, 'chapters/0001.md'), '当前正文', 'utf8');
    await mkdir(join(projectDir, '.authoros/private'), { recursive: true });
    await writeFile(join(projectDir, '.authoros/private/pending-feedback.json'), JSON.stringify({
      chapter: 1,
      text: '去掉解释',
      instruction: '按反馈修改',
      preview_content: '预览正文',
      rationale: '减少解释',
      created_at: '2026-05-19T09:10:00.000Z',
      original_char_count: 4,
      revised_char_count: 4,
    }), 'utf8');

    const overview = await getQualityOverview(projectDir, state, jobs);

    assert.equal(overview.previewComparison?.kind, 'feedback');
    assert.equal(overview.previewComparison?.current.content, '当前正文');
    assert.equal(overview.previewComparison?.preview.content, '预览正文');
    assert.equal(overview.previewComparison?.actions.applyMessage, '确认应用修改');
  });
});
```

Add a server route test:

```ts
test('web server returns current preview comparison', async () => {
  await withTempRoot(async (root) => {
    const io = silentIo();
    assert.equal(await run(['init', 'Demo Book', '--quick', '--dir', join(root, 'books/demo')], root, io.io, { env: {} }), 0, io.err.join(''));
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'preview comparison',
        path: 'books/demo',
        created_at: '2026-05-19T00:00:00.000Z',
        last_active_at: '2026-05-19T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'books/demo/chapters/0001.md'), '当前正文', 'utf8');
    await mkdir(join(root, 'books/demo/.authoros/private'), { recursive: true });
    await writeFile(join(root, 'books/demo/.authoros/private/pending-feedback.json'), JSON.stringify({
      chapter: 1,
      text: '去掉解释',
      instruction: '按反馈修改',
      preview_content: '预览正文',
      rationale: '减少解释',
      created_at: '2026-05-19T09:10:00.000Z',
      original_char_count: 4,
      revised_char_count: 4,
    }), 'utf8');

    const server = createWebServer({ root });
    const response = await server.fetch(new Request('http://local/api/previews/current'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.comparison.current.content, '当前正文');
    assert.equal(body.comparison.preview.content, '预览正文');
  });
});
```

When writing the actual test, use the existing `createWebServer` and `writeBook` helpers in `tests/web-server.test.ts`; assert exact strings `当前正文` and `预览正文`.

- [ ] **Step 2: Run failing focused tests**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-server.test.ts
```

Expected: fail because `previewComparison` and `/api/previews/current` do not exist.

- [ ] **Step 3: Add preview comparison types and function**

Add to `src/web/quality.ts`:

```ts
export interface QualityPreviewComparison {
  kind: 'feedback' | 'style_rewrite';
  chapter: number;
  intentLabel: string;
  rationale: string;
  createdAt: string;
  originalCharCount: number | null;
  revisedCharCount: number | null;
  current: { label: string; content: string };
  preview: { label: string; content: string };
  actions: { applyMessage: string; discardMessage: string; readMessage: string };
}

export async function getCurrentPreviewComparison(projectDir: string): Promise<QualityPreviewComparison | null> {
  const feedback = await readPendingFeedback(projectDir);
  const style = await readPendingStyleRewrite(projectDir);
  const pending = style ? style : feedback;
  if (!pending) return null;
  const chapterId = String(pending.chapter).padStart(4, '0');
  const current = await readFile(join(projectDir, 'chapters', `${chapterId}.md`), 'utf8');
  const previewContent = pending.kind === 'style_rewrite'
    ? pending.previewContent
    : pending.previewContent
      ? pending.previewContent
      : pending.text;
  return {
    kind: pending.kind === 'style_rewrite' ? 'style_rewrite' : 'feedback',
    chapter: pending.chapter,
    intentLabel: pending.kind === 'style_rewrite' ? styleIntentLabel(pending.intent) : pending.instruction,
    rationale: pending.rationale ? pending.rationale : pending.text,
    createdAt: pending.createdAt,
    originalCharCount: typeof pending.originalCharCount === 'number' ? pending.originalCharCount : null,
    revisedCharCount: typeof pending.revisedCharCount === 'number' ? pending.revisedCharCount : null,
    current: { label: `第 ${pending.chapter} 章当前正文`, content: current.trim() },
    preview: { label: `第 ${pending.chapter} 章预览正文`, content: previewContent.trim() },
    actions: {
      applyMessage: pending.kind === 'style_rewrite' ? '应用文风修改' : '确认应用修改',
      discardMessage: '重新生成预览',
      readMessage: '读最新章',
    },
  };
}
```

Call `getCurrentPreviewComparison(projectDir)` inside `getQualityOverview` and assign it to `previewComparison`.

- [ ] **Step 4: Add route and UI comparison panes**

In `src/web/server.ts`, add:

```ts
if (routePath === '/api/previews/current' && request.method === 'GET') {
  const target = await getWebModelTarget(root);
  if (!target.book) return json({ comparison: null });
  return json({ comparison: await getCurrentPreviewComparison(target.projectDir) });
}
```

In `app.html`, add `data-testid="preview-comparison"` and:

```js
function renderPreviewComparison(quality) {
  const comparison = quality?.previewComparison;
  if (!comparison) return '<p class="muted">暂无待确认预览。</p>';
  return `<div class="comparison-grid">
    <article><h3>${escapeHtml(comparison.current.label)}</h3><pre>${escapeHtml(comparison.current.content)}</pre></article>
    <article><h3>${escapeHtml(comparison.preview.label)}</h3><pre>${escapeHtml(comparison.preview.content)}</pre></article>
  </div>
  <p>${escapeHtml(comparison.rationale)}</p>
  <button data-message="${escapeAttr(comparison.actions.applyMessage)}">应用预览</button>
  <button data-message="${escapeAttr(comparison.actions.discardMessage)}">重新生成</button>`;
}
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/quality.ts src/web/server.ts src/web/public/app.html tests/web-quality.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: compare chapter previews in cockpit"
```

Expected: focused tests pass and the commit succeeds.

## Task 4: P1 Rewrite Intent Panel

**Files:**
- Modify: `src/web/agent.ts`
- Modify: `src/web/agent-llm.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-agent.test.ts`
- Modify: `tests/web-agent-llm.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing router tests**

Append to `tests/web-agent.test.ts`:

```ts
test('rule agent routes craft rewrite intents to feedback preview commands', () => {
  const session = createWebAgentSession();
  const result = handleAgentMessage(session, '强化章尾钩子');

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'feedback_preview');
  assert.equal(result.command.type, 'feedback_preview');
  assert.match(result.command.text, /章尾钩子/);
});

test('rule agent routes style rewrite intents preview first', () => {
  const session = createWebAgentSession();
  const result = handleAgentMessage(session, '保留剧情换文风');

  assert.equal(result.kind, 'job');
  assert.equal(result.action, 'style_rewrite_preview');
  assert.equal(result.command.type, 'style_rewrite');
});
```

Append to `tests/web-agent-llm.test.ts`:

```ts
test('llm prompt lists expanded rewrite intent actions', async () => {
  const prompt = buildAgentSystemPrompt();
  assert.match(prompt, /强化章尾钩子/);
  assert.match(prompt, /减少解释/);
  assert.match(prompt, /保留剧情换文风/);
});
```

- [ ] **Step 2: Run failing router tests**

Run:

```bash
node --test tests/web-agent.test.ts tests/web-agent-llm.test.ts
```

Expected: fail because the expanded intents are not routed or listed.

- [ ] **Step 3: Add intent catalog and routing**

In `src/web/agent.ts`, add:

```ts
const rewriteIntents = [
  { label: '去 AI 味', message: '帮这一章去 AI 味', command: 'style_rewrite', intent: 'remove_ai_voice' },
  { label: '仿写文风', message: '仿写当前绑定文风改写这一章', command: 'style_rewrite', intent: 'imitate_style' },
  { label: '文风润色', message: '按当前绑定文风润色这一章', command: 'style_rewrite', intent: 'style_polish' },
  { label: '强化开头', message: '请强化这一章开头的抓力，先生成修改预览', command: 'feedback_preview' },
  { label: '强化章尾钩子', message: '请强化这一章章尾钩子，先生成修改预览', command: 'feedback_preview' },
  { label: '减少解释', message: '请减少解释性文字，先生成修改预览', command: 'feedback_preview' },
  { label: '增加压迫感', message: '请增加场景压迫感，先生成修改预览', command: 'feedback_preview' },
  { label: '对白瘦身', message: '请压缩对白，让表达更锋利，先生成修改预览', command: 'feedback_preview' },
  { label: '保留剧情换文风', message: '保留剧情，只改文风，先生成文风改写预览', command: 'style_rewrite', intent: 'style_polish' },
] as const;
```

Before generic fallback routing, match `rawMessage.includes(intent.label)` and return either:

```ts
{ kind: 'job', action: 'feedback_preview', message: '收到，我先生成修改预览，正文不会直接覆盖。', command: { type: 'feedback_preview', chapter: 'latest', text: intent.message } }
```

or:

```ts
{ kind: 'job', action: 'style_rewrite_preview', message: '收到，我先生成文风改写预览，正文不会直接覆盖。', command: { type: 'style_rewrite', chapter: 'latest', intent: intent.intent, text: intent.message } }
```

- [ ] **Step 4: Teach LLM router and render intent buttons**

In `src/web/agent-llm.ts`, update the system prompt with the nine labels and allow style rewrite intents for the three style-backed actions. In `app.html`, add `data-testid="rewrite-intent-panel"` and buttons whose `data-message` values equal the labels from the catalog.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/agent.ts src/web/agent-llm.ts src/web/public/app.html tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-app-html.test.ts
git commit -m "feat: add cockpit rewrite intents"
```

Expected: focused tests pass and the commit succeeds.

## Task 5: P1 Memory Review Cards

**Files:**
- Modify: `src/web/quality.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-quality.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing memory card tests**

Append to `tests/web-quality.test.ts`:

```ts
test('quality overview groups memory deltas into review cards', async () => {
  await withTempProject(async ({ projectDir, state, jobs }) => {
    await mkdir(join(projectDir, 'memory'), { recursive: true });
    await writeFile(join(projectDir, 'memory/chapter-0001.delta.md'), [
      '# 第 1 章记忆更新',
      '## 正史设定',
      '- 雨夜会暴露主角的旧伤。',
      '## 伏笔',
      '- 黑伞还会出现。',
      '## 文风规则',
      '- 少解释，多动作。',
    ].join('\n'), 'utf8');

    const overview = await getQualityOverview(projectDir, state, jobs);

    assert.equal(overview.memoryReviewCards.length, 3);
    assert.equal(overview.memoryReviewCards[0].type, 'canon');
    assert.equal(overview.memoryReviewCards[0].mergePlanLabel, '结构化更新');
    assert.equal(overview.memoryReviewCards[2].type, 'style');
  });
});
```

- [ ] **Step 2: Run failing quality test**

Run:

```bash
node --test tests/web-quality.test.ts
```

Expected: fail because `memoryReviewCards` is missing.

- [ ] **Step 3: Add memory review card derivation**

Add to `src/web/quality.ts`:

```ts
export interface QualityMemoryReviewCard {
  type: 'canon' | 'foreshadowing' | 'plot' | 'character' | 'style';
  label: string;
  deltaName: string;
  items: string[];
  mergePlanLabel: '结构化更新' | '注释保底' | '追加记录';
  rawPath: string;
}
```

Add `memoryReviewCards: QualityMemoryReviewCard[]` to `QualityOverview`. Derive cards by reading each delta file and mapping headings:

```ts
const memoryCardHeadings = [
  { type: 'canon', label: '正史设定', heading: '正史设定', mergePlanLabel: '结构化更新' },
  { type: 'foreshadowing', label: '伏笔', heading: '伏笔', mergePlanLabel: '结构化更新' },
  { type: 'plot', label: '主线', heading: '主线', mergePlanLabel: '结构化更新' },
  { type: 'character', label: '人物状态', heading: '人物状态', mergePlanLabel: '结构化更新' },
  { type: 'style', label: '文风规则', heading: '文风规则', mergePlanLabel: '追加记录' },
] as const;
```

For each heading, collect bullet lines until the next `## ` heading. If a delta has no known headings, return one `canon` card with `mergePlanLabel: '注释保底'` and the first non-empty lines as items.

- [ ] **Step 4: Render memory cards**

In `app.html`, replace the raw-first memory section with `data-testid="memory-review-cards"` and render cards:

```js
function renderMemoryReviewCards(quality) {
  const cards = quality?.memoryReviewCards || [];
  if (!cards.length) return '<p class="muted">暂无记忆更新待审阅。</p>';
  return cards.map((card) => `<article class="memory-card">
    <div class="meta-row"><strong>${escapeHtml(card.label)}</strong><span>${escapeHtml(card.mergePlanLabel)}</span></div>
    <ul>${(card.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    <small>${escapeHtml(card.deltaName)}</small>
  </article>`).join('');
}
```

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-quality.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/quality.ts src/web/public/app.html tests/web-quality.test.ts tests/web-app-html.test.ts
git commit -m "feat: show memory review cards"
```

Expected: focused tests pass and the commit succeeds.

## Task 6: P2 Asset Panel

**Files:**
- Create: `src/web/assets.ts`
- Modify: `src/web/cockpit.ts`
- Modify: `src/web/server.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-cockpit.test.ts`
- Modify: `tests/web-server.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing asset tests**

Append to `tests/web-cockpit.test.ts`:

```ts
test('cockpit overview summarizes durable writing assets', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/product.md'), '# 产品承诺\n悬疑长篇', 'utf8');
    await writeFile(join(root, 'books/demo/world.md'), '# 世界\n雨城', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.equal(overview.assets.total, 11);
    assert.equal(overview.assets.available, 2);
    assert.equal(overview.assets.items.find((item) => item.id === 'product')?.status, 'available');
    assert.equal(overview.assets.items.find((item) => item.id === 'characters')?.status, 'missing');
  });
});
```

Append to `tests/web-server.test.ts`:

```ts
test('web server reads current book assets without exposing files outside the book', async () => {
  await withTempRoot(async (root) => {
    const io = silentIo();
    assert.equal(await run(['init', 'Demo Book', '--quick', '--dir', join(root, 'books/demo')], root, io.io, { env: {} }), 0, io.err.join(''));
    await writeFile(join(root, 'bookshelf.json'), JSON.stringify({
      version: 1,
      current: 'demo',
      books: [{
        id: 'demo',
        title: 'Demo Book',
        concept: 'asset panel',
        path: 'books/demo',
        created_at: '2026-05-19T00:00:00.000Z',
        last_active_at: '2026-05-19T00:00:00.000Z',
      }],
    }, null, 2), 'utf8');
    await writeFile(join(root, 'books/demo/product.md'), '# 产品承诺\n悬疑长篇', 'utf8');

    const server = createWebServer({ root });
    const listResponse = await server.fetch(new Request('http://local/api/assets'));
    const listBody = await listResponse.json();
    const detailResponse = await server.fetch(new Request('http://local/api/assets/product'));
    const detailBody = await detailResponse.json();
    const escapeResponse = await server.fetch(new Request('http://local/api/assets/../../package'));

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.assets.items.find((item) => item.id === 'product').status, 'available');
    assert.equal(detailResponse.status, 200);
    assert.match(detailBody.asset.content, /产品承诺/);
    assert.equal(escapeResponse.status, 404);
  });
});
```

- [ ] **Step 2: Run failing asset tests**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-server.test.ts
```

Expected: fail because `assets` and `/api/assets` do not exist.

- [ ] **Step 3: Create `src/web/assets.ts`**

Implement:

```ts
export interface CockpitAssetItem {
  id: string;
  label: string;
  path: string;
  status: 'available' | 'missing';
  kind: 'identity' | 'memory' | 'style';
  excerpt: string;
}

export interface CockpitAssetOverview {
  total: number;
  available: number;
  items: CockpitAssetItem[];
}

export interface CockpitAssetDetail extends CockpitAssetItem {
  content: string;
}
```

Use this registry:

```ts
const assetRegistry = [
  { id: 'product', label: '产品承诺', path: 'product.md', kind: 'identity' },
  { id: 'world', label: '世界观', path: 'world.md', kind: 'identity' },
  { id: 'characters', label: '人物', path: 'characters.md', kind: 'identity' },
  { id: 'outline', label: '大纲', path: 'outline.md', kind: 'identity' },
  { id: 'author', label: '作者口径', path: 'author.md', kind: 'identity' },
  { id: 'canon', label: '正史设定', path: 'memory/canon.md', kind: 'memory' },
  { id: 'foreshadowing', label: '伏笔', path: 'memory/foreshadowing.yaml', kind: 'memory' },
  { id: 'plot_threads', label: '主线', path: 'memory/plot_threads.yaml', kind: 'memory' },
  { id: 'character_state', label: '人物状态', path: 'memory/character_state.yaml', kind: 'memory' },
  { id: 'memory_style', label: '文风记忆', path: 'memory/style.md', kind: 'memory' },
  { id: 'style_profile', label: '当前文风', path: '.authoros/private/style-profile.snapshot.json', kind: 'style' },
] as const;
```

Read only registry IDs. Return 404-style `null` from `readCockpitAsset` when the ID is unknown or missing.

- [ ] **Step 4: Wire assets into cockpit, server, and UI**

Add `assets: CockpitAssetOverview` to `CockpitOverview`. Add routes:

```ts
if (routePath === '/api/assets' && request.method === 'GET') {
  const target = await getWebModelTarget(root);
  if (!target.book) return json({ assets: { total: 0, available: 0, items: [] } });
  return json({ assets: await getCockpitAssetOverview(target.projectDir) });
}

const assetMatch = routePath.match(/^\/api\/assets\/([a-z0-9_-]+)$/);
if (assetMatch?.[1] && request.method === 'GET') {
  const target = await getWebModelTarget(root);
  if (!target.book) return json({ error: 'no current book' }, 404);
  const asset = await readCockpitAsset(target.projectDir, assetMatch[1]);
  return asset ? json({ asset }) : json({ error: 'asset not found' }, 404);
}
```

Render `data-testid="asset-panel"` with an asset list and preview pane.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/assets.ts src/web/cockpit.ts src/web/server.ts src/web/public/app.html tests/web-cockpit.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: inspect cockpit writing assets"
```

Expected: focused tests pass and the commit succeeds.

## Task 7: P2 Book Commitment Card

**Files:**
- Create: `src/web/commitment.ts`
- Modify: `src/web/cockpit.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-cockpit.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing commitment tests**

Append to `tests/web-cockpit.test.ts`:

```ts
test('cockpit overview derives book commitment from identity files', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    await writeFile(join(root, 'books/demo/product.md'), [
      '# 类型承诺',
      '悬疑成长。',
      '# 读者钩子',
      '每章都要给一个无法立刻解释的异常。',
      '# 禁区',
      '不要写成纯恋爱。'
    ].join('\n'), 'utf8');
    await writeFile(join(root, 'books/demo/outline.md'), '# 前十章方向\n主角追查黑伞。', 'utf8');

    const overview = await getCockpitOverview(root, {}, createJobStore());

    assert.match(overview.commitment.genrePromise, /悬疑成长/);
    assert.match(overview.commitment.readerHook, /异常/);
    assert.match(overview.commitment.boundaries[0], /纯恋爱/);
    assert.match(overview.commitment.firstActDirection, /黑伞/);
  });
});
```

- [ ] **Step 2: Run failing commitment tests**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-app-html.test.ts
```

Expected: fail because `commitment` and its UI are missing.

- [ ] **Step 3: Create `src/web/commitment.ts`**

Implement:

```ts
export interface BookCommitment {
  genrePromise: string;
  protagonistDesire: string;
  coreConflict: string;
  readerHook: string;
  boundaries: string[];
  firstActDirection: string;
  confidence: 'strong' | 'partial' | 'sparse';
}
```

Use a helper that extracts content after headings such as `类型承诺`, `主角`, `核心冲突`, `读者钩子`, `禁区`, and `前十章方向`. If a heading is absent, use the first meaningful lines from `product.md`, `characters.md`, or `outline.md`. Fallback strings must be explicit, for example `尚未写清类型承诺`.

- [ ] **Step 4: Wire and render commitment**

Add `commitment: BookCommitment | null` to `CockpitOverview`; return `null` when no current book exists. Render `data-testid="book-commitment-card"` with the six fields and confidence label.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-app-html.test.ts
git diff --check
git add src/web/commitment.ts src/web/cockpit.ts src/web/public/app.html tests/web-cockpit.test.ts tests/web-app-html.test.ts
git commit -m "feat: derive cockpit book commitment"
```

Expected: focused tests pass and the commit succeeds.

## Task 8: P2 Daily Session Summary Hardening

**Files:**
- Modify: `src/web/cockpit.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-cockpit.test.ts`

- [ ] **Step 1: Write failing session summary tests**

Append to `tests/web-cockpit.test.ts`:

```ts
test('daily session summarizes recent completed actions and touched chapters', async () => {
  await withTempRoot(async (root) => {
    await writeBook(root);
    const jobs = createJobStore({ now: () => new Date('2026-05-19T10:00:00.000Z') });
    const job = jobs.createJob('chapter_decision', '生成第 2 章决策');
    jobs.complete(job.id, { chapter: 2 });

    const overview = await getCockpitOverview(root, {}, jobs);

    assert.equal(overview.session.daily.lastCompleted?.label, '生成创作决策');
    assert.deepEqual(overview.session.daily.chaptersTouched, [2]);
    assert.match(overview.session.daily.resumeText, /第 2 章/);
  });
});
```

- [ ] **Step 2: Run failing session tests**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: fail because `resumeText` is missing or chapter extraction is incomplete.

- [ ] **Step 3: Add stable resume copy**

Extend `CockpitDailySession`:

```ts
resumeText: string;
lastCompletedActionLabel: string;
```

Derive:

```ts
function dailyResumeText(book: PrivateBook | null, lastCompleted: CockpitSessionTask | null, chaptersTouched: readonly number[]): string {
  if (!book) return '还没有当前书，先开一本新书。';
  if (lastCompleted && chaptersTouched[0]) return `上次停在${lastCompleted.label}，涉及第 ${chaptersTouched[0]} 章。`;
  if (lastCompleted) return `上次完成：${lastCompleted.label}。`;
  return `可以继续推进《${book.title}》。`;
}
```

- [ ] **Step 4: Render the hardened resume copy**

Update `renderDailySession` to show `resumeText`, `lastCompletedActionLabel`, and `chaptersTouched`.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
node --test tests/web-cockpit.test.ts
git diff --check
git add src/web/cockpit.ts src/web/public/app.html tests/web-cockpit.test.ts
git commit -m "feat: summarize daily writing session"
```

Expected: focused tests pass and the commit succeeds.

## Task 9: P3 Integrated Browser Smoke And Cleanup

**Files:**
- Modify only files touched by preceding tasks when smoke reveals a concrete issue.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
node --test tests/*.test.ts
node scripts/build.mjs
git diff --check
```

Expected: all tests pass, build passes, and diff check produces no output.

- [ ] **Step 2: Start the Web server**

Run:

```bash
AUTHOROS_ROOM_ROOT="$(mktemp -d)" npm run author -- web --host 127.0.0.1 --port 59273 --no-open
```

Expected: server prints a local URL. If port `59273` is occupied, use the next free port and update the browser target.

- [ ] **Step 3: Browser smoke**

Open the local URL in the in-app browser and verify:

```text
模型状态 card visible
今日现场 card visible
章节生产线 visible
预览对比 visible
改写意图 buttons visible
记忆审阅 cards visible when seeded
资产 panel visible
承诺 card visible
Console has no runtime errors
```

- [ ] **Step 4: Save final smoke artifact**

Capture a screenshot to:

```text
tmp/personal-cockpit-completion-smoke.png
```

- [ ] **Step 5: Commit final polish if needed**

If smoke reveals layout or runtime issues, fix them, then run:

```bash
node --test tests/*.test.ts
node scripts/build.mjs
git diff --check
git add src/web tests
git commit -m "chore: harden personal cockpit completion"
```

Expected: final verification passes and the branch is ready for user review.

## Execution Notes

- Implement tasks in order.
- Keep every model-backed action preview-first.
- Do not add a React/Vite migration in this iteration.
- Do not expose saved API keys through any route response.
- Use existing room-root and current-book helpers for all Web routes.
- Commit each completed task separately so the branch remains easy to inspect.

## Self-Review

- The plan covers the nine delivery items in `2026-05-19-personal-cockpit-completion-design.md`.
- Type names used by later tasks are introduced before use.
- All new HTTP routes are scoped through the current book.
- The preview/apply boundary remains explicit.
- The local API key convenience remains masked in responses.
