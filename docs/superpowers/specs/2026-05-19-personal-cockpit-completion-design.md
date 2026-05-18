# Personal Cockpit Completion Design

## Goal

This iteration turns the current AuthorOS Web cockpit from a feature-rich MVP into a daily single-user writing workspace. The user should be able to open the page, understand the current book state, configure the model, choose the safest next writing action, compare previews before applying them, review memory deltas, and inspect core writing assets without remembering CLI commands.

The work completes the remaining practical surface of the six product modules and eight workflow abilities already defined in the May 18 cockpit/style-engine spec. The emphasis is personal use, not multi-user productization.

## Current Baseline

Already working:

- Personal cockpit shell with current book, latest chapter, next action, task center, quality loop, author assistant, resident session strip, model status, and style panel.
- Web model configuration, including local API key save through `.authoros/model.secret.json`.
- Chapter continuation, reading, downloads, feedback preview/apply, style rewrite preview/apply, quality artifacts, memory delta view/review/merge, and structured YAML memory updates.
- Persisted Web jobs, readable failure explanation, phase progress messages, and basic recovery actions.

Main gaps:

- The UI still reads as stacked feature panels instead of one guided writing desk.
- Chapter production state exists but is not easy to scan across chapters.
- Preview content is visible but not yet a true current-vs-preview comparison surface.
- Rewrite intents are limited to broad feedback and style actions.
- Memory review is functional but still too raw for daily creative judgment.
- Asset visibility is incomplete: product, world, characters, outline, memory, and style are not gathered into one readable asset panel.
- Daily session state and book commitment are not yet explicit enough to prevent drift.

## Non-Goals

- No React/Vite migration in this iteration.
- No formal account system, permissions, billing, or admin dashboard.
- No native macOS menu bar app yet.
- No full semantic vector memory or RAG system.
- No live model call from tests or browser smoke verification.
- No rich in-browser asset editor in the first completion pass; assets are read-first with lightweight actions.

## Prioritized Scope

### P0: Information Architecture And Model Confidence

The first screen becomes a clearer three-zone writing desk:

- Left rail: current book, next action, model health, daily session summary.
- Center: chapter reader, chapter production line, and preview comparison surface.
- Right rail: author assistant, rewrite intents, model configuration, assets, and task center.

Model configuration remains in the page. Its status should be visible near the next action and in the model panel. Failed model jobs should link the user back to the model panel and show whether the key comes from environment or local save.

Success criteria:

- The user can tell whether the model is callable without opening a separate recovery card.
- The next action card explains what will happen before the user clicks.
- The most important writing surface is the center column, not the task log.

### P1: Chapter Production Line

Add a scan-friendly chapter production line. Each drafted or next chapter shows:

- Chapter number and title label.
- Stage states: plan, draft, internal review, reader simulation, decision, memory, feedback preview, style preview.
- Blocking reason or next executable stage.
- Primary action for the next missing stage.

This view should reuse `getProjectState`, `getQualityOverview`, job history, pending feedback, pending style rewrite, and memory deltas. It should not invent a separate source of truth.

Success criteria:

- The user can see which chapter is blocked and why.
- The user can execute the next quality action without typing a command.
- Pending previews and pending memory deltas are visually distinct from completed artifacts.

### P1: Preview Comparison

Feedback previews and style rewrite previews become comparison surfaces:

- Current chapter draft on one side.
- Pending preview on the other side.
- Metadata: intent, rationale, profile name when relevant, created time, original/revised character counts.
- Actions: apply preview, discard or regenerate through assistant, read current chapter.

The first version uses side-by-side text panes and summary metadata. A line-level diff can come later if the side-by-side surface proves insufficient.

Success criteria:

- The user can compare current and preview text before applying.
- Applying a preview remains explicit and never happens from generation alone.
- Stale preview protection remains intact.

### P1: Rewrite Intent Panel

Add explicit local rewrite intent buttons:

- 去 AI 味
- 仿写文风
- 文风润色
- 强化开头
- 强化章尾钩子
- 减少解释
- 增加压迫感
- 对白瘦身
- 保留剧情换文风

Style-specific intents continue to use the style rewrite preview path when a bound style exists. General craft intents use the existing feedback/revise preview path with a clear instruction. Every rewrite intent produces a preview first.

Success criteria:

- Each intent maps to a deterministic assistant message or command.
- No intent overwrites chapter text without an apply action.
- If style is required and missing, the UI guides the user to bind or extract a style.

### P1: Memory Review Cards

Convert memory delta review from raw markdown-first to card-first:

- 正史设定
- 伏笔
- 主线
- 人物状态
- 文风规则

Each card shows proposed items and the merge plan for each item:

- 结构化更新
- 注释保底
- 追加记录

The raw delta remains available in a collapsible or secondary section for debugging.

Success criteria:

- The user can understand what will be written before merging.
- YAML structured updates and fallback comments are clearly labeled.
- Existing merge safety remains unchanged.

### P2: Asset Panel

Add a read-first asset panel for durable writing assets:

- `product.md`
- `world.md`
- `characters.md`
- `outline.md`
- `author.md`
- `memory/canon.md`
- `memory/foreshadowing.yaml`
- `memory/plot_threads.yaml`
- `memory/character_state.yaml`
- `memory/style.md`
- Current style profile and anti-AI-voice rules.

The first implementation exposes a list, preview pane, and copy/download/open-style actions where appropriate. Editing can be added later after the read experience is dependable.

Success criteria:

- The user can inspect all important book guidance from the cockpit.
- Missing assets are shown as missing, not as generic failures.
- Asset reads stay scoped to the current book and room root.

### P2: Book Commitment Card

Add a derived commitment card after a book exists:

- Genre/promise.
- Protagonist desire.
- Core conflict.
- Reader hook.
- Boundaries and forbidden directions.
- First-act or first-10-chapter direction.

The first version derives this from existing identity files and outline. It does not add a blocking approval gate.

Success criteria:

- The card gives a fast answer to “what are we writing, and what should we not drift into?”
- The card updates when the current book changes.
- The card is useful even when some identity files are sparse.

### P2: Daily Writing Session

Add a daily session summary inside the Web cockpit:

- Last opened time.
- Last active book.
- Last completed action.
- Current running action.
- Chapters touched by recent jobs when available.
- Next recommended action.

This stays in Web for now. It should be derived from current book and job history unless a small `.authoros/web/session.json` becomes necessary for last-open tracking.

Success criteria:

- Opening the app gives a quick “where was I?” answer.
- Session summary survives page refresh.
- It does not pretend to resurrect interrupted model calls.

### P3: Verification And Hardening

Run the full project verification after each slice and do browser smoke tests for the completed cockpit.

Required end-to-end smoke path:

1. Start with a temp private root.
2. Save model config through the cockpit path without exposing the key.
3. Create or load a book.
4. Show chapter production line.
5. Show asset panel and commitment card.
6. Create or seed pending feedback/style preview and compare it.
7. Seed a memory delta and show memory review cards with merge actions.
8. Confirm no console errors.

## Architecture

The implementation keeps the current stack:

- Node.js native TypeScript.
- Existing `src/web/server.ts` HTTP routes.
- Existing single-file `src/web/public/app.html`.
- Existing private bookshelf and command modules as durable behavior.

Likely module changes:

- Extend `src/web/cockpit.ts` with commitment, session, and asset summaries.
- Extend `src/web/quality.ts` for chapter production line and comparison metadata where it belongs.
- Add a focused `src/web/assets.ts` for safe current-book asset reads.
- Add a focused `src/web/commitment.ts` if commitment derivation becomes too large for `cockpit.ts`.
- Extend `src/web/server.ts` with asset and comparison routes.
- Extend `src/web/agent.ts` and `src/web/agent-llm.ts` for rewrite intent routing.
- Refactor `src/web/public/app.html` in slices, keeping CSS and JS organized by surface to reduce the risk of a giant brittle edit.

## Data Flow

Page load:

1. `GET /api/session` checks token and room mode.
2. `GET /api/cockpit` returns current book, model summary, jobs, quality summary, style status, session summary, commitment summary, asset summary, and next action.
3. `GET /api/chapters/latest` loads the center reader when a chapter exists.
4. Optional focused endpoints load asset contents and preview comparison details on demand.

Action flow:

1. Buttons either call existing safe APIs or send a deterministic assistant message.
2. Long model-backed work still creates Web jobs and streams events.
3. Preview-generating actions save pending preview files.
4. Apply actions verify the pending preview and current chapter baseline before writing.
5. Memory merge actions use existing preview/merge APIs and never call the model.

## Testing Strategy

Use test-first slices.

Core tests:

- `tests/web-cockpit.test.ts` for extended cockpit overview: session, commitment, asset summary, production line.
- `tests/web-quality.test.ts` for chapter stage derivation and preview comparison metadata.
- `tests/web-server.test.ts` for new API routes and room isolation.
- `tests/web-agent.test.ts` and `tests/web-agent-llm.test.ts` for rewrite intent routing.
- `tests/web-app-html.test.ts` for shell landmarks, controls, and API hooks.

Verification:

- Focused tests for each slice before implementation.
- `node --test tests/*.test.ts`.
- `node scripts/build.mjs`.
- `git diff --check`.
- Browser smoke screenshot after major UI slices.

## Delivery Order

1. P0 layout and model confidence.
2. P1 chapter production line.
3. P1 preview comparison.
4. P1 rewrite intent panel.
5. P1 memory review cards.
6. P2 asset panel.
7. P2 commitment card.
8. P2 daily session summary.
9. P3 integrated browser smoke and cleanup.

Each item should land as a small commit with tests and verification notes.

## Acceptance Criteria

The iteration is complete when:

- Opening the Web cockpit answers: current book, model health, last task, next action, and pending work.
- The user can see chapter pipeline state without reading raw job history.
- The user can compare and apply feedback/style previews safely.
- The user can trigger common rewrite intents without typing exact command phrases.
- Memory updates are readable as typed cards with merge action labels.
- Core writing assets are inspectable from the cockpit.
- The book commitment card makes drift visible.
- The daily session summary gives a useful “resume writing” cue.
- All tests, build, diff check, and browser smoke pass.

## Self-Review

- Scope is focused on single-user personal Web use.
- No new account system, native app, vector memory, or full editor is included.
- Existing model, style, quality, memory, and job modules remain the source of truth.
- Preview and apply boundaries remain explicit.
- Local API key convenience remains local-only and does not require live model tests.
