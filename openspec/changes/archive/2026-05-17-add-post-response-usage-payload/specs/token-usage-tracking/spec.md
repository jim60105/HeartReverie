## MODIFIED Requirements

### Requirement: Append-on-success semantics in `executeChat()`

After `executeChat()` in `writer/lib/chat-shared.ts` successfully completes a generation (no `ChatError`, no `ChatAbortError`), it SHALL append a `TokenUsageRecord` to `_usage.json` if and only if the captured `tokenUsage` has non-null values for `prompt`, `completion`, and `total`. This append SHALL occur for **every** successful `writeMode` branch — `write-new-chapter`, `append-to-existing-chapter`, `continue-last-chapter`, and `replace-last-chapter` — so the ledger is invariant to which branch produced the completion. The appended record's `chapter` SHALL equal the `targetNum` used for file write, `model` SHALL equal the **effective merged model** actually used for the upstream request (i.e. the `model` field of the per-request `LlmConfig` produced by merging env defaults with any per-story override from the `per-story-llm-settings` capability — NOT the raw env `config.LLM_MODEL` when a story override is in effect), and `timestamp` SHALL equal the backend wall-clock time at append, formatted as an ISO 8601 UTC string. Aborted or errored generations SHALL NOT append any record.

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

#### Scenario: Append-to-existing-chapter branch also appends

- **GIVEN** a successful plugin-action run whose `writeMode` is `append-to-existing-chapter` and whose upstream `usage` triple is fully populated
- **WHEN** `executeChat()` completes normally and appends the wrapped block to the existing chapter file
- **THEN** exactly one `TokenUsageRecord` SHALL be appended to `_usage.json` before the `post-response` hook is dispatched, with `chapter` equal to the existing chapter's number, matching the behaviour of the other three success branches
