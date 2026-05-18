# Style Extract Cockpit V1.2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cockpit form and API for creating a style profile from pasted prose and binding it to the current book.

**Architecture:** Add `POST /api/style/extract` to the web server and reuse the existing style command functions for extraction, save, and optional bind. Extend the single-file cockpit UI with a compact form that calls the endpoint, reports success in chat, and reloads cockpit state.

**Tech Stack:** TypeScript, Node.js test runner, AuthorOS web server, static HTML/CSS/JS.

---

### Task 1: Web Extract API

**Files:**
- Modify: `src/web/server.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing tests**

Add a test that posts to `/api/style/extract` with `name`, `text`, and `bind: true`, then asserts that:

- response status is 200,
- response includes `profile.name`,
- a profile JSON file exists under `.authoros/styles/profiles/`,
- current book `.authoros/private/style-binding.json` contains the same `profileId` and embedded `profile.name`.

Add a smaller test that blank `name` returns HTTP 400.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: `/api/style/extract` returns 404.

- [ ] **Step 3: Implement route**

Import `createStyleProfileFromText` and `saveStyleProfile` from `src/commands/style.ts`. For valid input, save the profile, then bind when requested and a current book exists.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: pass.

### Task 2: Cockpit Extraction Form

**Files:**
- Modify: `src/web/public/app.html`
- Test: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing HTML test assertions**

Assert the HTML contains:

- `提炼文风`
- `styleProfileName`
- `styleReferenceText`
- `提炼并绑定`
- `仅提炼`
- `api('/api/style/extract'`

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail because the form does not exist.

- [ ] **Step 3: Implement form**

Add input/textarea controls to the style panel and implement:

```js
async function extractStyleFromCockpit(bind) {
  await api('/api/style/extract', {
    method: 'POST',
    body: JSON.stringify({ name, text, bind }),
  });
  await loadCockpit();
}
```

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: pass.

### Task 3: Verification And Commit

**Files:**
- Modify: `src/web/server.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-server.test.ts`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/web-server.test.ts tests/web-app-html.test.ts
```

- [ ] **Step 2: Run full verification**

```bash
node --test tests/*.test.ts
node scripts/build.mjs
```

- [ ] **Step 3: Restart web server and smoke**

Restart `node src/cli.ts web --root private-author --port 59273`, then verify `/api/cockpit` returns HTTP 200.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-style-extract-cockpit-design.md docs/superpowers/plans/2026-05-18-style-extract-cockpit-v1-2e.md src/web/server.ts src/web/public/app.html tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: extract style from cockpit"
```
