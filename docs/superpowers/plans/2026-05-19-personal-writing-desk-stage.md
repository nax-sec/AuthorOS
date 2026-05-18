# Personal Writing Desk Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vertical cockpit feel with a mode-based writing desk stage.

**Architecture:** Keep the single-file web app and existing backend APIs. Change only `src/web/public/app.html` and the static HTML contract test. Preserve existing ids and `data-testid` hooks while wrapping existing modules into stage panels and utility drawers.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node test runner.

---

### Task 1: Lock The UI Contract

**Files:**
- Modify: `tests/web-app-html.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions for `data-testid="mode-switcher"`, the four `data-mode-target` buttons, `data-testid="main-stage"`, four `data-testid="stage-panel-*"` panels, `data-testid="assistant-drawer-toggle"`, `function setWorkbenchMode`, and `function toggleAssistantDock`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/web-app-html.test.ts`
Expected: FAIL because those new markers do not exist yet.

### Task 2: Build The Stage Layout

**Files:**
- Modify: `src/web/public/app.html`

- [ ] **Step 1: Implement markup and styling**

Wrap existing chapter, production, preview, and memory modules in stage panels. Replace the anchor-only nav with a segmented mode switcher. Keep hidden anchor ids for compatibility.

- [ ] **Step 2: Implement JavaScript controls**

Add `setWorkbenchMode(mode)` and `toggleAssistantDock(collapsed)` and wire the new buttons.

- [ ] **Step 3: Run focused test**

Run: `node --test tests/web-app-html.test.ts`
Expected: PASS.

### Task 3: Verify The App

**Files:**
- Verify: `src/web/public/app.html`

- [ ] **Step 1: Run full tests**

Run: `node --test tests/*.test.ts`
Expected: PASS.

- [ ] **Step 2: Build**

Run: `node scripts/build.mjs`
Expected: `Build complete: dist/ ready.`

- [ ] **Step 3: Browser smoke**

Reload `http://127.0.0.1:59329/`, check console errors, and capture a screenshot.
