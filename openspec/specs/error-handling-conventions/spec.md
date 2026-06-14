# Error Handling Conventions

## Purpose

Cross-cutting specification defining mandatory error handling patterns for all backend code in `writer/`. These conventions ensure production observability, correct error classification, and prevent silent failures.

## Requirements

### Requirement: Catch block error classification

All catch blocks in `writer/` that handle filesystem operations SHALL distinguish `Deno.errors.NotFound` from other error types. Only the NotFound case MAY return a fallback value (empty array, null, default). All other errors SHALL either be rethrown or result in an error response with server-side logging.

#### Scenario: File legitimately does not exist
- **WHEN** a filesystem operation throws `Deno.errors.NotFound`
- **AND** the code path expects that the file/directory may not exist (e.g., first-time story creation, optional config file)
- **THEN** the catch block SHALL return the documented fallback value (empty array, null, or default)

#### Scenario: Unexpected filesystem error
- **WHEN** a filesystem operation throws an error that is NOT `Deno.errors.NotFound`
- **THEN** the catch block SHALL log the error with context (operation name, file path, error message)
- **AND** either rethrow the error or return an appropriate error response (5xx for server errors, 4xx for client errors)

#### Scenario: Pattern for NotFound classification
- **WHEN** a developer writes a new catch block for filesystem operations
- **THEN** the pattern SHALL be:
  ```typescript
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return fallbackValue;
    }
    log.error(`[context] ${error}`);
    throw error;
  }
  ```

### Requirement: Server-side logging for 5xx responses

Every route handler catch block that returns an HTTP 5xx response SHALL log the error server-side before constructing the response.

#### Scenario: Route handler catches unexpected error
- **WHEN** a route handler catches an error that will result in a 5xx response
- **THEN** the handler SHALL call `log.error(...)` with the route context (HTTP method + path pattern) and the caught error
- **AND** THEN return the `problemJson()` response

#### Scenario: Log format for route errors
- **WHEN** logging a route handler error
- **THEN** the log message SHALL include: `[METHOD /api/path] error message`
- **AND** the full error object SHALL be passed to enable stack trace capture

### Requirement: Logger self-protection

The logger subsystem (`writer/lib/logger.ts`) SHALL NOT silently discard its own write failures.

#### Scenario: Log file write fails
- **WHEN** the logger fails to write to the log file (disk full, permissions, I/O error)
- **THEN** the logger SHALL emit the original log message and the write error to `console.error`
- **AND** the console.error output SHALL be debounced (maximum once per 60-second window)

#### Scenario: Logger recovery
- **WHEN** the logger successfully writes after a period of failures
- **THEN** it MAY emit a single recovery message indicating how many messages were affected

### Requirement: WebSocket polling error visibility

WebSocket polling catch blocks SHALL log errors at debug level to provide visibility into systematic failures.

#### Scenario: Single transient poll error
- **WHEN** a WebSocket polling operation fails once
- **THEN** it SHALL be logged at debug level with the operation context

#### Scenario: Repeated poll errors (rate limiting)
- **WHEN** WebSocket polling errors occur repeatedly (more than once per 5-second window for a given operation)
- **THEN** only one debug log entry SHALL be emitted per 5-second window **per operation key** (e.g., `"chapter-read"`, `"generation-check"`) to prevent log flooding
- **AND** a failure in one operation SHALL NOT suppress logging for a different operation

### Requirement: Request body parse failure handling

Route handlers that parse JSON request bodies SHALL NOT silently default to an empty object on parse failure.

#### Scenario: Malformed JSON request body
- **WHEN** `c.req.json()` throws a parse error
- **THEN** the handler SHALL log the error at warn level
- **AND** return HTTP 400 with a Problem Details response indicating invalid JSON

#### Scenario: Valid JSON request body
- **WHEN** `c.req.json()` succeeds
- **THEN** processing SHALL continue normally (no behavior change)

### Requirement: LLM streaming parse error logging

Malformed JSON chunks received during LLM streaming SHALL be logged at debug level.

#### Scenario: Malformed streaming chunk
- **WHEN** a JSON chunk from the LLM API fails to parse
- **THEN** the error SHALL be logged at debug level with a truncated payload (maximum 200 bytes)
- **AND** processing SHALL continue with the next chunk (existing resilience behavior preserved)

### Requirement: Error serialization

All error logging SHALL use a shared `serializeError()` utility to safely extract structured information from caught `unknown` values.

#### Scenario: Error instance caught
- **WHEN** a caught value is an `Error` instance
- **THEN** `serializeError` SHALL return an object with `name`, `message`, and `stack` properties

#### Scenario: Non-Error value caught
- **WHEN** a caught value is not an `Error` instance (e.g., a string, number, or null)
- **THEN** `serializeError` SHALL return an object with a `message` property containing `String(value)`

#### Scenario: Usage in log calls
- **WHEN** a developer logs a caught error
- **THEN** they SHALL use `serializeError(error)` to extract the message rather than calling `.message` directly on the `unknown` value

### Requirement: Error response correctness

Route handlers SHALL NOT return success responses (2xx) with empty/fallback data when the actual cause is a server error.

#### Scenario: Image metadata read failure (not NotFound)
- **WHEN** reading image metadata fails with an error other than NotFound (e.g., corrupt JSON, I/O error)
- **THEN** the handler SHALL return 500 with a Problem Details response
- **AND** log the error server-side

#### Scenario: Plugin file serving failure (not NotFound)
- **WHEN** serving a plugin file fails with an error other than NotFound (e.g., permission denied)
- **THEN** the handler SHALL return 500 (not 404)
- **AND** log the error at warn level

### Requirement: Centralized chat-pipeline error translation

The mapping from a thrown chat-pipeline error to a client-facing response SHALL be centralized in a single shared translator `translateChatError(err, fallbackDetail)` in `writer/lib/chat-error-translate.ts`. The translator SHALL own the `ChatErrorCode` → RFC 9457 title table (formerly the route-local `ERROR_TITLES`) and SHALL classify a thrown value into exactly one transport-agnostic outcome: `aborted` (for `ChatAbortError`), `vento` (for a `ChatError` whose `code === "vento"` and which carries a `ventoError` payload), `chat` (for any other `ChatError`), or `unexpected` (for a non-`ChatError` throw, carrying a `problemJson` built from `fallbackDetail`). Each non-`aborted` outcome SHALL carry the structured server-side log fields for the caller to log.

Both HTTP chat catch blocks (`writer/routes/chat.ts` send and continue) and both WebSocket chat catch blocks (`writer/routes/ws-chat.ts` send and continue) SHALL delegate to this translator rather than re-implementing the classification. No route file SHALL retain its own `ERROR_TITLES` table or `instanceof ChatError` translation branch. Every translated error other than an abort SHALL be logged server-side before the response is sent, preserving the existing route log-message strings. Adding a new `ChatErrorCode` SHALL require only two edits: the union in `chat-types.ts` and one title row in the translator.

#### Scenario: Known ChatError code is translated to its title and status
- **WHEN** `translateChatError` receives a `ChatError` with `code === "llm-api"` and `httpStatus === 502`
- **THEN** it SHALL return a `chat` outcome whose problem detail uses the title "AI Service Error" and whose status passes through as `502`, alongside the structured log fields

#### Scenario: Unknown ChatError code falls back to a default title
- **WHEN** `translateChatError` receives a `ChatError` whose `code` is not present in the title table
- **THEN** it SHALL return a `chat` outcome whose problem detail uses the title "Internal Server Error"

#### Scenario: Non-ChatError throw becomes an unexpected 500 with the fallback detail
- **WHEN** `translateChatError(err, "Failed to process chat request")` receives a value that is not a `ChatError` or `ChatAbortError`
- **THEN** it SHALL return an `unexpected` outcome with status `500` and a problem detail of `"Failed to process chat request"`, and log fields carrying the serialized error message

#### Scenario: Abort is translated without logging an error
- **WHEN** `translateChatError` receives a `ChatAbortError`
- **THEN** it SHALL return the `aborted` outcome and the caller SHALL NOT log it as an error

#### Scenario: HTTP responses are byte-identical after centralization
- **WHEN** the HTTP send or continue route catches a `ChatError` (including the vento case) or a non-`ChatError` throw
- **THEN** the resulting HTTP status, RFC 9457 title, and response body SHALL be identical to the pre-centralization behavior (the 422 vento body remains `{ type: "vento-error", ... }`)

#### Scenario: HTTP vento failure remains byte-identical (status, title, body)
- **WHEN** a captured HTTP response for a `vento` failure is diffed before and after centralization
- **THEN** both SHALL be HTTP `422` with a JSON body of `{ type: "vento-error", ... }` carrying the same structured `ventoError` payload, identical status line and content-type, and the diff SHALL be empty — any divergence is a STOP condition

#### Scenario: HTTP llm-api failure remains byte-identical (status passthrough, title)
- **WHEN** a captured HTTP response for an `llm-api` failure is diffed before and after centralization
- **THEN** both SHALL carry the RFC 9457 title "AI Service Error" with the upstream status passed through unchanged and an identical JSON body, and the diff SHALL be empty — any divergence is a STOP condition

### Requirement: WebSocket plugin-action failures are logged and use the shared problem helper

The WebSocket plugin-action handler (`writer/routes/ws-plugin-action.ts`) SHALL NOT return a `plugin-action:error` response to the client without first logging the failure server-side. The handler SHALL acquire a scoped logger via `createLogger("ws")` and, in its unexpected-error catch block, SHALL call `log.error(...)` with context including the `correlationId`, the `pluginName`, the serialized error message, and the stack when available, before sending the error envelope. The handler SHALL construct the `plugin-action:error` problem object via the shared `problemJson("Internal Server Error", 500, detail)` helper rather than a hand-built inline RFC 9457 literal. The resulting wire bytes SHALL be byte-identical to the prior literal (`{ type: "about:blank", title: "Internal Server Error", status: 500, detail }`), so existing clients observe no change.

#### Scenario: Unexpected plugin-action failure is logged before responding
- **WHEN** the plugin-action handler's catch block runs for an unexpected error
- **THEN** the handler SHALL call `log.error(...)` with the `correlationId`, `pluginName`, the serialized error message, and the stack (when available) before sending the `plugin-action:error` envelope

#### Scenario: Plugin-action error envelope uses problemJson with an identical wire shape
- **WHEN** the handler sends a `plugin-action:error` response
- **THEN** the `problem` object SHALL be produced by `problemJson("Internal Server Error", 500, detail)` and SHALL equal `{ type: "about:blank", title: "Internal Server Error", status: 500, detail }`, identical to the prior hand-built literal

### Requirement: State-diff YAML reads distinguish NotFound from other failures

The state-diff YAML read sites in `writer/routes/chapters.ts` (the batch-list mode and the single-chapter read) SHALL NOT use a bare `catch {}` that treats every failure as "no diff". The catch block SHALL distinguish `Deno.errors.NotFound` — which remains the silent, expected "this chapter has no diff" case — from all other errors (e.g. YAML parse failure, `PermissionDenied`), which SHALL be logged at warn level with context including the operation and the in-scope chapter number. The HTTP response behavior SHALL be unchanged: the resolved `stateDiff` SHALL remain `undefined` in every failure case, including non-NotFound failures; only the logging side effect is added.

#### Scenario: Absent state-diff file stays silent
- **WHEN** a state-diff read in `chapters.ts` throws `Deno.errors.NotFound`
- **THEN** the catch block SHALL NOT log an error and the resolved `stateDiff` SHALL be `undefined`

#### Scenario: Corrupt or unreadable state-diff file is logged
- **WHEN** a state-diff read in `chapters.ts` fails with an error other than `Deno.errors.NotFound` (e.g. malformed YAML or permission denied)
- **THEN** the catch block SHALL log at warn level with the operation and the in-scope chapter number, and the resolved `stateDiff` SHALL still be `undefined` so the HTTP response is unchanged

### Requirement: Single frontend ApiError structured error for problem details

The frontend SHALL define a single structured error class `ApiError extends Error` (in `reader-src/src/lib/api.ts`, or `reader-src/src/lib/errors.ts` if that is the better home) representing an RFC 9457 Problem Details response. `ApiError` SHALL carry:

- `message: string` — the human-readable string, computed **detail-first** and byte-identical to the prior `apiFetch` throw logic (`detail ?? errorMessage ?? (res.statusText || \`Request failed: ${url}\`)`).
- `status: number` — the HTTP status code.
- `type?: string` — the problem `type` slug, when present in the body.
- `title?: string` — the problem `title`, when present in the body.
- `body?: unknown` — the raw parsed JSON body, when the response body parsed as JSON.

The shared `apiFetch` SHALL throw `ApiError` on non-2xx responses when `throwOnError` is enabled (its default), parsing `type` / `title` / `status` / `body` alongside `detail`. The `message` value SHALL be unchanged from the prior implementation so existing consumers that match on `err.message` continue to work without edits.

#### Scenario: Problem body yields a populated ApiError

- **WHEN** `apiFetch` receives a non-2xx response whose JSON body is `{ type, title, detail }`
- **THEN** it SHALL throw an `ApiError` whose `status` equals the response status, `type` equals the body `type`, `title` equals the body `title`, and `message` equals the body `detail`

#### Scenario: Non-JSON body yields a fallback-message ApiError

- **WHEN** `apiFetch` receives a non-2xx response whose body is not valid JSON
- **THEN** it SHALL throw an `ApiError` whose `message` is the existing fallback string and whose `type` is `undefined`

#### Scenario: message byte-compatibility preserved

- **WHEN** any non-2xx response is thrown as an `ApiError`
- **THEN** `ApiError.message` SHALL equal the exact human string the prior `apiFetch` would have thrown, so message-matching catch sites elsewhere keep working without edits

### Requirement: Redundant frontend problem-details parsers are eliminated

The frontend SHALL have exactly one problem-details parser — the `ApiError` construction inside `apiFetch`. The previously-duplicated parsers SHALL be removed: `template-api.ts`'s `parseError` helper SHALL be deleted, and `useChatApi.runPluginPrompt`'s inline `!res.ok` body parser (the `problemType` block) SHALL be removed. No frontend code SHALL hand-parse an RFC 9457 response body outside `apiFetch`.

#### Scenario: parseError is gone

- **WHEN** `reader-src/src/lib/` is searched for `parseError`
- **THEN** no matches SHALL be returned

#### Scenario: runPluginPrompt no longer hand-parses problem bodies

- **WHEN** `reader-src/src/composables/useChatApi.ts` is searched for `problemType`
- **THEN** no matches SHALL be returned
