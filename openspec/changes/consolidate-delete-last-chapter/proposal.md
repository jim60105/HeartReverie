## Why

"Delete the last chapter" is implemented three times in the core repo and the copies have drifted. The HTTP `DELETE .../chapters/last` route has **no** active-generation guard (so a client can unlink the chapter file mid-stream and silently lose the streamed content) and never prunes the usage ledger (so token totals drift upward). The WebSocket resend path re-implements the delete inline, prunes usage but also lacks the guard, and swallows deletion errors without logging — violating the workspace "never swallow errors" rule.

## What Changes

- Add a single shared `deleteLastChapter(dirPath)` helper in the backend story-chapter I/O library that lists chapters, removes the highest-numbered chapter file, best-effort removes its state/diff sidecar artifacts, and prunes the corresponding usage record (`pruneUsage(dir, N - 1)`).
- Add an `isGenerationActive(series, name)` guard to the HTTP `DELETE /api/stories/:series/:name/chapters/last` route so deletion is rejected with HTTP 409 while an LLM generation is streaming into the story, and make that route prune usage via the shared helper.
- Rewrite the WebSocket `chat:resend` delete block to use the shared helper, add the same generation guard (emitting `chat:error`), and log deletion failures server-side instead of swallowing them.
- Remove the inline chapter-listing / delete / prune duplication from `ws-chat.ts` so both transports behave identically.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `chapter-editing`: Add a requirement covering the shared last-chapter deletion helper and the HTTP `DELETE .../chapters/last` route's active-generation guard plus usage pruning.
- `token-usage-tracking`: Add a requirement that deleting the last chapter prunes that chapter's usage record from `_usage.json`, keeping token totals accurate across both transports.
- `websocket-chat-streaming`: Modify the `chat:resend` requirement so the resend path uses the shared helper, rejects with `chat:error` while a generation is active, and logs deletion failures.

## Impact

- Backend: `writer/lib/story-chapter-io.ts` (new helper), `writer/routes/chapters.ts` (DELETE-last route), `writer/routes/ws-chat.ts` (`handleChatResend`).
- Tests: `tests/writer/routes/chapters_test.ts` (409-under-generation, usage pruning), the WebSocket route test file.
- Frontend behavior is unchanged: the HTTP resend fallback in `useChatApi.ts` inherits the new 409 guard and surfaces it as a generic resend failure.
- No on-disk format or API wire-shape change beyond the new 409 status path; no migration concerns (pre-release).
