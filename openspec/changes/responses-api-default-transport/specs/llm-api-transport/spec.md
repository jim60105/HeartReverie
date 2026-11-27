# Spec Delta

## Purpose

Selects the upstream LLM wire protocol (OpenAI Responses API by default, Chat Completions as fallback or forced mode) and defines how Responses requests are built and Responses streams are parsed so content, reasoning, usage and errors behave like the Chat Completions path.

## ADDED Requirements

### Requirement: Transport mode configuration

The server SHALL read the deployment-level env var `LLM_API_MODE` with accepted values `auto`, `responses` and `chat-completions` (exact, case-sensitive, trimmed), defaulting to `auto`. Any other non-empty value SHALL fall back to `auto` with a warning naming the variable and value. The mode SHALL NOT be configurable per story and SHALL NOT appear in `GET /api/llm-defaults`.

#### Scenario: Unset defaults to auto
- **WHEN** `LLM_API_MODE` is unset or empty
- **THEN** the resolved mode SHALL be `auto` and no warning SHALL be logged

#### Scenario: Valid forced mode
- **WHEN** `LLM_API_MODE` is ` chat-completions ` (with surrounding whitespace)
- **THEN** the resolved mode SHALL be `chat-completions`

#### Scenario: Invalid value falls back with warning
- **WHEN** `LLM_API_MODE` is `Responses`
- **THEN** the resolved mode SHALL be `auto` and a warning naming `LLM_API_MODE` and `Responses` SHALL be logged

#### Scenario: Not exposed per story
- **WHEN** a client calls `GET /api/llm-defaults`
- **THEN** the response body SHALL NOT contain an `LLM_API_MODE` or `apiMode` key

### Requirement: Endpoint derivation from LLM_API_URL

The server SHALL derive both transport URLs from `LLM_API_URL`. If the URL path ends with `/chat/completions`, the Responses URL SHALL replace that suffix with `/responses`. If it ends with `/responses`, the Chat Completions URL SHALL replace it with `/chat/completions`. Query string and host SHALL be preserved. Otherwise no derivation exists and both transports SHALL use the URL verbatim.

#### Scenario: Default OpenRouter URL derives a Responses URL
- **WHEN** `LLM_API_URL` is `https://openrouter.ai/api/v1/chat/completions`
- **THEN** the Responses URL SHALL be `https://openrouter.ai/api/v1/responses` and the Chat Completions URL SHALL be `https://openrouter.ai/api/v1/chat/completions`

#### Scenario: Responses URL derives a Chat Completions URL
- **WHEN** `LLM_API_URL` is `http://127.0.0.1:11434/v1/responses?x=1`
- **THEN** the Chat Completions URL SHALL be `http://127.0.0.1:11434/v1/chat/completions?x=1`

#### Scenario: Unrecognised path has no derivation
- **WHEN** `LLM_API_URL` is `http://localhost:1/nonexistent`
- **THEN** both transport URLs SHALL equal `http://localhost:1/nonexistent` and derivation SHALL be reported as unavailable

### Requirement: Transport attempt plan

For each generation the server SHALL plan an ordered transport list. `chat-completions` mode SHALL use only Chat Completions, and `responses` mode SHALL use only Responses. `auto` mode SHALL try Responses then Chat Completions. It SHALL use only Chat Completions when derivation is unavailable, when a fallback is cached for the (Responses URL, model) pair, or for `continue-last-chapter` generations (trailing-assistant prefill).

#### Scenario: Auto with derivation tries Responses first
- **GIVEN** mode `auto`, the default `LLM_API_URL`, and an empty fallback cache
- **WHEN** a chat generation starts
- **THEN** the first upstream `fetch` SHALL target `https://openrouter.ai/api/v1/responses`

#### Scenario: Forced chat-completions never calls Responses
- **GIVEN** mode `chat-completions`
- **WHEN** a chat generation runs
- **THEN** exactly one upstream `fetch` SHALL occur and it SHALL target the Chat Completions URL

#### Scenario: Auto continue-last-chapter uses Chat Completions
- **GIVEN** mode `auto`, the default `LLM_API_URL`, and an empty fallback cache
- **WHEN** a `continue-last-chapter` generation runs
- **THEN** its only upstream `fetch` SHALL target `https://openrouter.ai/api/v1/chat/completions` with a `messages` body

#### Scenario: Auto without derivation uses Chat Completions
- **GIVEN** mode `auto` and `LLM_API_URL` `http://localhost:1/nonexistent`
- **WHEN** a chat generation runs
- **THEN** the only upstream `fetch` SHALL use the Chat Completions request body

### Requirement: Auto-mode fallback on unsupported Responses endpoint

In `auto` mode, when the Responses attempt returns HTTP 404, 405 or 501 before any stream is consumed, the server SHALL discard that response and retry the same generation once over Chat Completions. No chapter file SHALL be opened before the successful attempt. No other status, network error or abort SHALL trigger a fallback. Forced modes SHALL never fall back.

#### Scenario: 404 falls back to Chat Completions
- **GIVEN** mode `auto` and an upstream whose `/responses` returns 404 and whose `/chat/completions` streams content
- **WHEN** a chat generation runs
- **THEN** two upstream fetches SHALL occur (Responses then Chat Completions) and the chapter SHALL contain the Chat Completions content

#### Scenario: 500 does not fall back
- **GIVEN** mode `auto` and an upstream whose `/responses` returns 500
- **WHEN** a chat generation runs
- **THEN** exactly one upstream fetch SHALL occur and the generation SHALL fail with `ChatError` code `llm-api` and status 500

#### Scenario: Forced responses surfaces 404
- **GIVEN** mode `responses` and an upstream whose `/responses` returns 404
- **WHEN** a chat generation runs
- **THEN** exactly one upstream fetch SHALL occur and the generation SHALL fail with `ChatError` code `llm-api` and status 404

#### Scenario: Abort before Responses resolves does not fall back
- **GIVEN** mode `auto` and an abort signal fired while the Responses fetch is pending
- **WHEN** the fetch rejects
- **THEN** the generation SHALL fail with `ChatAbortError` and no Chat Completions fetch SHALL occur

#### Scenario: Fallback failure surfaces the Chat Completions error
- **GIVEN** mode `auto`, `/responses` returning 404 and `/chat/completions` returning 401
- **WHEN** a chat generation runs
- **THEN** the generation SHALL fail with `ChatError` code `llm-api` and status 401

### Requirement: Fallback capability cache

After a fallback Chat Completions attempt returns 2xx, the server SHALL record the (Responses URL, model) pair in process memory. Later `auto` generations for that pair SHALL skip Responses. A failed fallback SHALL NOT be recorded. The cache SHALL last for the process lifetime and SHALL be resettable for tests.

#### Scenario: Second generation skips Responses
- **GIVEN** a prior `auto` generation for model `m` fell back successfully
- **WHEN** another `auto` generation for model `m` runs
- **THEN** its only upstream fetch SHALL target the Chat Completions URL

#### Scenario: Cache is per model
- **GIVEN** a prior successful fallback for model `m`
- **WHEN** an `auto` generation for model `n` runs
- **THEN** its first upstream fetch SHALL target the Responses URL

#### Scenario: Failed fallback is not cached
- **GIVEN** a prior `auto` generation where `/responses` returned 404 and `/chat/completions` returned 401
- **WHEN** another `auto` generation for the same model runs
- **THEN** its first upstream fetch SHALL target the Responses URL

### Requirement: Shared request headers across transports

Every upstream `fetch` SHALL carry `Content-Type: application/json` and the hard-coded OpenRouter attribution headers on both transports and on every attempt. It SHALL add `Authorization: Bearer <key>` only when `LLM_API_KEY` is non-empty, and the caller's abort signal SHALL be forwarded to each attempt.

#### Scenario: Keyless Responses request omits Authorization
- **GIVEN** `LLM_API_KEY` is unset and mode `responses`
- **WHEN** a chat generation runs
- **THEN** the Responses `fetch` SHALL have no `Authorization` header and SHALL carry the three attribution headers

#### Scenario: Both attempts carry the key
- **GIVEN** `LLM_API_KEY` is `k` and an `auto` generation that falls back
- **WHEN** both fetches are issued
- **THEN** each SHALL carry `Authorization: Bearer k`

### Requirement: Responses request body

The Responses body SHALL contain `model`, `input` (the chat messages array), `stream: true`, `store: false`, `temperature`, `top_p`, `top_k`, `frequency_penalty` and `presence_penalty`. It SHALL contain `max_output_tokens` only when `maxCompletionTokens` is non-null. It SHALL NOT contain `messages`, `max_completion_tokens`, `repetition_penalty`, `min_p`, `top_a`, `usage` or `stream_options`.

#### Scenario: Body fields with a token cap
- **GIVEN** a merged config with `maxCompletionTokens: 4096` and `temperature: 0.7`
- **WHEN** the Responses body is built
- **THEN** it SHALL contain `max_output_tokens: 4096`, `temperature: 0.7`, `store: false`, `stream: true`, and `input` deep-equal to the messages array

#### Scenario: Null token cap omits the key
- **GIVEN** a merged config with `maxCompletionTokens: null`
- **WHEN** the Responses body is built
- **THEN** the body SHALL have no `max_output_tokens` key

#### Scenario: Chat-only keys are absent
- **WHEN** the Responses body is built
- **THEN** it SHALL have none of the keys `messages`, `max_completion_tokens`, `repetition_penalty`, `min_p`, `top_a`, `usage`, `stream_options`

### Requirement: Responses reasoning request parameter

The Responses body SHALL carry `reasoning: { effort: <reasoningEffort>, summary: "auto" }` when `reasoningEnabled` is true, and `reasoning: { effort: "none" }` when it is false. When `LLM_REASONING_OMIT` is true the `reasoning` key SHALL be absent.

#### Scenario: Enabled reasoning
- **GIVEN** `reasoningEnabled: true` and `reasoningEffort: "high"`
- **WHEN** the Responses body is built
- **THEN** `reasoning` SHALL deep-equal `{ "effort": "high", "summary": "auto" }`

#### Scenario: Disabled reasoning
- **GIVEN** `reasoningEnabled: false`
- **WHEN** the Responses body is built
- **THEN** `reasoning` SHALL deep-equal `{ "effort": "none" }`

#### Scenario: Omit flag removes reasoning
- **GIVEN** `LLM_REASONING_OMIT=true`
- **WHEN** the Responses body is built
- **THEN** the body SHALL have no `reasoning` key

### Requirement: Responses stream content parsing

On the Responses transport the SSE parser SHALL read each `data:` JSON payload by its `type`. Each `response.output_text.delta` `delta` SHALL be content and go through the same persistence and `response-stream` hook path as Chat Completions content. `data: [DONE]`, unknown types and malformed JSON SHALL be ignored.

#### Scenario: Output text deltas are persisted
- **GIVEN** a Responses stream with `{"type":"response.output_text.delta","delta":"Hel"}`, `{"type":"response.output_text.delta","delta":"lo"}`, `{"type":"response.completed","response":{}}`
- **WHEN** a `write-new-chapter` generation consumes it
- **THEN** the returned `content` SHALL be `Hello` and the chapter file SHALL end with `Hello`

#### Scenario: Stream with no output text is no-content
- **GIVEN** a Responses stream containing only `response.created` and `response.completed` events
- **WHEN** the generation consumes it
- **THEN** it SHALL fail with `ChatError` code `no-content` and status 502

### Requirement: Responses reasoning stream parsing

On the Responses transport, `response.reasoning_text.delta` and `response.reasoning_summary_text.delta` deltas SHALL be reasoning text, framed in the chapter's `<think>` block exactly like Chat Completions reasoning. Only the first reasoning kind seen in a stream SHALL be used. A `response.reasoning_summary_part.added` event with `summary_index` > 0 SHALL insert `\n\n` into summary reasoning.

#### Scenario: Summary reasoning framed before content
- **GIVEN** a Responses stream with summary deltas `Plan. ` and `Done.` followed by output text `Story`
- **WHEN** a `write-new-chapter` generation consumes it
- **THEN** the chapter file SHALL contain `<think>\nPlan. Done.\n</think>\n\nStory` and the returned `content` SHALL be `Story`

#### Scenario: Second reasoning kind is dropped
- **GIVEN** a Responses stream with reasoning-text delta `raw` then a summary delta `sum` then output text `X`
- **WHEN** the generation consumes it
- **THEN** the `<think>` block SHALL contain `raw` and SHALL NOT contain `sum`, and `reasoningLength` SHALL be 3

#### Scenario: Summary parts separated
- **GIVEN** summary delta `A`, then `response.reasoning_summary_part.added` with `summary_index: 1`, then summary delta `B`, then output text `X`
- **WHEN** the generation consumes it
- **THEN** the `<think>` block body SHALL be `A\n\nB`

### Requirement: Responses usage mapping

On the Responses transport, the `response.usage` object of a `response.completed` or `response.incomplete` event SHALL map to the token usage as follows: `input_tokens` to prompt, `output_tokens` to completion, `total_tokens` to total, and a finite non-negative `cost` to the upstream cost. The usage record and `post-response` payload SHALL then follow the existing rules.

#### Scenario: Usage with cost recorded
- **GIVEN** a successful Responses stream ending with `{"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15,"cost":0.002}}}`
- **WHEN** the generation completes
- **THEN** the returned `usage` SHALL have `promptTokens: 10`, `completionTokens: 5`, `totalTokens: 15`, `upstreamCostUsd: 0.002`

#### Scenario: Missing usage yields null
- **GIVEN** a successful Responses stream whose `response.completed` has no `usage`
- **WHEN** the generation completes
- **THEN** the returned `usage` SHALL be `null`

### Requirement: Responses mid-stream errors

On the Responses transport, an `error` event, a `response.failed` event, or any payload with a non-null top-level `error` object SHALL abort consumption with `ChatError("llm-stream", <message>, 502)`. One `stream-error` LLM-log entry SHALL be written and already-written chapter bytes SHALL be preserved. The message SHALL be the error's `message`, else its `code`, else `Mid-stream provider error`.

#### Scenario: response.failed surfaces provider message
- **GIVEN** a Responses stream with output text `Part` then `{"type":"response.failed","response":{"error":{"code":"server_error","message":"Upstream died"}}}`
- **WHEN** a `write-new-chapter` generation consumes it
- **THEN** it SHALL fail with `ChatError` code `llm-stream`, status 502, message `Upstream died`, and the chapter file SHALL still end with `Part`

#### Scenario: error event without message uses code
- **GIVEN** a Responses stream containing `{"type":"error","code":"rate_limit"}`
- **WHEN** the generation consumes it
- **THEN** it SHALL fail with `ChatError` message `rate_limit`

### Requirement: Post-response endpoint reflects the serving transport

The `post-response` payload `endpoint` field SHALL equal the URL of the upstream `fetch` that produced the consumed stream, which is the Responses URL or the Chat Completions URL.

#### Scenario: Fallback reports Chat Completions URL
- **GIVEN** an `auto` generation that fell back from `https://openrouter.ai/api/v1/responses`
- **WHEN** `post-response` is dispatched
- **THEN** `endpoint` SHALL be `https://openrouter.ai/api/v1/chat/completions`

#### Scenario: Responses success reports Responses URL
- **GIVEN** an `auto` generation served by Responses on the default URL
- **WHEN** `post-response` is dispatched
- **THEN** `endpoint` SHALL be `https://openrouter.ai/api/v1/responses`
