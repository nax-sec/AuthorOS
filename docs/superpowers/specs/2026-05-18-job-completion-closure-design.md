# Job Completion Closure v1.3b Design

## Goal

Make finished Web jobs feel closed and actionable. When a long-running task completes, the user should immediately know what finished, where the newest chapter is, and what the natural next step is.

## Boundary

This is a Web cockpit behavior slice. It does not add notifications, native macOS alerts, or a background daemon. It also does not change how writing commands are routed.

## Behavior

Each completed command job stores a `completion` object in its result:

- `title`: concise finished-state line.
- `detail`: concrete artifact or safety boundary.
- `next`: recommended next action in plain Chinese.

Examples:

- `new_book_and_continue`: book created and chapter 1 written.
- `continue`: chapter N written.
- `feedback`: preview generated,正文 not overwritten.
- `style_rewrite`: style preview generated,正文 not overwritten.

The browser receives the completed SSE event and posts one assistant message:

```text
任务完成
<title>
<detail>
下一步建议：<next>
```

## Data Flow

`runCommandJob()` wraps every successful command result with the completion copy before calling `jobs.complete()`. The existing job store persists it and includes it in the completed SSE event.

The frontend `watchJob()` reads `event.data.completion`, calls `announceJobCompletion()`, refreshes cockpit state, and then loads the latest chapter as it already does.

## Testing

- Add pure unit tests for completion copy generation.
- Add HTML shell assertions for `announceJobCompletion` and the user-facing strings.
- Keep existing Web server/job persistence behavior unchanged.

## Acceptance Criteria

- Completed jobs persist a `completion` object.
- The frontend has an explicit completion announcement path.
- Preview jobs clearly say the正文 was not overwritten.
- Chapter-writing jobs recommend read / feedback / continue.
