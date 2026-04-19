## Why

Token usage data is already captured inside `writer/lib/chat-shared.ts::executeChat()` (the `tokenUsage` local around line 264) whenever the upstream LLM emits a `usage` field on its SSE stream, but that information is currently only written to the LLM interaction log and otherwise discarded — it is never persisted alongside the story, never returned to the client on the `chat:done` WebSocket frame or HTTP response, and never surfaced in the reader UI. Authors have no visibility into per-chapter or cumulative token consumption, which is useful for cost awareness, prompt tuning, and context-budget debugging. This change makes the already-captured usage data a first-class, persisted, observable property of every generated chapter.

## What Changes

- Persist token usage to a per-story `_usage.json` file at `playground/<series>/<story>/_usage.json` — a JSON array of per-chapter usage records appended after each successful generation.
- Extend `executeChat()` in `writer/lib/chat-shared.ts` so that, after a generation finishes successfully, the captured `tokenUsage` plus `model` and `timestamp` are appended to `_usage.json` and returned as part of `ChatResult`.
- Extend the `chat:done` WebSocket message (`WsChatDoneMessage` in `writer/types.ts`) with an optional `usage` payload and do the same for the HTTP chat response body in `writer/routes/chat.ts`.
- Add an authenticated REST endpoint `GET /api/stories/:series/:name/usage` returning the full `_usage.json` array plus a computed cumulative total.
- Add a small collapsible "Token usage" panel to the reader UI (driven by a new `useUsage.ts` composable and consumed by `ContentArea.vue` or a sibling component) showing the most recent chapter's prompt/completion/total tokens and a running per-story total. Update on every `chat:done` frame.
- Handle providers that omit `usage` gracefully: when `tokenUsage` is `{ prompt: null, completion: null, total: null }`, no record is appended, the `chat:done` message omits `usage`, and the frontend badge shows "—" for that chapter.
- Reserve the filename `_usage.json` as system-managed, alongside the existing underscore-prefixed convention (`_lore/`, `_prompts/`, `_config.json`). Story listing helpers in `writer/lib/story.ts` already skip underscore-prefixed entries, so no user-visible leakage.

No backward compatibility is required (0 users).

## Capabilities

### New Capabilities
- `token-usage-tracking`: File format, append semantics, REST API, WebSocket/HTTP propagation, and reader UI for per-chapter and cumulative token usage.

### Modified Capabilities
- `writer-backend`: `executeChat()` SHALL append a usage record to `_usage.json` and return the captured usage in `ChatResult`.
- `websocket-chat-streaming`: The `chat:done` server message SHALL include an optional `usage` field; the HTTP chat response SHALL include the same shape for parity.

## Impact

- **Code (backend)**: `writer/lib/chat-shared.ts` (wire up persist + return), new `writer/lib/usage.ts` (read/append `_usage.json`, typed record shape, totals computation), new `writer/routes/usage.ts` (`GET /api/stories/:series/:name/usage`), `writer/app.ts` (mount new route), `writer/types.ts` (add `TokenUsageRecord`, `ChatUsage`, extend `ChatResult`, `WsChatDoneMessage`).
- **Code (frontend)**: new `reader-src/src/composables/useUsage.ts` (fetch + in-memory update from WebSocket events), new `reader-src/src/components/UsagePanel.vue` (collapsible stats badge), integrate into the reading view, extend `reader-src/src/types/index.ts` with `TokenUsageRecord` and updated `ChatDoneMessage`.
- **APIs**: Adds `GET /api/stories/:series/:name/usage` (authenticated via `X-Passphrase`, covered by the existing rate limiter). Adds optional `usage` property to the existing HTTP chat response and `chat:done` WebSocket frame — additive, not breaking.
- **Storage**: New `_usage.json` inside each story directory. Written by the backend only; the file is append-only during normal operation. Reserved filename — story listings continue to skip underscore-prefixed entries.
- **Tests**: Backend tests for append semantics, atomicity, missing-usage handling, malformed existing file recovery, and route auth/path safety. Frontend tests for `useUsage` and `UsagePanel` rendering, including the "—" fallback.
- **Docs**: Update `AGENTS.md` "Project Structure" and "Security Patterns" sections to mention `_usage.json` and the new route; cross-reference in the WebSocket message-type table.
