## ADDED Requirements

### Requirement: Chat continue over WebSocket

An authenticated client SHALL send `{ type: "chat:continue", id: string, series: string, story: string }` to resume LLM generation on the latest chapter of a story without creating a new chapter file. The `id` field SHALL be a client-generated unique identifier used for request/response correlation, identical in role to the `id` carried by `chat:send` and `chat:resend`. There SHALL NOT be a `message` field in `chat:continue`; the trigger for generation is the trailing assistant prefill that the server constructs from the latest chapter's content.

The server SHALL handle `chat:continue` by invoking `executeContinue()` from `writer/lib/chat-shared.ts` (see the `continue-last-chapter` capability for the full contract) with the same per-id `AbortController` registration mechanism already used for `chat:send`: a fresh controller SHALL be created, stored in the connection-scoped `abortControllers` map keyed by `id`, and removed on completion / abort / error in `finally`. The controller's `signal` SHALL be passed to `executeContinue()`.

For each streamed content delta the server SHALL emit `{ type: "chat:delta", id, content }` to the client, identical in shape to the deltas emitted for `chat:send`. The `content` field SHALL be the post-`response-stream`-hook delta bytes (i.e. the same bytes appended to the chapter file on disk).

On successful completion the server SHALL emit `{ type: "chat:done", id, usage: TokenUsageRecord | null }`. The `usage` field SHALL carry the same record appended to `_usage.json`, or `null` when the upstream LLM omits its `usage` block.

On abort (client sends `{ type: "chat:abort", id }` or the WebSocket connection closes), the server SHALL emit `{ type: "chat:aborted", id }` (when the connection is still open) and the chapter file SHALL retain the bytes appended before the abort. The same connection-scoped cleanup that aborts in-flight `chat:send` generations on connection close SHALL also abort in-flight `chat:continue` generations — there is no separate cleanup path.

On error (`ChatError` thrown by `executeContinue()`), the server SHALL emit `{ type: "chat:error", id, detail }` where `detail` is the `ChatError.message`. Specifically, refusals carry these details:

- `chat:error` with detail `"Cannot continue: no existing chapter file"` when the story has zero chapter files.
- `chat:error` with detail `"Latest chapter is empty; nothing to continue"` when the latest chapter is whitespace-only.
- `chat:error` with detail `"Another generation is already in progress for this story"` when the per-story lock is held.
- `chat:error` with detail `"Invalid series or story name"` when path-traversal is detected (existing `isValidParam` precheck).
- `chat:error` with the upstream provider message when a mid-stream provider error is detected (`ChatError("llm-stream", …)`).

The idle-timer reset behaviour applied after `chat:send` completion SHALL also be applied after `chat:continue` completion / abort / error, so the WebSocket connection does not idle-timeout sooner because a long continue happens to be the last activity.

#### Scenario: Successful continue streaming over WebSocket

- **GIVEN** an authenticated WebSocket and a story whose latest chapter is non-empty
- **WHEN** the client sends `{ type: "chat:continue", id: "msg-7", series: "s1", story: "n1" }`
- **THEN** the server SHALL stream `{ type: "chat:delta", id: "msg-7", content: "..." }` for each delta, append the corresponding bytes to the latest chapter file, and emit `{ type: "chat:done", id: "msg-7", usage: <TokenUsageRecord | null> }` on completion

#### Scenario: Continue refused for empty story

- **GIVEN** a story with zero chapter files
- **WHEN** the client sends `chat:continue`
- **THEN** the server SHALL emit `{ type: "chat:error", id, detail: "Cannot continue: no existing chapter file" }`, SHALL NOT send `chat:done` or `chat:aborted`, AND SHALL NOT modify any file on disk

#### Scenario: Continue refused for empty latest chapter

- **GIVEN** a story whose latest chapter file is whitespace-only
- **WHEN** the client sends `chat:continue`
- **THEN** the server SHALL emit `{ type: "chat:error", id, detail: "Latest chapter is empty; nothing to continue" }`, AND SHALL NOT open the chapter file for writing

#### Scenario: Abort during continue

- **GIVEN** an in-flight `chat:continue` request that has streamed two `chat:delta` messages
- **WHEN** the client sends `{ type: "chat:abort", id }` for that same id
- **THEN** the server SHALL look up the per-id `AbortController` in the connection-scoped map, call `abort()` (with no reason argument), the upstream LLM fetch SHALL be torn down, the chapter file SHALL retain exactly the original pre-continue bytes plus the two streamed deltas, the server SHALL emit `{ type: "chat:aborted", id }`, AND SHALL NOT emit `chat:done` for that id

#### Scenario: Connection close aborts in-flight continue

- **GIVEN** an in-flight `chat:continue` request whose controller is registered in the connection-scoped map
- **WHEN** the WebSocket connection closes (clean close, error close, or idle timeout)
- **THEN** the connection-scoped cleanup SHALL call `abort()` on the controller, the chapter file SHALL retain whatever bytes were appended before the abort, AND the upstream LLM fetch SHALL be torn down (saving tokens)

#### Scenario: Mid-stream error during continue

- **GIVEN** an in-flight `chat:continue` whose upstream sends an SSE `error` chunk after two normal deltas
- **WHEN** the SSE parser detects the error chunk
- **THEN** the server SHALL emit `{ type: "chat:error", id, detail: "<provider message>" }`, the chapter file SHALL retain the original pre-continue bytes plus the two deltas written before the error, AND SHALL NOT emit `chat:done` or `chat:aborted` for that id

#### Scenario: Concurrent continue rejected

- **GIVEN** a `chat:send` is currently in flight for `(series, story)` with the per-story generation lock held
- **WHEN** another client (or the same client in a second tab) sends `chat:continue` for the same `(series, story)`
- **THEN** the server SHALL emit `{ type: "chat:error", id: <continue id>, detail: "Another generation is already in progress for this story" }` AND SHALL NOT modify any file on disk

#### Scenario: Idle timer reset after continue

- **GIVEN** an authenticated WebSocket with the standard idle timeout
- **WHEN** a `chat:continue` round completes (via `chat:done`, `chat:aborted`, or `chat:error`)
- **THEN** the idle timer SHALL be reset (identical to the reset performed after `chat:send` completion)

### Requirement: Continue uses the same correlation envelope as send

All response messages emitted by the server in response to `chat:continue` (`chat:delta`, `chat:done`, `chat:error`, `chat:aborted`) SHALL carry the same `id` field that the client supplied in the `chat:continue` envelope. This is the same correlation contract already documented for `chat:send` and `chat:resend`. Clients SHALL be able to multiplex a `chat:continue` and a separate `chat:send` (for a different story) over the same WebSocket connection by distinguishing on `id`.

#### Scenario: Correlation across continue and send

- **GIVEN** a single WebSocket connection
- **WHEN** the client sends `chat:continue` with `id: "c-1"` for story A and concurrently `chat:send` with `id: "s-1"` for story B (different stories, no per-story lock conflict)
- **THEN** every `chat:delta` / `chat:done` / `chat:error` / `chat:aborted` message SHALL carry exactly one of `id: "c-1"` or `id: "s-1"`, and the client SHALL be able to route them to the originating request without ambiguity
