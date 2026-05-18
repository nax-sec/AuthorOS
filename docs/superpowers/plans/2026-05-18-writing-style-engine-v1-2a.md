# Writing Style Engine v1.2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan. Use `superpowers:test-driven-development` for every production-code change: write a focused failing test first, run it, then implement the minimum code to pass.

**Goal:** Land the foundation for the Writing Style Engine: extract a reusable style profile from reference text, persist profiles under the private bookshelf root, bind one profile to the current book, and surface the style state in the personal cockpit.

**Architecture:** Add a durable `style` command module for file-backed style profiles and bindings. Keep profiles global to the private root at `.authoros/styles/profiles/<id>.json`; keep book bindings inside the current book at `.authoros/private/style-binding.json`. Extend the cockpit overview with derived style status, and render it in the existing single-file Web cockpit. Do not yet implement rewrite previews, chapter prompt injection, or anti-AI rewrite application in this slice.

**Tech Stack:** Node.js 24 native TypeScript execution, `node:test`, existing CLI dispatcher, existing private bookshelf data model, existing `src/web/public/app.html`.

---

## Scope

This plan implements the v1.2a slice from `docs/superpowers/specs/2026-05-18-personal-cockpit-style-engine-design.md`:

- Structured style profile extraction from user-provided reference text.
- Local-first style profile persistence.
- Current-book style binding.
- CLI commands for extract/list/show/bind.
- Cockpit API and UI visibility for bound or missing style profile.
- Quality signal for style profile missing/bound.

This plan does **not** implement:

- “去 AI 味” rewrite previews.
- Style rewrite preview/apply flow.
- Style-aware `write`/`revise` prompt injection.
- Native macOS resident shell.

Those remain v1.2b/v1.2c after the data model is stable.

---

## Data Model

Create global private-root profiles:

```text
<private-root>/.authoros/styles/profiles/<profile-id>.json
```

Create current-book binding:

```text
<private-root>/books/<book-id>/.authoros/private/style-binding.json
```

Profile JSON shape:

```ts
interface StyleProfile {
  version: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sourceNote: string;
  sourceHash: string;
  rules: {
    sentenceRhythm: string[];
    paragraphDensity: string[];
    dialogue: string[];
    narrativeDistance: string[];
    sensoryDetail: string[];
    imagery: string[];
    pacing: string[];
    avoid: string[];
    antiAiVoice: string[];
  };
}
```

Binding JSON shape:

```ts
interface StyleBinding {
  version: 1;
  profileId: string;
  boundAt: string;
}
```

Extraction must be safe and practical:

- Use only high-level writing characteristics.
- Do not copy distinctive sentences from reference text.
- Work deterministically without an LLM so tests and local setup do not require API access.
- Accept optional LLM extraction later, but v1.2a can ship deterministic heuristics first.

---

## Task 1: Style Profile Core

**Files:**

- Create: `src/commands/style.ts`
- Create: `tests/style.test.ts`

**TDD steps:**

- [ ] Write failing tests for:
  - `createStyleProfileFromText()` creates a versioned profile with stable slug/hash id, source hash, description, and non-empty rule arrays.
  - `saveStyleProfile()` writes `.authoros/styles/profiles/<id>.json`.
  - `listStyleProfiles()` returns summaries sorted newest first.
  - `loadStyleProfile()` validates shape and rejects invalid JSON/schema.
  - Short or blank reference text throws `AuthorOsError`.
- [ ] Run:

```bash
node --test tests/style.test.ts
```

Expected: fail because `src/commands/style.ts` does not exist.

- [ ] Implement only enough to pass:
  - Export profile/binding interfaces.
  - Export `createStyleProfileFromText(root, opts)`.
  - Export `saveStyleProfile(root, profile)`.
  - Export `listStyleProfiles(root)`.
  - Export `loadStyleProfile(root, id)`.
  - Use `crypto.createHash('sha256')` for `sourceHash`.
  - Generate safe ids from the profile name plus an 8-char hash suffix.
  - Build deterministic rule arrays by analyzing paragraphs, sentence punctuation, dialogue markers, sensory words, abstract/generic words, and repeated rhythm.
- [ ] Re-run focused tests until green.

---

## Task 2: Style Binding Core

**Files:**

- Modify: `src/commands/style.ts`
- Modify: `tests/style.test.ts`

**TDD steps:**

- [ ] Add failing tests for:
  - `bindStyleProfile(root, projectDir, profileId)` verifies the profile exists and writes `.authoros/private/style-binding.json`.
  - `readStyleBinding(root, projectDir)` returns binding and loaded profile.
  - Missing binding returns `null`.
  - Binding pointing to a missing profile reports a clear `AuthorOsError`.
- [ ] Run:

```bash
node --test tests/style.test.ts
```

- [ ] Implement:
  - Export `bindStyleProfile(root, projectDir, profileId, now?)`.
  - Export `readStyleBinding(root, projectDir)`.
  - Keep binding file book-local and profile file root-global.
- [ ] Re-run focused tests until green.

---

## Task 3: CLI Style Commands

**Files:**

- Modify: `src/cli.ts`
- Create: `tests/style-command.test.ts`

**TDD steps:**

- [ ] Write failing CLI tests for:
  - `author style extract --name <name> --text-file <file> --root <root>` writes a profile and prints the id/path.
  - `author style list --root <root>` prints saved profiles.
  - `author style show <id> --root <root>` prints structured profile details.
  - `author style bind <id> --root <root>` binds the profile to the current private book.
  - Help text mentions `style`.
- [ ] Run:

```bash
node --test tests/style-command.test.ts
```

- [ ] Implement:
  - Add `style` to command dispatch.
  - Add `runStyle()`.
  - Reuse `resolvePrivateRoot()` and `privateCurrentProjectDir()` semantics.
  - Add render helpers from `src/commands/style.ts`.
  - Update top-level help and a `styleHelpText()`.
- [ ] Re-run focused tests until green.

---

## Task 4: Cockpit Style Status

**Files:**

- Modify: `src/web/cockpit.ts`
- Modify: `src/web/quality.ts`
- Modify: `tests/web-cockpit.test.ts`
- Modify: `tests/web-quality.test.ts`

**TDD steps:**

- [ ] Add failing tests for:
  - Empty bookshelf returns `style: { profiles: [], binding: null, currentProfile: null }` or equivalent stable summary.
  - Current book with no style binding reports missing style signal.
  - Current book with a bound style reports current profile name and style-bound signal.
  - Quality signals include style missing/bound status.
- [ ] Run:

```bash
node --test tests/web-cockpit.test.ts tests/web-quality.test.ts
```

- [ ] Implement:
  - Add a `CockpitStyleOverview` to `CockpitOverview`.
  - Load global profiles from private root.
  - Load current book binding/profile from book project directory.
  - Pass style status into quality overview or derive an additional quality signal without duplicating file reads unnecessarily.
- [ ] Re-run focused tests until green.

---

## Task 5: Web UI Style Card

**Files:**

- Modify: `src/web/public/app.html`
- Modify: `tests/web-app-html.test.ts`

**TDD steps:**

- [ ] Add failing tests asserting the HTML contains:
  - `data-testid="style-profile"`
  - `renderStyle`
  - `文风档案`
  - `尚未绑定文风`
  - `已绑定`
- [ ] Run:

```bash
node --test tests/web-app-html.test.ts
```

- [ ] Implement:
  - Add a compact “文风档案” card near the Quality Loop, not nested inside another card.
  - Render:
    - Bound profile name/description.
    - Missing binding message.
    - Number of saved global profiles.
    - First anti-AI-voice observation if present.
  - Keep all visible labels in Simplified Chinese.
- [ ] Re-run focused tests until green.

---

## Task 6: Verification And Commit

- [ ] Run focused tests:

```bash
node --test tests/style.test.ts tests/style-command.test.ts tests/web-cockpit.test.ts tests/web-quality.test.ts tests/web-app-html.test.ts
```

- [ ] Run all tests:

```bash
node --test tests/*.test.ts
```

- [ ] Run build:

```bash
node scripts/build.mjs
```

- [ ] Browser smoke:
  - Start or reuse the Web server.
  - Open `http://localhost:<port>/`.
  - Confirm the cockpit renders and the “文风档案” card is visible with a no-binding state.
  - If practical, create/bind a profile via CLI and refresh to confirm the bound state.

- [ ] Commit:

```bash
git status --short
git add docs/superpowers/plans/2026-05-18-writing-style-engine-v1-2a.md src/commands/style.ts src/cli.ts src/web/cockpit.ts src/web/quality.ts src/web/public/app.html tests/style.test.ts tests/style-command.test.ts tests/web-cockpit.test.ts tests/web-quality.test.ts tests/web-app-html.test.ts
git commit -m "feat: add writing style profiles"
```

