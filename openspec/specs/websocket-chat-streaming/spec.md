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

An authenticated client SHALL send `{ type: "chat:abort", id: string }` to abort an active LLM generation. The `id` field SHALL match the `id` of a previously sent `chat:send` or `chat:resend` message. The server SHALL look up the `AbortController` associated with the given `id` in the connection-scoped map and call `abort()` on it, which SHALL cause the upstream LLM fetch to throw an `AbortError`. The SSE stream loop in `executeChat()` SHALL catch the `AbortError`, close the chapter file cleanly with whatever content was written up to that point, and throw a `ChatAbortError` so the caller can send `{ type: "chat:aborted", id }` to the client and remove the controller from the map. Post-response hooks SHALL NOT be executed for aborted generations. If no active generation exists for the given `id` (e.g., it already completed), the server SHALL silently ignore the abort request.

#### Scenario: Abort active generation
- **WHEN** the client sends `{ type: "chat:abort", id: "msg-1" }` while the server is streaming LLM output for `id: "msg-1"`
- **THEN** the server SHALL abort the upstream LLM fetch, stop streaming `chat:delta` messages, close the chapter file with partial content, send `{ type: "chat:aborted", id: "msg-1" }`, and SHALL NOT send `chat:done`

#### Scenario: Partial content preserved on abort
- **WHEN** the server has written 3 chunks to the chapter file and the client sends `chat:abort`
- **THEN** the chapter file SHALL retain the 3 chunks of content already written and SHALL NOT be deleted or truncated

#### Scenario: Abort after generation completes
- **WHEN** the client sends `{ type: "chat:abort", id: "msg-1" }` but the generation for `msg-1` has already completed
- **THEN** the server SHALL silently ignore the abort request (no error, no `chat:aborted` message)

#### Scenario: Abort stops token consumption
- **WHEN** the client sends `chat:abort` and the server aborts the upstream LLM API fetch
- **THEN** the TCP connection to the LLM API SHALL be torn down immediately, preventing further output token generation and billing

#### Scenario: Post-response hooks skipped on abort
- **WHEN** LLM generation is aborted via `chat:abort`
- **THEN** the server SHALL NOT execute post-response hooks (e.g., state plugin) for the aborted generation
