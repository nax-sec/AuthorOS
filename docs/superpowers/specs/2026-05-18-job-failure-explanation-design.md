# Job Failure Explanation v1.3c Design

## Goal

Make failed Web jobs understandable without reading raw model or network errors. The user should see what likely went wrong and what to try next.

## Scope

This is a Web cockpit failure-display slice. It does not retry jobs automatically, change model configuration commands, or add native notifications.

## Behavior

When `runCommandJob()` catches an error, it classifies the raw message into a `failure` object:

- `kind`: `model_timeout`, `model_length`, `network`, `model_config`, or `unknown`.
- `title`: short readable cause.
- `detail`: technical detail preserved for debugging.
- `next`: concrete next step.

Examples:

- Timeout: "模型请求超时。"
- `finish_reason: length`: "模型输出被截断。"
- Network / connection refused: "网络或模型服务连接失败。"
- Missing API key / model / base URL: "模型配置不完整。"

The failed job keeps `error` as the readable title, and the failed event stores the full `failure` object in `event.data`.

## UI

The task center already shows the failed event message. The recovery panel and browser SSE failure path should use `failure.title`, `failure.detail`, and `failure.next` when available.

For a running user-triggered job, `watchJob()` posts one assistant message:

```text
任务失败
<title>
<detail>
下一步建议：<next>
```

## Compatibility

Old job history that only has `error` continues to render. `failure` is optional and uses existing JSON persistence.

## Acceptance Criteria

- Failed jobs store structured `failure` details.
- Common model/network/config failures have readable Chinese titles.
- The recovery panel uses structured details when available.
- The browser announces failed watched jobs with a next-step suggestion.
