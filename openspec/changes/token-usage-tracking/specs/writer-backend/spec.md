## ADDED Requirements

### Requirement: Token usage persistence in chat execution

`executeChat()` in `writer/lib/chat-shared.ts` SHALL, on successful completion, append a `TokenUsageRecord` (shape defined in the `token-usage-tracking` capability) to `playground/<series>/<story>/_usage.json` via the helper `appendUsage()` in a new `writer/lib/usage.ts` module, provided the captured `tokenUsage` has non-null `prompt`, `completion`, and `total` values. Aborted or errored generations SHALL NOT append records. Failures during the append SHALL be logged and swallowed so the chat result is still returned to the client. The returned `ChatResult` SHALL gain an optional field `usage: TokenUsageRecord | null` populated from the appended record (or `null` when none was appended).

#### Scenario: Successful generation appends a record and returns it
- **GIVEN** `executeChat()` runs with upstream usage `{ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }`
- **WHEN** generation completes normally
- **THEN** a record with those values, the resolved `model`, the target chapter number, and an ISO 8601 timestamp SHALL be appended to `_usage.json`, and `ChatResult.usage` SHALL equal that record

#### Scenario: Aborted generation leaves `_usage.json` untouched
- **GIVEN** the client aborts the WebSocket generation mid-stream
- **WHEN** `executeChat()` throws `ChatAbortError`
- **THEN** no record SHALL be appended

#### Scenario: Append failure does not fail the chat
- **GIVEN** `appendUsage()` throws an I/O error (e.g. read-only directory)
- **WHEN** `executeChat()` handles the error
- **THEN** `executeChat()` SHALL still return a `ChatResult` with the generated content and SHALL log the append failure at warn level

### Requirement: `GET /api/stories/:series/:name/usage` route registration

The backend SHALL register `GET /api/stories/:series/:name/usage` via a new `registerUsageRoutes(app, deps)` in `writer/routes/usage.ts`, wired from `writer/app.ts` behind the existing auth + rate-limit middleware. The handler SHALL validate `:series`/`:name` via `safePath()` (rejecting underscore-prefixed and traversing paths), read the ledger via `readUsage()`, compute totals via `computeTotals()`, and return `{ records, totals }` as HTTP 200 JSON. Absent ledger SHALL yield an empty-but-valid response; malformed ledger SHALL be treated as empty (the backup behaviour in `appendUsage()` is the single source of truth for recovery).

#### Scenario: Route is mounted behind auth
- **WHEN** a client calls `GET /api/stories/<series>/<name>/usage` without a valid `X-Passphrase`
- **THEN** the server SHALL respond with HTTP 401 via the existing passphrase middleware

#### Scenario: Route rejects reserved series/name
- **WHEN** a client calls `GET /api/stories/_prompts/foo/usage` with a valid passphrase
- **THEN** the server SHALL respond with HTTP 400 via the existing reserved-directory validation

#### Scenario: Route returns empty ledger for fresh story
- **GIVEN** a story with no `_usage.json`
- **WHEN** an authenticated client calls the endpoint
- **THEN** the response SHALL be HTTP 200 with `{ records: [], totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 } }`
