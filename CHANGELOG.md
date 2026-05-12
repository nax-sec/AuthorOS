# Changelog

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
