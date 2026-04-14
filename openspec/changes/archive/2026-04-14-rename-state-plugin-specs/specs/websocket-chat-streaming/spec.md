# Delta Spec: websocket-chat-streaming

## MODIFIED Requirements

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
