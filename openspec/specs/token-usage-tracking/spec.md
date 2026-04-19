# Token Usage Tracking

## Purpose

Persists LLM token usage per generation in a per-story `_usage.json` ledger, exposes it through a read endpoint, surfaces usage on chat completion frames, and renders cumulative/per-chapter stats in the reader UI so writers can monitor token consumption without external tooling.

## Requirements

### Requirement: Per-story `_usage.json` file format and location

Each story MAY have a backend-managed usage ledger at `playground/<series>/<story>/_usage.json`. The file SHALL be a JSON array whose elements are `TokenUsageRecord` objects. Its absence SHALL be semantically equivalent to an empty array. The leading underscore SHALL mark the file as system-reserved so the existing listing logic in `writer/lib/story.ts` continues to exclude it from user-visible series/story/chapter listings.

Each `TokenUsageRecord` SHALL have the shape:

```json
{
  "chapter": <integer >= 1>,
  "promptTokens": <integer >= 0>,
  "completionTokens": <integer >= 0>,
  "totalTokens": <integer >= 0>,
  "model": <non-empty string>,
  "timestamp": <ISO 8601 UTC string>
}
```

#### Scenario: Story without `_usage.json` returns empty ledger
- **WHEN** the read endpoint or `readUsage()` helper is invoked for a story that has never generated with usage data
- **THEN** the response SHALL be an empty `records` array with zeroed totals

#### Scenario: Records preserve insertion order
- **GIVEN** a story with three successful generations producing usage for chapters 1, 2, 3
- **WHEN** the ledger is read
- **THEN** `records` SHALL appear in append order, matching chapter creation order

#### Scenario: `_usage.json` is hidden from story listings
- **GIVEN** a story directory containing `001.md`, `002.md`, and `_usage.json`
- **WHEN** `GET /api/stories/<series>/<name>/chapters` is called
- **THEN** the returned chapter list SHALL NOT include `_usage.json`

### Requirement: Append-on-success semantics in `executeChat()`

After `executeChat()` in `writer/lib/chat-shared.ts` successfully completes a generation (no `ChatError`, no `ChatAbortError`), it SHALL append a `TokenUsageRecord` to `_usage.json` if and only if the captured `tokenUsage` has non-null values for `prompt`, `completion`, and `total`. The appended record's `chapter` SHALL equal the `targetNum` used for file write, `model` SHALL equal the **effective merged model** actually used for the upstream request (i.e. the `model` field of the per-request `LlmConfig` produced by merging env defaults with any per-story override from the `per-story-llm-settings` capability — NOT the raw env `config.LLM_MODEL` when a story override is in effect), and `timestamp` SHALL equal the backend wall-clock time at append, formatted as an ISO 8601 UTC string. Aborted or errored generations SHALL NOT append any record.

#### Scenario: Successful generation with full usage appends a record
- **GIVEN** the upstream LLM emits `usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }` on the final SSE chunk
- **WHEN** `executeChat()` completes normally
- **THEN** exactly one record SHALL be appended to `_usage.json` with `promptTokens=100`, `completionTokens=50`, `totalTokens=150`, the resolved `model`, the target chapter number, and the append timestamp

#### Scenario: Aborted generation does not append
- **GIVEN** the client sends `chat:abort` mid-stream
- **WHEN** `executeChat()` throws `ChatAbortError`
- **THEN** `_usage.json` SHALL NOT be modified

#### Scenario: Errored generation does not append
- **GIVEN** the upstream LLM returns HTTP 500 or the SSE stream errors
- **WHEN** `executeChat()` throws `ChatError`
- **THEN** `_usage.json` SHALL NOT be modified

#### Scenario: Provider omits usage — no record appended
- **GIVEN** the upstream LLM never emits a `usage` object
- **WHEN** `executeChat()` completes normally
- **THEN** the captured `tokenUsage` SHALL remain `{ prompt: null, completion: null, total: null }`, and no record SHALL be appended to `_usage.json`

#### Scenario: Partial usage is treated as unavailable
- **GIVEN** the upstream emits `usage: { total_tokens: 150 }` only
- **WHEN** `executeChat()` completes
- **THEN** no record SHALL be appended (full triple required) and the event SHALL be debug-logged

#### Scenario: Per-story model override is reflected in the persisted record
- **GIVEN** env default `LLM_MODEL=deepseek/deepseek-v3.2` and the target story's `_config.json` (from the `per-story-llm-settings` capability) contains `{ "model": "openai/gpt-4o-mini" }`
- **WHEN** `executeChat()` completes a successful generation using the merged configuration
- **THEN** the appended `TokenUsageRecord.model` SHALL equal `"openai/gpt-4o-mini"` (the effective merged model), and SHALL NOT equal the env default

### Requirement: Append must be resilient to concurrent writes and malformed existing files

`appendUsage()` in `writer/lib/usage.ts` SHALL serialise concurrent append operations for the same story directory using a per-story async lock, such that read-modify-write cycles do not interleave. If the existing `_usage.json` cannot be parsed as a JSON array of records, `appendUsage()` SHALL (a) copy the malformed file to `_usage.json.bak`, (b) log a warning, (c) treat the existing ledger as empty, and (d) proceed to write the new record as the sole element of a fresh array. Generation SHALL NOT be blocked by any failure to read or write the usage file — append errors SHALL be logged and swallowed.

#### Scenario: Concurrent appends to the same story serialise
- **GIVEN** two `executeChat()` invocations targeting the same story complete near-simultaneously (hypothetical)
- **WHEN** both call `appendUsage()`
- **THEN** both records SHALL end up in the file and neither SHALL overwrite the other

#### Scenario: Malformed existing file is backed up and replaced
- **GIVEN** `_usage.json` contains the string `not json`
- **WHEN** a new append is issued
- **THEN** the backend SHALL rename/copy the existing file to `_usage.json.bak`, log a warning, and write a fresh array containing only the new record

#### Scenario: File write failure does not fail the chat
- **GIVEN** the story directory becomes read-only between chapter write and usage append
- **WHEN** the usage append fails
- **THEN** `executeChat()` SHALL still return a successful `ChatResult` and SHALL log the append failure

### Requirement: `GET /api/stories/:series/:name/usage` read endpoint

The backend SHALL expose `GET /api/stories/:series/:name/usage`, registered in a new `writer/routes/usage.ts`, behind the existing `validateParams` middleware, passphrase auth, and global rate limiter. The response body SHALL be a JSON object `{ "records": TokenUsageRecord[], "totals": { "promptTokens": number, "completionTokens": number, "totalTokens": number, "count": number } }`. When `_usage.json` is absent the response SHALL be `{ "records": [], "totals": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "count": 0 } }` with HTTP 200.

#### Scenario: Missing passphrase is rejected
- **WHEN** a client calls `GET /api/stories/<series>/<name>/usage` without `X-Passphrase`
- **THEN** the server SHALL respond with HTTP 401 and an RFC 9457 Problem Details body

#### Scenario: Invalid series or name is rejected
- **WHEN** a client calls `GET /api/stories/_lore/foo/usage`
- **THEN** the server SHALL respond with HTTP 400 via the existing reserved-directory validation

#### Scenario: Absent file returns empty ledger with 200
- **GIVEN** a valid story with no `_usage.json`
- **WHEN** a client calls the usage endpoint with a valid passphrase
- **THEN** the response SHALL be HTTP 200 with `{ records: [], totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 } }`

#### Scenario: Populated file returns records and correct totals
- **GIVEN** `_usage.json` contains records summing to `promptTokens=300`, `completionTokens=150`, `totalTokens=450` across 3 records
- **WHEN** a client calls the usage endpoint
- **THEN** `totals` SHALL equal `{ promptTokens: 300, completionTokens: 150, totalTokens: 450, count: 3 }` and `records` SHALL contain all three records in insertion order

### Requirement: Usage payload on HTTP and WebSocket chat completion

When `executeChat()` returns a `ChatResult`, both chat transports SHALL surface the usage to the client additively. The HTTP response body of `POST /api/stories/:series/:name/chat` SHALL include `usage: TokenUsageRecord | null` alongside the existing `chapter` and `content` fields. The WebSocket `chat:done` frame (`WsChatDoneMessage`) SHALL include `readonly usage?: TokenUsageRecord | null`. When no record was appended (provider omitted usage), the field SHALL be explicitly `null` rather than omitted, so the frontend can distinguish "unavailable" from "unsupported".

#### Scenario: HTTP response includes usage when available
- **GIVEN** a successful generation with captured usage
- **WHEN** the client receives the HTTP chat response
- **THEN** the JSON body SHALL contain a `usage` field matching the appended record

#### Scenario: WebSocket `chat:done` includes usage when available
- **GIVEN** a successful WebSocket generation with captured usage
- **WHEN** the client receives `chat:done`
- **THEN** the frame SHALL contain `usage: <record>` with all six fields populated

#### Scenario: Usage is null when provider omits it
- **GIVEN** the upstream LLM emits no usage
- **WHEN** the client receives `chat:done` (or the HTTP response)
- **THEN** `usage` SHALL be `null` and no record SHALL exist on disk

### Requirement: Frontend `useUsage` composable and collapsible stats panel

The reader SHALL expose a `useUsage()` composable at `reader-src/src/composables/useUsage.ts` that maintains per-story usage state (`records`, `totals`) and provides `load(series, story)` (calls `GET /api/stories/:series/:name/usage`) and `pushRecord(record)` (local append used on `chat:done`). The reading view SHALL render a collapsible "Token usage" panel (e.g. `UsagePanel.vue`) that, when collapsed, shows the cumulative total and the last chapter's prompt+completion breakdown in compact form, and when expanded shows at minimum the 10 most recent records with `chapter`, `promptTokens`, `completionTokens`, `totalTokens`, `model`, and `timestamp`. When a record's values are unavailable (e.g. loading or provider omitted), the panel SHALL display `—` in place of numbers.

#### Scenario: Panel loads existing usage on story selection
- **WHEN** the user opens a story that has a populated `_usage.json`
- **THEN** the panel SHALL call `load(series, story)` and render cumulative totals matching the server's totals

#### Scenario: Panel updates on `chat:done` with usage
- **GIVEN** the panel is mounted for the current story
- **WHEN** a WebSocket `chat:done` frame arrives with `usage: <record>`
- **THEN** the panel SHALL push the record, the cumulative totals SHALL update, and the "last chapter" summary SHALL reflect the new record without a manual refresh

#### Scenario: Panel handles absent usage gracefully
- **GIVEN** a `chat:done` frame arrives with `usage: null`
- **WHEN** the panel processes the event
- **THEN** the panel SHALL show `—` for that chapter's breakdown and leave the cumulative totals unchanged

#### Scenario: HTTP fallback triggers a refetch
- **GIVEN** the client is using the HTTP fallback path (WebSocket disconnected)
- **WHEN** the HTTP chat response resolves
- **THEN** the composable SHALL call `load(series, story)` to refresh state from the server rather than rely on an in-band message
