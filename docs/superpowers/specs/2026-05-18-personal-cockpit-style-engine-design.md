# AuthorOS Personal Cockpit + Writing Style Engine Design

Date: 2026-05-18

## Summary

AuthorOS will focus next on personal daily use, not friend-demo rooms or full SaaS.

The target product shape is a local-first personal writing cockpit:

- A single-user Web cockpit is the main interface.
- Author Assistant chat becomes the creative command surface.
- A Web-level session status area provides the "always there" feeling for v1.
- A true macOS resident shell is deferred until the Web cockpit is stable.
- Writing style extraction, style profiles, imitation, and anti-AI-voice checks become a cross-cutting Writing Style Engine.

This keeps the current AuthorOS CLI loop intact while making it usable without remembering command sequences.

## Goals

- Make AuthorOS feel like a daily personal writing workspace.
- Turn `plan -> write -> review -> revise -> decide -> memory` into visible workflow state.
- Make long-running jobs understandable, recoverable, and actionable.
- Keep reader feedback and style rewrites preview-first before any canonical chapter overwrite.
- Add a reusable style system for extracting, binding, checking, and applying writing styles.
- Preserve the local-first model: data stays in the private bookshelf root unless explicitly exported.

## Non-Goals

- No full SaaS user system in this phase.
- No formal multi-user accounts, passwords, billing, admin dashboard, or permissions model.
- No Electron or packaged desktop app in v1.
- No complex vector database or RAG system in v1.
- No one-click full-book autopilot in v1.
- No automatic application of reader feedback, style rewrites, or memory updates without user approval.

## Product Modules

### 1. Personal Home

The first screen should answer:

- Which book am I working on?
- What happened last?
- Is anything running now?
- What should I do next?
- Is model configuration healthy?

The home view should show the current book, latest chapter, current or last job, pending feedback or style previews, and next recommended actions.

### 2. Single-Book Workbench

The book workbench is the main daily workspace for one book. It should expose:

- Book metadata and concept.
- Chapter list and chapter states.
- Latest chapter reader.
- Continue-writing action.
- Feedback preview and apply actions.
- Download actions.
- Links into setup assets, memory, and style profiles.

The user should not need to remember `author private continue`, `read`, `feedback`, or `apply` for normal use.

### 3. Task Center

The task center should replace raw progress text with structured job state:

- Job action.
- Job phase.
- Start and finish times.
- Events.
- Result summary.
- Failure reason.
- Retry or continue suggestion where possible.

In v1, jobs should be persisted enough that page refreshes do not erase the user's sense of what happened. Full process resurrection can come later; the first requirement is durable state and honest recovery guidance.

### 4. Author Assistant Chat

Author Assistant is the creative command surface inside the cockpit. It should understand and route:

- Start a book.
- Continue the current book.
- Read a chapter.
- Preview feedback.
- Apply approved feedback.
- Check status.
- Extract a style.
- Bind or inspect a style profile.
- Generate an anti-AI-voice rewrite preview.
- Explain the next step.

Author Assistant should remain a writing agent and command router. It should not become the operating-system resident shell.

### 5. Quality Loop Panel

The quality panel makes the chapter lifecycle visible:

- Planned.
- Drafted.
- Reviewed.
- Revision previewed.
- Revision applied.
- Reader feedback pending.
- Decision generated.
- Memory update pending or complete.
- Style check pending or complete.

It should emphasize preview boundaries. If a generated rewrite has not been applied, the UI must make that obvious.

### 6. Asset Panel

The asset panel shows the durable writing assets that shape the book:

- Product positioning.
- Worldbuilding.
- Character files.
- Outline.
- Author profile.
- Memory files.
- Style profiles.
- Anti-AI-voice rules.

v1 can start with read-focused views and lightweight edit or open actions. Deep asset editing can be incremental.

## Workflow Abilities

### 1. Book Commitment Gate

Creating a new book should produce a readable commitment card before deep chapter production:

- Genre and promise.
- Protagonist desire.
- Core conflict.
- Reader hook.
- Boundaries and forbidden directions.
- First-act or first-10-chapter direction.

For v1, this can be shown after setup as an editable summary, not necessarily as a hard blocking approval gate.

### 2. Chapter Queue / Next Chapter Card

The cockpit should show the next executable chapter card:

- Chapter number.
- Current state.
- Planned action.
- Expected stages.
- Blocking missing artifacts.
- Primary action button.

"Continue" should be explained before it runs.

### 3. Phase-Level Pause and Recovery

Long tasks should expose phase state such as:

- setup
- planning
- writing
- reviewing
- revising
- feedback_preview
- applying
- deciding
- memory
- style_extract
- style_check

If a task fails, the user should see where it failed and what the safest next action is.

### 4. Draft and Preview Comparison

Canonical drafts, feedback previews, style rewrites, and applied revisions should be distinguishable.

The user should be able to compare:

- Current chapter draft.
- Pending revision preview.
- Pending style rewrite preview.
- Applied result after confirmation.

The first implementation can use tabbed or stacked views before adding a full diff viewer.

### 5. Quality Signals

The cockpit should show simple quality signals first:

- Word count and configured target range.
- Missing stage warnings.
- Pending feedback.
- Pending memory update.
- Last job failure.
- Style profile bound or missing.
- Anti-AI-voice check status.

Advanced AI-voice detection and deep consistency scoring are later work.

### 6. Memory Review

Memory update should become a user-visible review step:

- New facts.
- Character changes.
- World changes.
- Foreshadowing and payoff notes.
- Style or tone changes worth preserving.

v1 may show generated memory deltas and mark them pending; approval and merge UX can follow.

### 7. Local Rewrite Intents

The assistant should support specific rewrite intents:

- Strengthen the ending hook.
- Rewrite the opening.
- Reduce exposition.
- Reduce dialogue.
- Increase pressure.
- Preserve plot but change style.
- Remove AI-like phrasing.

Each rewrite intent should generate a preview before application.

### 8. Daily Writing Session

The cockpit should track the current writing session:

- Last opened time.
- Last active book.
- Last completed action.
- Chapters touched.
- Words generated or revised when available.
- Next recommended action.

In v1, this lives inside the Web cockpit. A future macOS shell can surface the same state outside the browser.

## Writing Style Engine

The Writing Style Engine is a cross-cutting capability, not a separate side product.

### Style Extraction

The user can provide reference text or select existing chapters. AuthorOS extracts executable style rules:

- Sentence length and rhythm.
- Paragraph density.
- Dialogue density.
- Narrative distance.
- Sensory detail preference.
- Metaphor and imagery habits.
- Pacing patterns.
- Words or sentence patterns to avoid.
- Anti-AI-voice observations.

The output should be a structured style profile, not a vague prose summary.

### Style Profiles

Style profiles are reusable assets. A profile can be:

- Global in the private root.
- Bound to a specific book.
- Used temporarily for one chapter or rewrite.

Profiles should have names, descriptions, created timestamps, source notes, and structured rules.

### Style Application

Style application should happen in controlled places:

- During chapter writing.
- During revision.
- During local rewrite intent previews.
- During anti-AI-voice rewrite previews.

Style application must preserve plot, characters, and continuity unless the user asks otherwise.

### Anti-AI-Voice Rules

The engine should maintain a basic anti-AI-voice rule set. Initial checks should look for:

- Generic summarizing endings.
- Over-explained emotions.
- Template transitions.
- Empty rhetorical parallelism.
- Repeated abstract nouns.
- Characters explaining themes too directly.
- Over-neat paragraph rhythm.

The result should be actionable: cite patterns and offer a rewrite preview.

### Copyright and Imitation Boundary

Style extraction should focus on high-level writing characteristics and user-provided text. The system should avoid copying distinctive protected expression from living authors or supplied copyrighted passages. The UI should frame this as style guidance and transformation, not cloning.

## Resident Shell Boundary

The resident shell and Author Assistant are intentionally separate.

Author Assistant:

- Lives inside AuthorOS writing workflows.
- Understands creative intent.
- Routes writing commands.
- Asks for confirmations.
- Produces or previews writing changes.

Resident shell:

- Starts or opens AuthorOS.
- Shows service health.
- Shows current book and current task.
- Opens the Web cockpit.
- Eventually can live as a macOS menu bar or desktop wrapper.

For v1, implement only the Web-level session status area. Do not build a native resident shell yet.

## Data Model Additions

The design implies these persistent records:

- Job history under the private root or room root.
- Session state for last active book and last completed action.
- Pending previews for feedback and style rewrites.
- Style profiles.
- Book-to-style binding.
- Quality state summary derived from existing project files plus pending records.

The data should remain file-based and local-first. JSON is acceptable for metadata; Markdown remains appropriate for human-readable generated artifacts.

## Architecture Notes

- Keep CLI commands as the durable core.
- Add Web APIs as thin orchestration and presentation layers.
- Persist job/session metadata in the private root rather than only memory.
- Keep feedback, style rewrites, and memory changes preview-first.
- Keep room isolation behavior intact when `AUTHOROS_WEB_ROOMS` is set.
- Avoid coupling v1 to Electron or macOS-specific APIs.

## Suggested Delivery Phases

### v1: Personal Cockpit Skeleton

- Personal home.
- Single-book workbench.
- Task center with persisted job history.
- Author Assistant command routing in Web.
- Web session status area.
- Chapter completion auto-display.
- Next action recommendations.

### v1.1: Chapter Production Line

- Chapter queue and next chapter card.
- Phase-level recovery guidance.
- Draft and preview comparison.
- Quality loop panel.
- Memory review visibility.

### v1.2: Writing Style Engine

- Style extraction command and API.
- Style profile storage.
- Book-to-style binding.
- Style-aware write/revise prompts.
- Anti-AI-voice check.
- Style rewrite preview.

### v1.3: Resident Shell

- Lightweight local launcher or macOS service pattern.
- Open current cockpit.
- Show service status.
- Resume current session.

Do not start v1.3 until the Web cockpit state model is stable.

## Testing Strategy

- Unit tests for style profile parsing and persistence.
- Unit tests for persisted job lifecycle.
- Web server tests for session state, task state, room isolation, and assistant routing.
- Private command tests for any new style extraction or style application commands.
- Regression tests that feedback and style rewrites do not overwrite chapters until apply.
- Build verification with `node scripts/build.mjs`.
- Test verification with `node --test tests/*.test.ts` in this environment when npm is unavailable.

## Acceptance Criteria

- Opening the Web UI shows current book, last task, next action, and service/model status.
- Continuing a book creates a visible persisted job with phase events.
- Completed chapter jobs automatically make the latest chapter readable in the UI.
- Feedback and style rewrites create clear pending previews before apply.
- The quality panel shows missing or pending workflow stages.
- Style profiles can be created, listed, bound to a book, and used by at least one preview or writing flow.
- Refreshing the page does not erase the user's understanding of recent tasks.
- Room isolation still works when room mode is enabled.
