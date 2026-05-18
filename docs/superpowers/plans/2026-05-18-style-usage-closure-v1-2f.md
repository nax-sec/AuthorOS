# Style Usage Closure V1.2f Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show extracted style rule summaries and make the active generation style visible beside the continue action.

**Architecture:** Add deterministic style summary data to the style extraction API response. Extend the cockpit next action with an optional style hint derived from active generation status. Update the static web UI to display extracted summaries and next-action style hints.

**Tech Stack:** TypeScript, Node.js test runner, AuthorOS web server, static HTML/CSS/JS.

---

### Task 1: Style Summary API

**Files:**
- Modify: `src/web/server.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing test assertions**

Extend the existing style extraction test to assert:

```ts
assert.equal(body.summary.name, '雨夜提炼');
assert.match(body.summary.description, /paragraphs/);
assert.equal(body.summary.rulesPreview.length > 0, true);
assert.match(body.summary.rulesPreview.join('\n'), /Do not copy|Preserve|Avoid/);
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: fail because `summary` is absent.

- [ ] **Step 3: Implement summary**

Add a helper in `src/web/server.ts`:

```ts
function summarizeStyleProfile(profile: StyleProfile) {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    rulesPreview: [...profile.rules.antiAiVoice, ...profile.rules.avoid].slice(0, 3),
  };
}
```

Return `summary` from `/api/style/extract`.

### Task 2: Next Action Style Hint

**Files:**
- Modify: `src/web/cockpit.ts`
- Test: `tests/web-cockpit.test.ts`

- [ ] **Step 1: Write failing test assertion**

In the active generation test, assert:

```ts
assert.equal(overview.nextAction.kind, 'continue_book');
assert.equal(overview.nextAction.styleHint, '下一章将使用文风：雨夜冷调');
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: fail because `styleHint` is absent.

- [ ] **Step 3: Implement hint**

Extend the `continue_book` next action type with optional `styleHint`, and pass the current style overview into `deriveNextAction()`.

### Task 3: Web UI Display

**Files:**
- Modify: `src/web/public/app.html`
- Test: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing HTML assertions**

Assert the HTML contains:

- `规则预览`
- `formatStyleSummary`
- `styleHint`
- `下一章将使用文风`

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail because the UI does not yet render these strings.

- [ ] **Step 3: Implement UI**

Show `规则预览：...` in the style detail area and use `formatStyleSummary(result.summary)` after extraction. In `renderCockpit()`, append `data.nextAction.styleHint` to `nextActionHint`.

### Task 4: Verification And Commit

- [ ] **Step 1: Focused tests**

```bash
node --test tests/web-server.test.ts tests/web-cockpit.test.ts tests/web-app-html.test.ts
```

- [ ] **Step 2: Full verification**

```bash
node --test tests/*.test.ts
node scripts/build.mjs
```

- [ ] **Step 3: Restart web and smoke `/api/cockpit`**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-style-usage-closure-design.md docs/superpowers/plans/2026-05-18-style-usage-closure-v1-2f.md src/web/server.ts src/web/cockpit.ts src/web/public/app.html tests/web-server.test.ts tests/web-cockpit.test.ts tests/web-app-html.test.ts
git commit -m "feat: clarify active writing style"
```
