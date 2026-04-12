## MODIFIED Requirements

### Requirement: Chat send over WebSocket

An authenticated client SHALL send `{ type: "chat:send", id: string, series: string, story: string, message: string }` to initiate a chat message. The `id` field SHALL be a client-generated unique identifier for request-response correlation. The server SHALL process the message identically to the existing `POST /chat` endpoint: read the template, build the prompt, call the LLM API with `stream: true`, and write chunks to disk. In addition, each LLM delta chunk SHALL be sent to the WebSocket client as `{ type: "chat:delta", id, content }` immediately after writing to disk. When generation completes, the server SHALL send `{ type: "chat:done", id }`. If an error occurs, the server SHALL send `{ type: "chat:error", id, detail }`. The server SHALL create an `AbortController` for each generation and store it in a connection-scoped map keyed by the client-provided `id`, passing the controller's signal to the LLM fetch request. When the generation ends (by completion, error, or abort), the controller SHALL be removed from the map.

#### Scenario: Successful streaming chat over WebSocket
- **WHEN** the client sends `{ type: "chat:send", id: "msg-1", series: "s1", story: "n1", message: "走向藥妝店" }`
- **THEN** the server SHALL stream LLM deltas as `{ type: "chat:delta", id: "msg-1", content: "..." }` messages, write each chunk to the chapter file, and send `{ type: "chat:done", id: "msg-1" }` when complete

#### Scenario: Chat error returns error message
- **WHEN** the LLM API returns an error during WebSocket chat
- **THEN** the server SHALL send `{ type: "chat:error", id: "msg-1", detail: "LLM API error" }` and SHALL NOT close the WebSocket connection

#### Scenario: Request-response correlation
- **WHEN** the client sends a chat message with `id: "msg-1"`
- **THEN** all `chat:delta`, `chat:done`, `chat:error`, and `chat:aborted` messages related to this request SHALL include `id: "msg-1"`

## ADDED Requirements

### Requirement: Chat abort over WebSocket

An authenticated client SHALL send `{ type: "chat:abort", id: string }` to abort an active LLM generation. The `id` field SHALL match the `id` of a previously sent `chat:send` or `chat:resend` message. The server SHALL look up the `AbortController` associated with the given `id` in the connection-scoped map and call `abort()` on it, which SHALL cause the upstream LLM fetch to throw an `AbortError`. The SSE stream loop in `executeChat()` SHALL catch the `AbortError`, close the chapter file cleanly with whatever content was written up to that point, and return early without executing post-response hooks. The server SHALL then send `{ type: "chat:aborted", id }` to the client and remove the controller from the map. If no active generation exists for the given `id` (e.g., it already completed), the server SHALL silently ignore the abort request.

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
- **THEN** the server SHALL NOT execute post-response hooks (e.g., state-patches plugin) for the aborted generation
