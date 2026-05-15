# Private Web Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `author web`, a local browser UI with a lightweight private author agent, progress events, token gate, and chapter downloads.

**Architecture:** Add a focused `src/web/` module around existing AuthorOS private commands. The web controller interprets natural-language requests, guards destructive actions with confirmation, runs long AuthorOS operations as jobs, and serves a plain HTML/CSS/JS UI.

**Tech Stack:** Node 24 built-in HTTP, Node test runner, existing AuthorOS private command functions, no React/Vite for MVP.

---

## File Map

- Create `src/web/agent.ts`: intent routing, new-book intake state, action planning.
- Create `src/web/jobs.ts`: in-memory async job runner and progress event store.
- Create `src/web/downloads.ts`: chapter download and zip assembly helpers.
- Create `src/web/auth.ts`: token validation helpers.
- Create `src/web/server.ts`: HTTP routes, static UI, SSE events.
- Create `src/web/public/app.html`: single-page UI.
- Create `tests/web-agent.test.ts`: intent and intake behavior.
- Create `tests/web-downloads.test.ts`: chapter and zip download helpers.
- Create `tests/web-server.test.ts`: token gate and basic API behavior.
- Modify `src/cli.ts`: add `author web` command.
- Modify `README.md`: add local web command and tunnel note after implementation.

## Task 1: Agent Intent And Intake

**Files:**
- Create: `src/web/agent.ts`
- Test: `tests/web-agent.test.ts`

- [ ] Write failing tests for: vague new-book request asks intake questions; explicit direct-start creates a `new_book_confirmed` action; feedback text routes to preview; apply/download/continue intents route correctly.
- [ ] Run `node --test tests/web-agent.test.ts` and verify it fails because `src/web/agent.ts` does not exist.
- [ ] Implement `createWebAgentSession()`, `handleAgentMessage()`, and typed action results.
- [ ] Run `node --test tests/web-agent.test.ts` and verify it passes.

## Task 2: Jobs And Progress Events

**Files:**
- Create: `src/web/jobs.ts`
- Test: `tests/web-jobs.test.ts`

- [ ] Write failing tests for job lifecycle: initial `received`, pushed progress events, `completed`, and `failed` with message.
- [ ] Run `node --test tests/web-jobs.test.ts` and verify it fails because job runner is missing.
- [ ] Implement in-memory `JobStore` with `createJob`, `append`, `complete`, `fail`, `get`, and `listEvents`.
- [ ] Run `node --test tests/web-jobs.test.ts` and verify it passes.

## Task 3: Downloads

**Files:**
- Create: `src/web/downloads.ts`
- Test: `tests/web-downloads.test.ts`

- [ ] Write failing tests for safe Markdown filename and chapter zip containing only `chapters/NNNN.md`.
- [ ] Run `node --test tests/web-downloads.test.ts` and verify it fails because download helpers are missing.
- [ ] Implement `readChapterDownload()` and `buildChaptersZip()` using a minimal stored zip writer.
- [ ] Run `node --test tests/web-downloads.test.ts` and verify it passes.

## Task 4: HTTP Server And Token Gate

**Files:**
- Create: `src/web/auth.ts`
- Create: `src/web/server.ts`
- Create: `src/web/public/app.html`
- Test: `tests/web-server.test.ts`

- [ ] Write failing tests for token gate, `/api/books`, `/api/chat`, and static HTML serving.
- [ ] Run `node --test tests/web-server.test.ts` and verify it fails because server is missing.
- [ ] Implement `createWebServer()` with route helpers and JSON utilities.
- [ ] Use existing private command functions for books/status/read/download.
- [ ] Run `node --test tests/web-server.test.ts` and verify it passes.

## Task 5: CLI Entry And Docs

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Test: `tests/web-server.test.ts`

- [ ] Write a failing CLI test that `run(['web', '--help'])` prints usage.
- [ ] Run targeted test and verify the command is unknown.
- [ ] Add `web` command dispatch and `runWeb()` parser for `--root`, `--port`, and `--host`.
- [ ] Update README with `author web --root D:\Books\authoros-web --port 8787` and Cloudflare Tunnel note.
- [ ] Run targeted tests and full `npm.cmd test`.

## Acceptance Run

- [ ] `node --test tests/web-agent.test.ts tests/web-jobs.test.ts tests/web-downloads.test.ts tests/web-server.test.ts`
- [ ] `npm.cmd test`
- [ ] `npm.cmd run build`
- [ ] Manual local start: `node D:\AI\AuthorOS-v2\src\cli.ts web --root D:\Books\authoros-web --port 8787`
