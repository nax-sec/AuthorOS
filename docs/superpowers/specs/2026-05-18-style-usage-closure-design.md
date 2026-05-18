# Style Usage Closure Design

**Goal:** Make style extraction and chapter continuation visibly connected, so the user knows what style was extracted and which style the next chapter will use.

## Scope

This slice does not change the style extraction algorithm or chapter generation prompt. It only improves feedback around the existing style pipeline.

## User Experience

After extracting a style profile from the cockpit, the assistant chat reports a compact summary:

- profile name,
- extracted description,
- one or two rules from `antiAiVoice` and `avoid`.

The style panel also keeps a visible `规则预览` line for the current or newest visible profile.

When the current book has an active style generation snapshot, the next action hint says:

`下一章将使用文风：<profile name>`

This line appears near the `继续写第 N 章` button, so the user sees the active style before starting generation.

## Data Flow

`POST /api/style/extract` adds a `summary` field to the response. The summary is deterministic and derived from the saved `StyleProfile`, not another model call.

`getCockpitOverview()` extends the continue next-action with optional `styleHint` when `style.generation.active` is true and the current style profile is known.

## Tests

Add tests for:

- `/api/style/extract` returns `summary.rulesPreview`.
- active cockpit generation adds `nextAction.styleHint`.
- HTML contains `规则预览`, `formatStyleSummary`, and renders `styleHint` in the next action hint.

## Self Review

- No placeholders remain.
- The feature is narrow and reuses existing style data.
- It improves user confidence without changing generation behavior.
