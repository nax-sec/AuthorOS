# Personal Writing Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the private web cockpit into a full-height personal writing desk with a persistent session shell and sticky assistant dock.

**Architecture:** Keep `src/web/public/app.html` as the single static web app entrypoint for this slice. Use HTML structure and CSS layout changes only, preserving the current JavaScript data flow and endpoint contracts. Guard the UI contract with `tests/web-app-html.test.ts`.

**Tech Stack:** Static HTML/CSS/vanilla JS, Node test runner, existing AuthorOS web server.

---

### Task 1: Guard The New Desk Shell

**Files:**
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions for the new layout contract:

```ts
assert.match(html, /data-testid="app-shell"/);
assert.match(html, /data-testid="persistent-session-dock"/);
assert.match(html, /data-testid="focus-nav"/);
assert.match(html, /href="#chapterPanel"/);
assert.match(html, /href="#qualityWorkbench"/);
assert.match(html, /href="#previewWorkbench"/);
assert.match(html, /href="#memoryWorkbench"/);
assert.match(html, /data-testid="assistant-dock"/);
assert.match(html, /data-testid="rail-utilities"/);
assert.match(html, /class="desk-shell"/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: FAIL because the new layout markers are not present yet.

- [ ] **Step 3: Commit nothing**

Keep the failing test uncommitted until Task 2 makes it pass.

### Task 2: Implement The Desk Shell

**Files:**
- Modify: `src/web/public/app.html`
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Add layout wrappers and anchors**

Add `data-testid="app-shell"` to the body-level shell, add `data-testid="persistent-session-dock"` to the top session bar, add a center `focus-nav`, give the chapter/quality/preview/memory areas stable anchors, and wrap right-side utility panels in `data-testid="rail-utilities"`.

- [ ] **Step 2: Restyle the desktop layout**

Convert the page to a full-height `desk-shell` layout with compact top bar, fixed-width command rail, main writing surface, and sticky assistant dock. Keep cards at 8px radius or less and avoid nested cards.

- [ ] **Step 3: Run the focused test**

Run:

```bash
node --test tests/web-app-html.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/web-app-html.test.ts src/web/public/app.html
git commit -m "feat: redesign personal writing desk shell"
```

### Task 3: Verify End To End

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full tests**

Run:

```bash
node --test tests/*.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
node scripts/build.mjs
```

Expected: `Build complete: dist/ ready.`

- [ ] **Step 3: Browser smoke**

Start `node src/cli.ts web` against a seeded private root, open the local URL, verify key regions render, check console errors, and capture a screenshot.
