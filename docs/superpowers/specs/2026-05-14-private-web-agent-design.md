# AuthorOS Private Web Agent Design

Date: 2026-05-14
Status: approved for MVP implementation

## Goal

Build a local temporary web experience so one friend can use AuthorOS without QQ, OpenClaw routing, or a shared LAN. The page should feel like talking to a private AI author, not like operating a CLI.

The web layer is an adapter around existing AuthorOS behavior. It must not replace the AuthorOS CLI, rewrite the book data model, or change the core writing loop.

## Non-Goals

- No multi-user account system in the first version.
- No permanent public hosting.
- No OpenClaw dependency.
- No payment, billing, login provider, or database server.
- No automatic publishing to reading platforms.
- No destructive delete-book workflow.

## Recommended Deployment Shape

Run everything on the user's local Windows machine:

```text
Friend browser
  -> temporary Cloudflare Tunnel HTTPS URL
  -> local AuthorOS Web server on 127.0.0.1:8787
  -> Author Agent Controller
  -> AuthorOS CLI/core
  -> D:\Books\private-author
```

Access is protected by a simple token configured through `AUTHOROS_WEB_TOKEN`. The token is not a replacement for real auth, but it prevents accidental access from a leaked temporary URL during MVP testing.

## User Experience

The app has one primary screen:

- Left: chat with the private AI author.
- Center: current chapter reader.
- Right: bookshelf, current book status, pending confirmation, and download buttons.
- Bottom or side panel: live progress log for long-running jobs.

The friend should be able to type natural requests:

- "我想看一本赛博香港侦探小说"
- "继续写"
- "读最新章"
- "这一章主角太冷了，改得更有人味一点"
- "确认应用修改"
- "下载这一章"
- "切到另一本"

## Author Agent Controller

The web app includes a lightweight `Author Agent Controller`. It plays the role OpenClaw was playing, but with less routing overhead and better progress control.

Responsibilities:

- Interpret user intent.
- Ask new-book intake questions before creating a book.
- Confirm before creating a book or applying a revision.
- Route safe actions to AuthorOS private commands.
- Emit progress events before and during long tasks.
- Translate CLI/core results into reader-facing replies.
- Keep one active bookshelf root, defaulting to `D:\Books\private-author`.

Intent categories:

- `new_book_intake`: user wants a new story but has not confirmed enough identity details.
- `new_book_confirmed`: create a book after confirmation.
- `continue_book`: plan and write next chapter.
- `read_chapter`: show latest or selected chapter.
- `feedback_preview`: generate revision preview, do not overwrite.
- `feedback_apply`: apply existing pending feedback.
- `book_list`: show books.
- `book_switch`: switch current book.
- `download_current_chapter`: download selected chapter as `.md`.
- `download_all_chapters`: download all chapters as `.zip`.
- `status`: show current book status and pending feedback.
- `unknown`: ask a short clarification.

## New Book Intake Rules

The controller must not create a book immediately from a vague first idea unless the user explicitly says "直接开始", "不用问", or "你决定,直接建".

Default intake questions:

1. Title or temporary title.
2. Protagonist identity.
3. Core conflict or hook.
4. Desired tone and pacing.
5. Hard dislikes or forbidden elements.

The user may answer "你决定" for any item.

After intake, the controller summarizes the proposed book in 3-5 bullets and asks for confirmation. Only explicit confirmation creates the book.

## Progress Events

Every long action must produce visible progress:

- `received`: request accepted.
- `intake`: asking or summarizing setup questions.
- `planning`: chapter plan is being generated.
- `writing`: chapter prose is being generated.
- `revision_preview`: feedback preview is being generated.
- `applying`: pending revision is being applied.
- `completed`: action finished.
- `failed`: action failed with a concise reason and suggested next step.

The UI should keep the latest progress visible even if the model call takes several minutes.

## Server API

Initial API surface:

- `GET /api/session`
  - Returns whether token auth is satisfied and the current server config summary.
- `POST /api/auth`
  - Body: `{ "token": "..." }`
  - Stores token client-side for the current browser session.
- `GET /api/books`
  - Returns bookshelf entries and current book id.
- `POST /api/books`
  - Starts new-book intake or creates a confirmed book depending on agent state.
- `POST /api/books/current`
  - Switches current book.
- `GET /api/status`
  - Returns current book, latest chapter, pending feedback state, and last job state.
- `POST /api/chat`
  - Main natural-language entrypoint. Returns the immediate agent reply and job id when async work starts.
- `GET /api/jobs/:id/events`
  - Server-sent events stream for progress and final result.
- `GET /api/chapters`
  - Lists chapters for the current book.
- `GET /api/chapters/:chapter`
  - Returns chapter content.
- `GET /download/chapter/:chapter`
  - Downloads one chapter as Markdown.
- `GET /download/chapters.zip`
  - Downloads all chapter Markdown files as a zip.

## Data And State

Use the existing AuthorOS private root:

```text
D:\Books\private-author
  bookshelf.json
  books\<book-id>\
```

The web layer may store its own small runtime state under:

```text
D:\Books\private-author\.authoros-web\
  sessions.json
  jobs\
```

This state should contain only UI/session/job metadata. Canonical book data remains in each AuthorOS book directory.

## Implementation Shape

Add a new web module without disturbing the CLI:

```text
src/web/server.ts
src/web/agent.ts
src/web/jobs.ts
src/web/downloads.ts
src/web/auth.ts
src/web/public/
```

Add CLI entrypoint:

```powershell
author web --root D:\Books\private-author --port 8787
```

Environment:

```powershell
$env:AUTHOROS_PRIVATE_ROOT="D:\Books\private-author"
$env:AUTHOROS_WEB_TOKEN="<temporary access code>"
$env:OPENAI_API_KEY=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')
$env:OPENAI_BASE_URL=[Environment]::GetEnvironmentVariable('OPENAI_BASE_URL','User')
$env:AUTHOROS_MODEL=[Environment]::GetEnvironmentVariable('AUTHOROS_MODEL','User')
```

The MVP should use Node built-in HTTP APIs and existing dependencies where practical. Avoid React/Vite in the first version unless plain HTML becomes a blocker.

## Error Handling

User-facing errors should be short and actionable:

- Missing token: ask for access code.
- Missing model env: tell the host to configure `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `AUTHOROS_MODEL`.
- Model timeout or length failure: preserve job failure state and suggest retry or reduce target.
- No current book: ask to create a book first.
- No chapters: show empty reader state and suggest continuing the book.
- Pending feedback mismatch: ask the host to inspect current book status.

Do not expose API keys, stack traces, or full environment values in the browser.

## Downloads

MVP download support:

- Current chapter as `.md`.
- Any selected chapter as `.md`.
- All drafted chapters as `.zip`.

The zip should include only chapter Markdown files in order:

```text
chapters/
  0001.md
  0002.md
```

Later versions can add a full book bundle with `product.md`, `outline.md`, `world.md`, `characters.yaml`, and memory files.

## Testing

Unit tests:

- Intent routing for common Chinese phrases.
- New-book intake does not create a book before confirmation.
- Feedback preview does not overwrite chapters.
- Apply requires pending feedback.
- Download chapter returns Markdown with safe filename.
- Zip contains only chapter files.
- Token check blocks API access when configured.

Manual smoke test:

1. Start `author web --root D:\Books\private-author --port 8787`.
2. Open `http://127.0.0.1:8787`.
3. Enter access token.
4. Create a new book through intake and confirmation.
5. Continue one chapter and watch progress events.
6. Read latest chapter.
7. Submit feedback and verify preview appears.
8. Apply feedback.
9. Download current chapter.
10. Download all chapters zip.

Tunnel smoke test:

1. Start Cloudflare Tunnel to local port 8787.
2. Open the temporary HTTPS URL from a different network.
3. Verify token gate, chat, progress, reading, and download.

## Acceptance Criteria

- A friend can use the app through a temporary public HTTPS link without installing QQ, OpenClaw, Tailscale, or AuthorOS.
- The app does not create a new book before intake and confirmation.
- Long-running model tasks show progress before completion.
- Chapter feedback preview never overwrites content until explicit confirmation.
- The user can download the current chapter and all chapters.
- Existing AuthorOS CLI tests remain green.

