# Web Resident Session Shell v1.3a Design

## Goal

Add a Web-level resident session shell to the Personal Cockpit. This is the first v1.3 slice: it gives the user a fixed, always-visible sense of "AuthorOS is alive, this is the current book, this is the current task, and this is how I resume the writing scene."

## Boundary

This is not a native macOS menu bar app, Electron wrapper, login system, or background daemon. It stays inside the existing single-page Web cockpit and uses the existing `/api/cockpit` response.

The resident shell does not replace Author Assistant. The assistant remains the creative command surface for writing commands. The resident shell only reports operational state and helps the user return to the active writing scene.

## Data

`CockpitOverview` gains a `session` object:

- `service`: always reports the local Web service as online for a successful cockpit response.
- `currentBook`: title/id for the current book, or a no-book label.
- `currentTask`: the newest running job, if any.
- `lastCompleted`: the newest completed job, if any.
- `resume`: a small UI hint for what the restore button should do.

The data is derived from existing book, model, and persisted job history. No new persistence file is needed in this slice.

## UI

The header gains a compact "常驻会话" strip with:

- Service status.
- Current book.
- Current task or last completed task.
- A "恢复现场" button.

The button reloads cockpit state and reads the latest chapter when a current book exists. This mirrors what a later native shell would do after opening the Web cockpit.

## Testing

- `tests/web-cockpit.test.ts` verifies the session object for empty, running, and completed states.
- `tests/web-app-html.test.ts` verifies the resident shell structure and render hooks.
- Existing `/api/cockpit` server tests cover serialization through the Web API.
- Full verification remains `node --test tests/*.test.ts`, `node scripts/build.mjs`, and `git diff --check`.

## Acceptance Criteria

- `/api/cockpit` includes `session`.
- The top of the page shows service/book/task state without opening the assistant.
- Running jobs are shown before completed jobs.
- When no job is running, the latest completed job is shown.
- "恢复现场" refreshes cockpit state and attempts to load the latest chapter.
