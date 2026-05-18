# Style Generation Cockpit Design

**Goal:** Make the personal cockpit show whether the current book's bound style profile is actually active in chapter generation, and let the user sync or bind a profile without using the CLI.

## Scope

This slice implements option B: status plus one-click sync/bind. It does not implement reference-text upload, style extraction from the web UI, profile deletion, or a full style management screen. Those belong in a later writing-style module.

## User Experience

The existing "文风档案" panel stays in the right rail. It gains a generation status line:

- `生成接入：已启用` when `.authoros/private/style-binding.json` contains a profile snapshot matching the active binding.
- `生成接入：需要同步文风快照` when the book has an older binding without the embedded snapshot.
- `生成接入：尚未绑定文风` when no style is bound.

When a current profile exists, the panel shows a `同步到写作生成` button. Clicking it re-binds the same profile through the server, which refreshes the embedded snapshot used by `write.ts`. When global profiles exist, the panel also lists profile choices with `绑定到当前书` buttons.

## Data Flow

`getCockpitOverview()` already loads global style profiles and the current binding. It will also read the book-local style snapshot through `readBookStyleProfile(projectDir)`. The cockpit response adds `style.generation`, a small status object describing whether the next model draft will receive `bound_style_profile`.

The web server adds `POST /api/style/bind` with JSON `{ "profileId": "<id>" }`. The route resolves the current private book, calls `bindStyleProfile(root, projectDir, profileId)`, and returns the updated binding. The existing binding implementation writes both the binding and embedded profile snapshot, so sync and bind use the same path.

## Error Handling

The bind endpoint rejects missing or non-string `profileId` with HTTP 400. Missing profile, missing current book, or invalid binding state return the existing JSON error envelope. The front end shows failures in the assistant chat log and leaves the page state unchanged until refresh succeeds.

## Tests

Add tests for:

- Cockpit style generation status for missing binding, old binding without snapshot, and active snapshot.
- `POST /api/style/bind` writing `.authoros/private/style-binding.json` with an embedded `profile`.
- The HTML shell exposing the generation status text, sync button, profile bind buttons, and the `/api/style/bind` call.

## Self Review

- No placeholders remain.
- Scope is intentionally limited to cockpit visibility and bind/sync control.
- The design reuses `bindStyleProfile()` as the only state mutation path, so CLI and web stay consistent.
