# Style Rewrite Preview v1.2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every production-code change: write the focused failing test first, run it, then implement the minimum code to pass.

**Goal:** Let the user generate a bound-style rewrite preview for a chapter, including anti-AI-voice cleanup, then explicitly apply that saved preview without silently overwriting canonical prose.

**Architecture:** Extend the existing private feedback preview/apply pattern with a separate pending style rewrite record. `reviseChapter()` will expose the generated preview content when `write:false`; private style commands persist that preview under the current book and apply the saved content only if the current chapter still matches the preview baseline hash. Web quality/cockpit surfaces the pending preview, and Author Assistant routes simple “去 AI 味 / 仿写文风 / 应用文风修改” intents.

**Tech Stack:** Node.js 24 native TypeScript execution, `node:test`, existing private bookshelf commands, existing Web job store, file-backed `.authoros/private/*.json` records, existing single-file Web app.

---

## Scope

This plan implements the v1.2b slice from `docs/superpowers/specs/2026-05-18-personal-cockpit-style-engine-design.md`:

- Generate style rewrite previews for the current private book.
- Support intents:
  - `imitate_style`
  - `remove_ai_voice`
  - `style_polish`
- Persist a pending style rewrite preview.
- Apply the saved preview only after explicit confirmation.
- Show pending style rewrite state in the quality loop and Web UI.
- Route basic assistant phrases to preview/apply jobs.

This plan does **not** implement:

- Automatic style injection during normal chapter drafting.
- A full diff viewer.
- Multiple simultaneous pending style previews.
- Deep AI-detection scoring.

---

## Data Model

Pending style rewrites live beside existing private pending feedback:

```text
<private-root>/books/<book-id>/.authoros/private/pending-style-rewrite.json
```

JSON shape:

```ts
interface PrivatePendingStyleRewrite {
  version: 1;
  book_id: string;
  chapter: number;
  profile_id: string;
  profile_name: string;
  intent: 'imitate_style' | 'remove_ai_voice' | 'style_polish';
  text: string;
  instruction: string;
  created_at: string;
  original_hash: string;
  preview_content: string;
  rationale: string;
  original_char_count: number;
  revised_char_count: number | null;
}
```

Safety rules:

- Preview never writes `chapters/NNNN.md`.
- Apply writes the saved `preview_content`; it does not call the model again.
- Apply fails if `original_hash` no longer matches the current chapter file.
- Apply creates `chapters/NNNN.draft.md` only if it does not already exist, matching existing revise behavior.
- Preview requires a bound style profile.

---

## Task 1: Expose Revise Preview Content

**Files:**

- Modify: `src/commands/revise.ts`
- Modify: `tests/revise.test.ts`

**TDD steps:**

- [ ] Add a failing test to `tests/revise.test.ts`:
  - Call `revise` through `run()` with `--model` and `--instruction`, but without `--write`.
  - Assert the chapter file remains unchanged.
  - Import and call `reviseChapter()` directly with the same fake LLM and assert `result.previewContent` contains the wrapped revised chapter.
  - Assert `result.written === false`.
- [ ] Run:

```bash
node --test tests/revise.test.ts
```

Expected: fail because `ReviseResult.previewContent` does not exist.

- [ ] Implement:
  - Add `previewContent: string | null` to `ReviseResult`.
  - When model decides `changed` and returns a new body, set `previewContent` to the full wrapped chapter content whether or not `write` is true.
  - Preserve existing write behavior.
- [ ] Re-run:

```bash
node --test tests/revise.test.ts
```

Expected: pass.

---

## Task 2: Private Style Rewrite Preview And Apply

**Files:**

- Modify: `src/commands/private.ts`
- Modify: `tests/private.test.ts`

**TDD steps:**

- [ ] Add failing tests to `tests/private.test.ts`:
  - Current book with no bound style rejects `previewPrivateStyleRewrite()` with `AuthorOsError`.
  - Bound style + drafted chapter + fake LLM creates `.authoros/private/pending-style-rewrite.json`, stores `preview_content`, and leaves `chapters/0001.md` unchanged.
  - `applyPrivateStyleRewrite()` writes the saved preview, creates/preserves `chapters/0001.draft.md`, and deletes the pending file.
  - Applying after the current chapter file changed rejects with a clear hash-mismatch error and leaves the chapter unchanged.
- [ ] Run:

```bash
node --test tests/private.test.ts
```

Expected: fail because the private style rewrite functions do not exist.

- [ ] Implement in `src/commands/private.ts`:
  - Export `PrivateStyleRewriteIntent`.
  - Export `PrivatePendingStyleRewrite`.
  - Export `previewPrivateStyleRewrite(root, opts)`.
  - Export `applyPrivateStyleRewrite(root, opts?)`.
  - Export `renderPrivateStyleRewriteResult()` and `renderPrivateStyleApplyResult()`.
  - Use `readStyleBinding(root, projectDir)` from `src/commands/style.ts`.
  - Build an instruction from the bound style profile rules and the selected intent.
  - Use `reviseChapter(..., write:false, instruction)`.
  - Require `revise.previewContent` before writing a pending preview.
  - Use SHA-256 of the current chapter file as `original_hash`.
  - On apply, compare the stored hash to the current chapter file hash before writing.
- [ ] Re-run:

```bash
node --test tests/private.test.ts
```

Expected: pass.

---

## Task 3: CLI Commands For Private Style Rewrite

**Files:**

- Modify: `src/cli.ts`
- Modify: `tests/private.test.ts`

**TDD steps:**

- [ ] Add failing CLI tests to `tests/private.test.ts`:
  - `author private style-preview --intent anti-ai --root <root>` creates pending style rewrite.
  - `author private style-apply --root <root>` applies the pending style rewrite without requiring an LLM.
  - `author private --help` mentions `style-preview` and `style-apply`.
- [ ] Run:

```bash
node --test tests/private.test.ts
```

Expected: fail because the CLI subcommands do not exist.

- [ ] Implement in `src/cli.ts`:
  - Import private render/functions from `private.ts`.
  - Add subcommands:
    - `style-preview`
    - `style-apply`
  - Parse `--intent` values:
    - `imitate`, `imitate-style`, `style` => `imitate_style`
    - `anti-ai`, `remove-ai`, `remove-ai-voice`, `去ai味` => `remove_ai_voice`
    - `polish`, `style-polish` => `style_polish`
  - `style-preview` requires a model client for the current book.
  - `style-apply` does not require a model client.
  - Update private help text.
- [ ] Re-run:

```bash
node --test tests/private.test.ts
```

Expected: pass.

---

## Task 4: Quality Overview And Web UI Pending Style Preview

**Files:**

- Modify: `src/web/quality.ts`
- Modify: `src/web/public/app.html`
- Modify: `tests/web-quality.test.ts`
- Modify: `tests/web-app-html.test.ts`

**TDD steps:**

- [ ] Add failing tests:
  - `getQualityOverview()` reads `.authoros/private/pending-style-rewrite.json` and exposes `styleRewritePreview`.
  - Quality signals include `第 N 章有文风改写预览待确认`.
  - HTML contains `styleRewritePreview`, `文风改写预览`, and `应用文风修改`.
- [ ] Run:

```bash
node --test tests/web-quality.test.ts tests/web-app-html.test.ts
```

Expected: fail because quality/UI do not know style rewrite previews.

- [ ] Implement:
  - Add `QualityStyleRewritePreview`.
  - Add `styleRewritePreview: QualityStyleRewritePreview | null` to `QualityOverview`.
  - Read and validate pending style rewrite metadata.
  - In Web UI, render pending style rewrite inside the existing pending preview area or style card.
  - Keep visible labels in Simplified Chinese.
- [ ] Re-run:

```bash
node --test tests/web-quality.test.ts tests/web-app-html.test.ts
```

Expected: pass.

---

## Task 5: Web Agent And Web Server Jobs

**Files:**

- Modify: `src/web/agent.ts`
- Modify: `src/web/agent-llm.ts`
- Modify: `src/web/server.ts`
- Modify: `tests/web-agent.test.ts`
- Modify: `tests/web-agent-llm.test.ts`
- Modify: `tests/web-server.test.ts`

**TDD steps:**

- [ ] Add failing tests:
  - Rule agent routes `去 AI 味` to a `style_rewrite_preview` job command.
  - Rule agent routes `确认应用文风修改` to a `style_rewrite_apply` job command.
  - LLM agent supports `style_rewrite_preview` and `style_rewrite_apply` JSON actions.
  - Web server job runs preview/apply commands and records phases `style_check` and `style_apply`.
- [ ] Run:

```bash
node --test tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-server.test.ts
```

Expected: fail because actions/commands do not exist.

- [ ] Implement:
  - Add `style_rewrite_preview` and `style_rewrite_apply` to Web agent action types.
  - Add Web commands:
    - `{ type: 'style_rewrite'; chapter: 'latest'; intent: PrivateStyleRewriteIntent; text: string }`
    - `{ type: 'style_apply' }`
  - Route phrases:
    - `去 AI 味`, `去ai味`, `AI味`, `不像 AI`, `文风改写`, `仿写文风`, `按文风润色`
    - `确认应用文风`, `应用文风修改`, `应用这次文风`
  - Update LLM prompt allowed actions and parser.
  - Update `runCommandJob()` to call private style preview/apply functions.
- [ ] Re-run:

```bash
node --test tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-server.test.ts
```

Expected: pass.

---

## Task 6: Verification And Commit

- [ ] Run focused tests:

```bash
node --test tests/revise.test.ts tests/private.test.ts tests/web-quality.test.ts tests/web-app-html.test.ts tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-server.test.ts
```

- [ ] Run all tests:

```bash
node --test tests/*.test.ts
```

- [ ] Run build:

```bash
node scripts/build.mjs
```

- [ ] Local smoke:
  - Start or reuse `author web --root private-author --port 59273`.
  - Confirm `GET /` contains `文风改写预览`.
  - Confirm `GET /api/cockpit` returns `quality.styleRewritePreview` as `null` when no pending rewrite exists.

- [ ] Commit:

```bash
git add docs/superpowers/plans/2026-05-18-style-rewrite-preview-v1-2b.md src/commands/revise.ts src/commands/private.ts src/cli.ts src/web/quality.ts src/web/public/app.html src/web/agent.ts src/web/agent-llm.ts src/web/server.ts tests/revise.test.ts tests/private.test.ts tests/web-quality.test.ts tests/web-app-html.test.ts tests/web-agent.test.ts tests/web-agent-llm.test.ts tests/web-server.test.ts
git commit -m "feat: add style rewrite previews"
```

