## MODIFIED Requirements

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
