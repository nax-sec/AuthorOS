# Style Extract Cockpit Design

**Goal:** Let the personal cockpit create a style profile from pasted reference prose, then optionally bind it to the current book so the next chapter generation uses it.

## Scope

This slice adds a compact extraction form to the existing "文风档案" panel. It does not implement file upload, profile deletion, multi-sample libraries, or LLM-based literary analysis. The existing deterministic style extractor remains the source of truth.

## User Experience

The style panel gains:

- a name input for the style profile,
- a reference prose textarea,
- a primary button `提炼并绑定`,
- a secondary button `仅提炼`.

When the user clicks `提炼并绑定`, the server creates a global style profile under `.authoros/styles/profiles/`. If a current book exists, it also binds the new profile to that book, which refreshes the generation snapshot used by chapter drafting. The cockpit reloads and shows the new profile in the same panel.

## Data Flow

`POST /api/style/extract` accepts:

```json
{
  "name": "雨夜冷调",
  "text": "reference prose",
  "bind": true
}
```

The route calls `createStyleProfileFromText(root, { name, text, sourceNote: "web cockpit sample" })`, saves it with `saveStyleProfile()`, and, when `bind` is true and a current book exists, calls `bindStyleProfile(root, currentBookDir, profile.id)`.

## Error Handling

Blank names return HTTP 400. Short or invalid reference text uses the existing `AuthorOsError` message from the extractor. When `bind` is true but there is no current book, the endpoint still saves the profile and returns `binding: null`; the UI will refresh and show the profile as available for later binding.

## Tests

Add tests for:

- `POST /api/style/extract` saving a profile and binding it to the current book.
- `POST /api/style/extract` rejecting blank name with HTTP 400.
- The HTML shell containing the extraction form, buttons, and API call.

## Self Review

- No placeholders remain.
- The extraction endpoint reuses the existing style command module and does not duplicate style parsing.
- The UI stays in the existing style panel rather than becoming a new module prematurely.
