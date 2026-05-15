---
name: authoros
description: Use when the user wants to write, continue, revise, manage, or privately experience a novel with AuthorOS, the local-first CLI AI-author system. Trigger on "AuthorOS", "author private", "AI 作者", "私人 AI 作者", "写一本书", "继续写", "读最新章", "读者反馈", "改这一章", or requests to operate the local author CLI. Skip when the user is only asking for generic writing advice without using AuthorOS.
version: 0.3.6
metadata: { "openclaw": { "emoji": "📚", "requires": { "bins": ["node"] }, "primaryEnv": "OPENAI_API_KEY", "homepage": "file:///D:/AI/AuthorOS-v2", "install": [] } }
---

# AuthorOS Usage Skill

AuthorOS is a local-first Node.js CLI for treating a long-form novel as an AI author's product. It has two common entrypoints:

- `author ...`: full AuthorOS control for one book.
- `author private ...`: private AI author bookshelf mode for one reader and many books.

Prefer CLI actions over direct file edits unless the user explicitly asks to edit files.

## Environment

Model-backed commands need these environment variables in the current shell:

```powershell
$env:OPENAI_API_KEY="<key>"
$env:OPENAI_BASE_URL="<OpenAI-compatible base URL>"
$env:AUTHOROS_MODEL="<model>"
```

If they are missing in the current process but configured at user level on Windows, load them without printing values:

```powershell
$env:OPENAI_API_KEY=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')
$env:OPENAI_BASE_URL=[Environment]::GetEnvironmentVariable('OPENAI_BASE_URL','User')
$env:AUTHOROS_MODEL=[Environment]::GetEnvironmentVariable('AUTHOROS_MODEL','User')
```

The API key value is never persisted by AuthorOS. Per-book model metadata can be set with `author model config set --base-url ... --model ... --api-key-env OPENAI_API_KEY`.

## Private AI Author Mode

Use this mode when a friend or reader wants a simple conversational experience: create a book, continue it, read the latest chapter, give feedback, and apply revisions.

Recommended root:

```powershell
$env:AUTHOROS_PRIVATE_ROOT="D:\Books\private-author"
```

Commands:

```powershell
author private new --title "<book title>" --concept "<reader-facing concept>" --root D:\Books\private-author
author private list --root D:\Books\private-author
author private switch --book <book-id> --root D:\Books\private-author
author private current --root D:\Books\private-author
author private status --root D:\Books\private-author
author private continue --root D:\Books\private-author
author private read --chapter latest --root D:\Books\private-author
author private feedback --chapter latest --text "<reader feedback>" --root D:\Books\private-author
author private apply --root D:\Books\private-author
```

Behavior rules:

- `new` creates a normal AuthorOS book under `<root>/books/<book-id>/` and selects it.
- `continue` runs plan + write for the current book.
- `read` prints the current book's latest chapter.
- `feedback` is preview only. It creates `.authoros/private/pending-feedback.json` and does not overwrite the chapter.
- `apply` applies the pending feedback through `revise --instruction`, writes `chapters/NNNN.md`, and keeps the first original draft at `chapters/NNNN.draft.md`.
- Do not delete books. Switch away from a book to preserve it.
- For non-ASCII titles, book ids become stable `book-<short-hash>` ids.

## OpenClaw Front Desk Pattern

When acting as an OpenClaw or chat front desk for AuthorOS, keep the user-facing interaction simple:

Responsiveness contract:

- For long-running actions (`new`, `continue`, `feedback`, `apply`), first send a short acknowledgement to the chat before running CLI commands.
- The acknowledgement must say what was received and what will happen next, for example: "收到，我开始写下一章。会先做章节计划，再生成正文。"
- Do not stay silent while deciding which command to run. If the command needs model generation, assume it may take 1-3 minutes and tell the user that up front.
- If the chat platform supports intermediate messages, send one checkpoint after each major step: setup / plan / write / revision preview / applied.
- After the CLI returns, summarize the result in reader-facing language and include the next useful action.

New-book intake contract:

- Do not run `author private new` immediately from a first vague idea unless the user explicitly says "直接开始", "不用问", or "你决定,直接建".
- For a new story request, first act like an editor and ask one compact intake message with 3-5 useful questions. Ask only what affects the book identity.
- Good default questions: title or temporary title, protagonist identity, core hook/conflict, desired tone and pacing, hard dislikes or forbidden elements.
- Tell the user they can answer "你决定" for any question.
- After the user answers, summarize the proposed book in 3-5 bullets and ask for confirmation before creating the book.
- Only run `author private new` after explicit confirmation such as "确认", "可以", "就这样", or "开始建".
- If the user already provided a complete brief and also asked to start immediately, skip the intake and create the book.

1. If the user wants a new story, follow the new-book intake contract before running `author private new`.
2. If the user says "continue", "下一章", or "继续写", run `author private continue`.
3. If the user asks to read, run `author private read --chapter latest`.
4. If the user gives criticism, run `author private feedback --chapter latest --text "<feedback>"`, summarize the preview, and ask before applying.
5. If the user approves the preview, run `author private apply`.
6. If the user wants another story, run `author private list`, then `author private switch --book <id>`.

Never auto-apply feedback without approval. Never edit AuthorOS project files directly from the front desk unless the user explicitly asks for file surgery.

## Full Single-Book Loop

For hands-on AuthorOS operation inside one book directory:

```powershell
cd <book-dir>
author model doctor
author model smoke
author plan --chapter 1 --model --write
author write --chapter 1 --model --write
author review --chapter 1 --mode all --model --write
author revise --chapter 1 --model --write
author decide --chapter 1 --model --write
author memory update --chapter 1 --model --write
author state
```

For chapter N+1, use the target chapter number or `--next` on `plan` and `write`.

## Starting A Single Book

`author init` requires exactly one mode:

```powershell
author init "<book name>" --concept "<concept>"
author init "<book name>" --guided
author init "<book name>" --quick
author init "<book name>" --quick --dir D:\path\to\book
```

Important setup flags:

- `--template <key>`: reference template, default `urban_power_anomaly`.
- `--author-dir <path>`: author-level profile/templates directory.
- `--no-distill`: skip candidate-template extraction.
- `--strategy-confirm`: print the setup strategy before generation.

## Feedback And Decision Rules

- Real reader feedback lives in `feedback/NNNN.raw.jsonl` and `feedback/NNNN.analysis.md`.
- `decide` counts real feedback at 20% only when present.
- If real feedback is absent, do not invent it and do not redistribute its 20% weight.
- Default weights: author long-term plan 40%, internal review 30%, simulated readers 10%, real reader feedback 20%.

## Key Files

- `product.md`: book positioning.
- `author.md`: book-local author persona.
- `outline.md`, `world.md`, `characters.yaml`, `review_rules.md`: book identity.
- `chapters/NNNN.md`: canonical chapter after revision.
- `chapters/NNNN.draft.md`: original first draft backup when revise writes.
- `.authoros/config.yaml`: chapter length target and tolerance.
- `.authoros/agents/*.md`: editable agent profiles.
- `.authoros/readers.yaml`: simulated reader personas.
- `memory/*.yaml` and `memory/*.md`: long-term state.

## Troubleshooting

- `OPENAI_API_KEY is required`: load user-level env vars into the current shell or configure the book with `author model config`.
- `finish_reason: length`: the model output was capped; reduce target length or increase the command's max token budget in code.
- `OUT OF RANGE`: run `author revise --chapter N --model --write`; it will compress or expand within configured tolerance.
- Missing review before `revise` or `decide`: run `author review --chapter N --mode all --model --write`.
- PowerShell blocks `author.ps1`: use `author.cmd` or run `node D:\AI\AuthorOS-v2\src\cli.ts ...`.

When in doubt, run `author <command> --help`.
