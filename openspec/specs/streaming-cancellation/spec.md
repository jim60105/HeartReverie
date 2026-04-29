# Streaming Cancellation

## Purpose

Defines the end-to-end contract for cancelling in-flight LLM chat generations (HTTP client disconnect, WebSocket `chat:abort`, WebSocket connection close) and for detecting mid-stream provider errors that arrive on the SSE response. Centralises the abort discriminator (`signal.aborted === true`, reason-agnostic) and the partial-content preservation guarantees so the HTTP and WebSocket routes can share `executeChat()` without duplicating cleanup logic.

## Requirements

### Requirement: Abort signal propagated to upstream LLM fetch

The chat execution function (`executeChat()` in `writer/lib/chat-shared.ts`) SHALL accept an optional `signal: AbortSignal` parameter and SHALL pass it directly to the upstream `fetch()` call to the LLM API URL. When the signal is aborted, the underlying TCP/HTTP connection to the LLM provider SHALL be torn down so that — for OpenRouter providers documented as supporting cancellation — the provider stops processing and stops billing for the request. The HTTP route handler SHALL provide `c.req.raw.signal` (the request signal that Hono/Deno aborts when the client disconnects). The WebSocket route handler SHALL create a per-request `AbortController` keyed by the request `id`, register it in a connection-scoped `Map`, and provide its `signal` to `executeChat()`.

#### Scenario: Signal forwarded to upstream fetch

- **WHEN** `executeChat()` is invoked with an `AbortSignal` that is later aborted
- **THEN** the upstream `fetch()` to `LLM_API_URL` SHALL receive the same signal in its `init` parameter, causing the connection to abort when the signal fires

#### Scenario: HTTP client disconnect aborts upstream

- **WHEN** an HTTP client disconnects while `POST /api/stories/:series/:name/chat` is streaming the LLM response
- **THEN** the request signal (`c.req.raw.signal`) SHALL be aborted by the runtime, the upstream LLM connection SHALL be torn down, and `executeChat()` SHALL throw `ChatAbortError`

#### Scenario: WebSocket disconnect aborts all in-flight generations

- **WHEN** a WebSocket connection closes (clean close, error, or idle timeout) while one or more LLM generations are still streaming
- **THEN** the connection-scoped cleanup SHALL call `abort()` on every `AbortController` in its map, the upstream LLM connections SHALL be torn down, and the chapter files SHALL retain whatever content was streamed before the abort

### Requirement: Abort detection is reason-agnostic and narrowly scoped

The chat execution function SHALL discriminate aborts by inspecting `signal?.aborted === true`, NOT by inspecting the thrown error's class or `name`. This SHALL apply regardless of whether `AbortController.abort()` was called with no argument (default `DOMException("AbortError")`), with a custom `Error` instance, with a `ChatAbortError` instance, or with any other reason value.

For the upstream `fetch()` call, the abort discriminator SHALL guard the entire `try { await fetch(...) }` body — that `try` only awaits `fetch`, so any thrown error with `signal.aborted === true` is unambiguously the client abort.

For the SSE streaming loop, the abort discriminator SHALL be narrowly scoped to the `await reader.read()` call only. File writes, JSON parsing, hook dispatch, and `onDelta` callbacks SHALL NOT be inside the `try` block whose `catch` consults `signal.aborted`; errors from those operations MUST propagate as themselves so they are not silently misclassified as aborts when a concurrent abort happens to be in flight.

When `signal.aborted === true` at either catch site, the function SHALL execute the dedicated abort cleanup branch. For aborts during initial `fetch()` resolution (before the chapter file is opened), the cleanup SHALL emit one LLM-interaction-log entry of the form `{ type: "error", errorCode: "aborted", latencyMs }` and throw `ChatAbortError("Generation aborted by client")` — no chapter-file close is needed because no file was opened. For aborts during streaming (after the chapter file is opened), the cleanup SHALL close the chapter file via the existing `finally` block, emit one LLM-interaction-log entry of the form `{ type: "response", aborted: true, latencyMs, ... }`, and throw `ChatAbortError("Generation aborted by client")`.

The WebSocket route handler SHALL call `controller.abort()` without a `reason` argument in both the per-request `chat:abort` handler and the on-disconnect cleanup, allowing the default `DOMException("AbortError")` to propagate. (This is a defensive simplification — the abort detection above is correct even if a reason is passed.)

#### Scenario: Abort with default DOMException reason

- **GIVEN** an in-flight `executeChat()` invocation whose `signal` is from a controller created by the WebSocket route
- **WHEN** the route handler calls `controller.abort()` with no arguments
- **THEN** `signal.aborted` SHALL be `true`, the abort cleanup branch in `executeChat()` SHALL run, and the function SHALL throw `ChatAbortError`

#### Scenario: Abort with custom Error reason

- **GIVEN** an in-flight `executeChat()` invocation
- **WHEN** the route handler calls `controller.abort(new ChatAbortError("Connection closed"))` (a custom reason rather than letting the default DOMException flow through)
- **THEN** `signal.aborted` SHALL still be `true`, the abort cleanup branch SHALL run, and the public throw SHALL still be a freshly constructed `ChatAbortError("Generation aborted by client")` — NOT a `ChatError` and NOT the original reason rethrown

#### Scenario: Abort during initial fetch resolution

- **GIVEN** an `AbortController` whose signal is aborted before the upstream `fetch()` has returned a response (i.e. before `executeChat()` reaches the chapter-file-creation step)
- **WHEN** `executeChat()` is invoked with that signal
- **THEN** the function SHALL throw `ChatAbortError` (NOT `ChatError("llm-api", "AI service request failed", 502)`); SHALL log the abort via `llmLog.info("LLM error", { type: "error", errorCode: "aborted", latencyMs })`; AND SHALL NOT create or open any chapter file (no chapter file is opened until after the upstream fetch validates).

#### Scenario: Abort during streaming after partial output

- **GIVEN** an in-flight `executeChat()` that has already opened a chapter file and written N content deltas to it
- **WHEN** the signal is aborted while `await reader.read()` is pending
- **THEN** the narrowed abort `catch` around `reader.read()` SHALL set `aborted = true` and break the loop, the `finally { file.close(); }` SHALL run, the dedicated abort cleanup branch SHALL emit one LLM-interaction-log entry with `type: "response"`, `aborted: true`, and `latencyMs` set to the elapsed time since `executeChat()` started, the function SHALL throw `ChatAbortError`, and the chapter file SHALL retain exactly the leading `<user_message>` block plus the N deltas already written

### Requirement: Mid-stream provider errors detected and surfaced

The SSE parser in `executeChat()` SHALL detect mid-stream errors per OpenRouter's documented format. The parser SHALL be structured so that the `try` block wrapping `JSON.parse(payload)` swallows **only** parse failures (`SyntaxError`); detection logic and the resulting `throw` SHALL run **outside** that catch so the thrown `ChatError` is not silently dropped.

After successful JSON parsing into a non-null object, the parser SHALL inspect both `parsed.error` (any non-null object value) and `parsed.choices?.[0]?.finish_reason === "error"`. If either signal is present, the parser SHALL:

1. Extract a human-readable message from `parsed.error.message` (string), falling back to `String(parsed.error.code)` when only `code` is present, falling back to the literal string `"Mid-stream provider error"` when both are absent.
2. Log exactly one entry to the LLM interaction log with `type: "error"`, `errorCode: "stream-error"`, `latencyMs` set to the elapsed time since `executeChat()` started, the extracted message, and the partial content length.
3. Close the chapter file via the existing `finally` block so that any content already written is preserved on disk.
4. Throw `ChatError("llm-stream", <extracted message>, 502)`.

The outer streaming-`try` `catch` block SHALL recognize `ChatError` instances and rethrow them WITHOUT logging a second `errorCode: "stream"` entry. The mid-stream error SHALL produce exactly one `errorCode: "stream-error"` log entry, never two.

The `ChatError.code` discriminated-union literal type SHALL be extended to include `"llm-stream"`. The HTTP route's error-title map (`ERROR_TITLES` in `writer/routes/chat.ts`) SHALL include an entry for `"llm-stream"` so the RFC 9457 Problem Details response carries a meaningful `title`.

The HTTP route handler SHALL convert this `ChatError` into a 502 RFC 9457 Problem Details response whose `detail` field carries the extracted provider message. The WebSocket route handler SHALL convert it into `{ type: "chat:error", id, detail: <extracted message> }`. The mid-stream error SHALL NOT be silently swallowed; the SSE loop SHALL NOT continue past the error chunk.

#### Scenario: Mid-stream error chunk after partial output

- **GIVEN** the upstream LLM has streamed two normal `data: {"choices":[{"delta":{"content":"…"}}]}` chunks and then a chunk `data: {"id":"…","object":"chat.completion.chunk","created":…,"error":{"message":"Provider connection lost","code":502},"choices":[{"finish_reason":"error","delta":{}}]}`
- **WHEN** `executeChat()` parses that error chunk
- **THEN** the function SHALL throw `ChatError("llm-stream", "Provider connection lost", 502)`, the chapter file SHALL contain the two streamed deltas, and the LLM interaction log SHALL include an entry with `errorCode: "stream-error"`

#### Scenario: Mid-stream error without a message field falls back

- **GIVEN** an SSE error chunk that contains `error: { code: 502 }` without a `message` field
- **WHEN** `executeChat()` parses that chunk
- **THEN** the thrown `ChatError`'s message SHALL be either the stringified `code` or the literal `"Mid-stream provider error"` (whichever the implementation selects, but it SHALL be a non-empty string)

#### Scenario: SSE error indicated only by finish_reason

- **GIVEN** an SSE chunk whose `parsed.choices[0].finish_reason === "error"` but `parsed.error` is missing
- **WHEN** `executeChat()` parses that chunk
- **THEN** the function SHALL still abort the stream, throw `ChatError("llm-stream", ...)`, and log `errorCode: "stream-error"`

#### Scenario: HTTP client receives RFC 9457 Problem Details on mid-stream error

- **GIVEN** a mid-stream error during an HTTP `POST /api/stories/:series/:name/chat` request
- **WHEN** `executeChat()` throws `ChatError("llm-stream", <message>, 502)`
- **THEN** the HTTP response SHALL be 502 with body `{ "type": "...", "title": "...", "status": 502, "detail": <message> }`

#### Scenario: WebSocket client receives chat:error envelope on mid-stream error

- **GIVEN** a mid-stream error during a WebSocket `chat:send` request
- **WHEN** `executeChat()` throws `ChatError("llm-stream", <message>, 502)`
- **THEN** the server SHALL send `{ type: "chat:error", id: <request-id>, detail: <message> }` and SHALL NOT send `chat:done` or `chat:aborted` for that request

### Requirement: Partial chapter content preserved on abort paths

When an in-flight chat generation is cancelled by HTTP client disconnect, WebSocket `chat:abort`, or WebSocket close, the chapter file (if already opened — see the abort-during-initial-fetch scenario above) SHALL retain exactly the bytes already flushed to disk at the moment of cancellation, including the leading `<user_message>` block. The server SHALL NOT attempt to delete, truncate, or rewrite the partial chapter file as part of cancellation handling. (Operators or the user may delete the partial chapter manually via the existing rewind / delete-last-chapter routes.)

If the abort fires before the upstream `fetch()` resolves, no chapter file is opened, and there is nothing to preserve — `executeChat()` SHALL still throw `ChatAbortError`, but the route handler SHALL NOT expect a chapter file to exist.

#### Scenario: Abort preserves user message block

- **GIVEN** a chat request whose chapter file has been opened and the `<user_message>…</user_message>\n\n` prefix written
- **WHEN** the signal is aborted before any content delta is written
- **THEN** the chapter file SHALL retain the `<user_message>…</user_message>\n\n` block on disk and SHALL NOT be deleted

#### Scenario: Abort before chapter open creates no file

- **GIVEN** a chat request whose signal is aborted before the upstream `fetch()` resolves (and therefore before the chapter file is opened)
- **WHEN** `executeChat()` rejects with `ChatAbortError`
- **THEN** the target chapter path SHALL NOT exist on disk (no file is created or opened)

### Requirement: Partial chapter content preserved on mid-stream provider error

When the upstream LLM signals a mid-stream error (per the requirement above), the chapter file SHALL retain exactly the bytes flushed before the error chunk arrived, including the leading `<user_message>` block. The server SHALL NOT delete, truncate, or rewrite the partial chapter file as part of mid-stream-error handling. (Conceptually distinct from cancellation: mid-stream provider errors yield `ChatError` / 502 / `chat:error`, while cancellation yields `ChatAbortError` / 499 / `chat:aborted`.)

#### Scenario: Mid-stream error preserves streamed deltas

- **GIVEN** a chat request that has streamed N content deltas before a mid-stream error chunk arrives
- **WHEN** `executeChat()` throws `ChatError("llm-stream", ...)`
- **THEN** the chapter file SHALL contain the user message block plus exactly those N deltas, and SHALL NOT be deleted or truncated
