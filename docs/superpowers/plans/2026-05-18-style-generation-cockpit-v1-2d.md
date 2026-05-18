# Style Generation Cockpit V1.2d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether bound style is active in chapter generation and let the user sync or bind profiles from the personal cockpit.

**Architecture:** Extend cockpit style data with a `generation` status derived from the book-local style snapshot. Add a small authenticated web API endpoint that reuses `bindStyleProfile()` for both binding and snapshot sync. Update the single-file web UI to render status, sync, and bind controls.

**Tech Stack:** TypeScript, Node.js test runner, AuthorOS web server, static HTML/CSS/JS.

---

### Task 1: Cockpit Style Generation Status

**Files:**
- Modify: `src/web/cockpit.ts`
- Test: `tests/web-cockpit.test.ts`

- [ ] **Step 1: Write failing tests**

Add assertions that `overview.style.generation` is:

```ts
{ active: false, snapshotPresent: false, matchedBinding: false, label: '尚未绑定文风' }
```

for no binding, reports `需要同步文风快照` for an old binding without `profile`, and reports active for a binding with an embedded profile snapshot.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: fail because `style.generation` does not exist.

- [ ] **Step 3: Implement status derivation**

In `src/web/cockpit.ts`, extend `CockpitStyleOverview` with:

```ts
generation: CockpitStyleGenerationStatus | null;
```

Load `readBookStyleProfile(projectDir)` from `src/commands/style.ts`, compare it with `binding.profileId`, and return status labels.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/web-cockpit.test.ts
```

Expected: pass.

### Task 2: Web Bind API

**Files:**
- Modify: `src/web/server.ts`
- Test: `tests/web-server.test.ts`

- [ ] **Step 1: Write failing test**

Add a test that posts:

```ts
POST /api/style/bind
{ "profileId": "<profile-id>" }
```

Then assert the response is HTTP 200 and the current book has `.authoros/private/style-binding.json` containing both `profileId` and `profile.name`.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: fail with HTTP 404.

- [ ] **Step 3: Implement route**

Import `bindStyleProfile()`, resolve the current book with `getCurrentPrivateBook(root)`, and call:

```ts
const binding = await bindStyleProfile(root, join(root, book.path), profileId);
```

Return:

```ts
{ ok: true, binding }
```

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/web-server.test.ts
```

Expected: pass.

### Task 3: Cockpit UI Controls

**Files:**
- Modify: `src/web/public/app.html`
- Test: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write failing tests**

Assert the HTML contains:

- `生成接入`
- `同步到写作生成`
- `绑定到当前书`
- `api('/api/style/bind'`
- `renderStyleGeneration`

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: fail because the new UI strings and helper do not exist.

- [ ] **Step 3: Implement UI**

Add a style actions container to the style panel. Render generation status, sync button for current profile, and bind buttons for available profiles. Button clicks call `bindStyleProfileFromCockpit(profileId)`, then reload cockpit.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: pass.

### Task 4: Full Verification

**Files:**
- All modified files above.

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/web-cockpit.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
```

- [ ] **Step 2: Run full tests and build**

```bash
node --test tests/*.test.ts
node scripts/build.mjs
```

- [ ] **Step 3: Restart web server and smoke**

Restart `node src/cli.ts web --root private-author --port 59273`, then verify:

```bash
curl -sS -o /tmp/authoros-cockpit.json -w "%{http_code}" http://127.0.0.1:59273/api/cockpit
```

Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-style-generation-cockpit-design.md docs/superpowers/plans/2026-05-18-style-generation-cockpit-v1-2d.md src/web/cockpit.ts src/web/server.ts src/web/public/app.html tests/web-cockpit.test.ts tests/web-server.test.ts tests/web-app-html.test.ts
git commit -m "feat: surface style generation status"
```
