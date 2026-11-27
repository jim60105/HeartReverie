# Spec Delta

## MODIFIED Requirements

### Requirement: Abort signal propagated to upstream LLM fetch

The chat execution function (`executeChat()` in `writer/lib/chat-shared.ts`) SHALL accept an optional `signal: AbortSignal` parameter and SHALL pass it directly to the upstream `fetch()` call to the LLM API URL. When the signal is aborted, the underlying TCP/HTTP connection to the LLM provider SHALL be torn down so that — for OpenRouter providers documented as supporting cancellation — the provider stops processing and stops billing for the request. The HTTP route handler SHALL provide `c.req.raw.signal` (the request signal that Hono/Deno aborts when the client disconnects). The WebSocket route handler SHALL create a per-request `AbortController` keyed by the request `id`, register it in a connection-scoped `Map`, and provide its `signal` to `executeChat()`.

#### Scenario: Signal forwarded to upstream fetch

- **WHEN** `executeChat()` is invoked with an `AbortSignal` that is later aborted
- **THEN** every upstream transport attempt's `fetch()` SHALL receive the same signal in its `init` parameter, causing the connection to abort when the signal fires

#### Scenario: HTTP client disconnect aborts upstream

- **WHEN** an HTTP client disconnects while `POST /api/stories/:series/:name/chat` is streaming the LLM response
- **THEN** the request signal (`c.req.raw.signal`) SHALL be aborted by the runtime, the upstream LLM connection SHALL be torn down, and `executeChat()` SHALL throw `ChatAbortError`

#### Scenario: WebSocket disconnect aborts all in-flight generations

- **WHEN** a WebSocket connection closes (clean close, error, or idle timeout) while one or more LLM generations are still streaming
- **THEN** the connection-scoped cleanup SHALL call `abort()` on every `AbortController` in its map, the upstream LLM connections SHALL be torn down, and the chapter files SHALL retain whatever content was streamed before the abort
