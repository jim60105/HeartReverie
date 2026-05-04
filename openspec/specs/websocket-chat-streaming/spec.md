# WebSocket Chat Streaming

## Purpose

Enables real-time bidirectional chat over WebSocket, with dual-write to disk and WebSocket for streaming LLM responses, while maintaining backward compatibility with the existing HTTP chat endpoint.
## Requirements
### Requirement: Chat send over WebSocket

An authenticated client SHALL send `{ type: "chat:send", id: string, series: string, story: string, message: string }` to initiate a chat message. The `id` field SHALL be a client-generated unique identifier for request-response correlation. The server SHALL process the message identically to the existing `POST /chat` endpoint: read the template, build the prompt, call the LLM API with `stream: true`, and write chunks to disk. In addition, each LLM delta chunk SHALL be sent to the WebSocket client as `{ type: "chat:delta", id, content }` immediately after writing to disk. When generation completes, the server SHALL send `{ type: "chat:done", id, usage: TokenUsageRecord | null }`, where `usage` is the token usage record appended to `_usage.json` for this generation (as defined in the `token-usage-tracking` capability), or `null` when the upstream LLM did not emit a `usage` object. If an error occurs, the server SHALL send `{ type: "chat:error", id, detail }`. The server SHALL create an `AbortController` for each generation and store it in a connection-scoped map keyed by the client-provided `id`, passing the controller's signal to the LLM fetch request. When the generation ends (by completion, error, or abort), the controller SHALL be removed from the map.

#### Scenario: `chat:done` includes usage when provider emits it
- **GIVEN** a successful generation where the upstream LLM emits `usage: { prompt_tokens, completion_tokens, total_tokens }`
- **WHEN** the server sends `chat:done`
- **THEN** the frame SHALL include a non-null `usage` field containing a `TokenUsageRecord` matching the record appended to `_usage.json`

#### Scenario: `chat:done` sets usage to null when provider omits it
- **GIVEN** a successful generation where the upstream LLM does not emit a `usage` object
- **WHEN** the server sends `chat:done`
- **THEN** the frame SHALL include `usage: null` and no record SHALL be appended to `_usage.json`

#### Scenario: Successful streaming chat over WebSocket
- **WHEN** the client sends `{ type: "chat:send", id: "msg-1", series: "s1", story: "n1", message: "走向藥妝店" }`
- **THEN** the server SHALL stream LLM deltas as `{ type: "chat:delta", id: "msg-1", content: "..." }` messages, write each chunk to the chapter file, and send `{ type: "chat:done", id: "msg-1" }` when complete

#### Scenario: Chat error returns error message
- **WHEN** the LLM API returns an error during WebSocket chat
- **THEN** the server SHALL send `{ type: "chat:error", id: "msg-1", detail: "LLM API error" }` and SHALL NOT close the WebSocket connection

#### Scenario: Request-response correlation
- **WHEN** the client sends a chat message with `id: "msg-1"`
- **THEN** all `chat:delta`, `chat:done`, `chat:error`, and `chat:aborted` messages related to this request SHALL include `id: "msg-1"`

### Requirement: Chat resend over WebSocket

An authenticated client SHALL send `{ type: "chat:resend", id: string, series: string, story: string, message: string }` to delete the last chapter and re-send a message. The server SHALL first delete the last chapter file (equivalent to `DELETE /api/stories/:series/:name/chapters/last`), then process the chat message identically to `chat:send`. The same delta streaming and correlation rules SHALL apply.

#### Scenario: Resend deletes last chapter then streams
- **WHEN** the client sends `{ type: "chat:resend", id: "msg-2", series: "s1", story: "n1", message: "改去便利商店" }`
- **THEN** the server SHALL delete the last chapter file of story `n1`, then stream the new LLM response as `chat:delta` messages with `id: "msg-2"`, and finalize with `chat:done`

#### Scenario: Resend when no chapters exist
- **WHEN** the client sends `chat:resend` for a story with zero chapters
- **THEN** the server SHALL send `{ type: "chat:error", id, detail: "No chapters to delete" }` and SHALL NOT proceed with the chat

### Requirement: Dual-write file and WebSocket

During LLM generation initiated via WebSocket, the server SHALL perform dual-write for each SSE chunk from the upstream LLM: (1) write the chunk content to the chapter file on disk using the existing incremental `file.write()` pattern, then (2) send the chunk as a `chat:delta` WebSocket message. Both operations SHALL occur sequentially within the same async iteration of the SSE stream reader. If the WebSocket connection is lost during generation, the server SHALL continue writing to disk and silently skip WebSocket sends.

#### Scenario: Each chunk written to file and WebSocket
- **WHEN** the LLM streams a chunk "今天天氣很好"
- **THEN** the server SHALL first append "今天天氣很好" to the chapter file, then send `{ type: "chat:delta", id, content: "今天天氣很好" }` over WebSocket

#### Scenario: WebSocket lost during generation
- **WHEN** the WebSocket connection drops while the server is streaming LLM output
- **THEN** the server SHALL continue writing chunks to the chapter file and SHALL NOT throw errors for failed WebSocket sends

#### Scenario: Post-response hooks still execute
- **WHEN** LLM generation completes via WebSocket chat
- **THEN** the server SHALL execute all post-response hooks (e.g., state plugin) identically to HTTP-initiated chat

### Requirement: HTTP chat endpoint backward compatibility

The existing `POST /chat` HTTP endpoint SHALL remain functional. Clients that do not use WebSocket SHALL continue to send chat messages via HTTP. The endpoint SHALL NOT be deprecated in this change. The JSON response body SHALL include the existing `chapter` and `content` fields and SHALL additionally include `usage: TokenUsageRecord | null`, matching the record appended to `_usage.json` for this generation (or `null` when the upstream LLM did not emit usage).

#### Scenario: HTTP chat still works
- **WHEN** a client sends `POST /chat` with appropriate headers and body
- **THEN** the server SHALL process the request identically to pre-WebSocket behavior, blocking until generation completes and returning the full response

#### Scenario: HTTP response includes usage when provider emits it
- **GIVEN** a successful HTTP chat request where the upstream LLM emits usage
- **WHEN** the server returns the JSON response
- **THEN** the body SHALL include `usage` set to the appended `TokenUsageRecord`

#### Scenario: HTTP response sets usage to null when provider omits it
- **GIVEN** a successful HTTP chat request where the upstream LLM omits usage
- **WHEN** the server returns the JSON response
- **THEN** the body SHALL include `usage: null` and no record SHALL be appended

### Requirement: Chat abort over WebSocket

An authenticated client SHALL send `{ type: "chat:abort", id: string }` to abort an active LLM generation. The `id` field SHALL match the `id` of a previously sent `chat:send` or `chat:resend` message. The server SHALL look up the `AbortController` associated with the given `id` in the connection-scoped map and call `abort()` on it (with no `reason` argument; the default `DOMException("AbortError")` SHALL propagate). The abort SHALL cause the upstream LLM `fetch()` to reject and SHALL cause any in-flight SSE stream read in `executeChat()` to terminate. `executeChat()` SHALL discriminate the abort by inspecting `signal.aborted === true` (NOT by inspecting the thrown error's class or `name`), close the chapter file cleanly with whatever content was written up to that point, and throw a freshly constructed `ChatAbortError("Generation aborted by client")` so the WebSocket message handler can send `{ type: "chat:aborted", id }` to the client and remove the controller from the map. Post-response hooks SHALL NOT be executed for aborted generations. If no active generation exists for the given `id` (e.g., it already completed), the server SHALL silently ignore the abort request.

When a WebSocket connection closes (clean close, error close, or idle timeout) while one or more LLM generations are still in flight, the connection-scoped cleanup SHALL iterate every `AbortController` in its map and call `abort()` on each (with no `reason`). Each in-flight `executeChat()` SHALL throw `ChatAbortError`, but those errors SHALL NOT be sent back to the client because the WebSocket is already closed; the chapter files SHALL nonetheless retain their partial content, and the abort SHALL still tear down the upstream LLM connections (saving tokens). See the `streaming-cancellation` capability for the complete cancellation contract.

#### Scenario: Abort active generation
- **WHEN** the client sends `{ type: "chat:abort", id: "msg-1" }` while the server is streaming LLM output for `id: "msg-1"`
- **THEN** the server SHALL abort the upstream LLM fetch, stop streaming `chat:delta` messages, close the chapter file with partial content, send `{ type: "chat:aborted", id: "msg-1" }`, and SHALL NOT send `chat:done`

#### Scenario: Abort during initial fetch resolution emits chat:aborted (not chat:error)
- **GIVEN** the WebSocket route has dispatched `chat:send` to `executeChat()` and the per-request controller is registered
- **WHEN** the client sends `{ type: "chat:abort", id }` before the upstream `fetch()` has resolved its initial response (i.e. before any SSE chunk has been parsed)
- **THEN** the server SHALL emit `{ type: "chat:aborted", id }` to the client, NOT `{ type: "chat:error", id, detail: "AI service request failed" }`

#### Scenario: Partial content preserved on abort
- **WHEN** the server has written 3 chunks to the chapter file and the client sends `chat:abort`
- **THEN** the chapter file SHALL retain the 3 chunks of content already written and SHALL NOT be deleted or truncated

#### Scenario: Abort after generation completes
- **WHEN** the client sends `{ type: "chat:abort", id: "msg-1" }` but the generation for `msg-1` has already completed
- **THEN** the server SHALL silently ignore the abort request (no error, no `chat:aborted` message)

#### Scenario: Abort with unknown id is silently ignored
- **WHEN** the client sends `{ type: "chat:abort", id: "never-issued-id" }` for an id that was never registered
- **THEN** the server SHALL NOT send any response message and SHALL NOT log an error

#### Scenario: Abort stops token consumption
- **WHEN** the client sends `chat:abort` and the server aborts the upstream LLM API fetch
- **THEN** the TCP connection to the LLM API SHALL be torn down immediately, preventing further output token generation and billing

#### Scenario: Post-response hooks skipped on abort
- **WHEN** LLM generation is aborted via `chat:abort`
- **THEN** the server SHALL NOT execute post-response hooks (e.g., state plugin) for the aborted generation

#### Scenario: Connection close aborts all in-flight generations
- **GIVEN** a WebSocket connection has two in-flight generations registered (`id: "a"` and `id: "b"`)
- **WHEN** the connection closes (client disconnect, idle timeout, or transport error)
- **THEN** the cleanup handler SHALL call `abort()` on both controllers, both upstream LLM `fetch()` connections SHALL be torn down, and both chapter files SHALL retain whatever content was written before the abort

#### Scenario: Abort succeeds regardless of abort reason argument
- **GIVEN** any future code path that calls `controller.abort(<reason>)` where `<reason>` is undefined, a `DOMException`, a `ChatAbortError`, or any custom `Error`
- **WHEN** an in-flight `executeChat()` is using that controller's signal
- **THEN** the abort SHALL be detected via `signal.aborted === true`, the dedicated abort cleanup branch SHALL run, and the public throw SHALL be a freshly constructed `ChatAbortError` regardless of the reason value

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

