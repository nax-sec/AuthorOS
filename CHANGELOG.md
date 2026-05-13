# Changelog

## 0.3.6 — Strategy Token Budget Hotfix

- Raised setup Strategy Pass generation budget from 1200 to 4000 tokens for richer concepts.

## 0.3.5 — Memory Delta Workflow Hotfixes

- Made `rename-text` idempotent when the source text is already absent, so duplicate model rename ops do not fail a successful transaction.
- Added `author memory deltas` and `author memory deltas show <name>` for reviewing pending console/chapter delta proposals.
- Updated author-console memory-delta guidance so it points to manual curation instead of non-existent auto-merge commands.

## 0.3.4 — Console Prompt Examples

- Expanded the author-console `[edits]` prompt schema from one generic example to one minimal example per supported edit op.
- Clarified book-vs-author scope selection for common book files and delta files.
- Tightened console delta guidance so the model uses `memory/console-*.delta.md` and proposes canon/memory changes through deltas.
- Raised the author-console output budget to fit the longer structured prompt examples.
- Added explicit empty-chapter context text so the console agent does not infer drafted chapter prose when none exists.

## 0.3.3 — Console Edits Hardening

- Replaced fragile custom `[edits]` YAML parsing with the `yaml` runtime dependency.
- Added substring-aware `replace-text` matching and a `rename-text` op for file-wide literal renames.
- Added console op-selection guidance so append and rename requests prefer specific ops instead of fallback `replace-text`.
- Expanded console edits coverage for YAML block forms, substring replacement, and global renames.

## 0.3.2 — Console Structured Edits

- Replaced author-console unified diff output with structured `[edits]` YAML operations.
- Added scoped edit validation for book and author files, including safe console delta files and hard blocks for canonical runtime artifacts.
- Stored applied edit operations in `changes/<id>/edits.yaml` and change metadata for easier audit and rollback review.
- Updated console docs, help text, and tests around apply/edit/drill behavior.

## 0.3.1 — Hotfix Batch 1

- Neutralized initial memory files after Strategy Pass so non-urban concepts no longer inherit `urban_power_anomaly` canon, hooks, plot threads, or character-state content.
- Added per-section setup generation token budgets and one retry for likely truncated Markdown output, with larger budgets for `world.md` and `outline.md`.
- Made author-console diff application more tolerant of model-generated patches by ignoring trailing whitespace in context and using a hunk-local fuzzy replacement fallback.

## v0.3.0

AuthorOS v0.3.0 introduces the author layer(作者层) and turns the project from a single-book scaffold into a reusable author operating system.

- Added author-level initialization with reusable profiles, preferences, templates, and author-scoped history.
- Added Strategy Pass and banned vocabulary controls so concept/guided setup can choose templates by metadata without leaking unrelated genre vocabulary into the generated book.
- Expanded the seed template library to 12 genres and added validation for template metadata and schema-compatible quick initialization.
- Added Distill Pass for candidate template creation, plus template management commands for list/show/promote/forget/export.
- Added `author revise --instruction` so author-console directives can force targeted chapter revisions while preserving the normal review-based path.
- Added `author console` with the four-block `[scope] [impact] [diff] [next]` protocol, REPL apply/edit/abort/drill flow, `log`, and `--rollback`.
- Extracted `changes/` infrastructure for record/list/rollback with before/after snapshots and rollback audit records.
- Expanded the test matrix beyond 140 tests and documented the v0.3 workflows in README.
