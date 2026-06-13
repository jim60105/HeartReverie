## ADDED Requirements

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
