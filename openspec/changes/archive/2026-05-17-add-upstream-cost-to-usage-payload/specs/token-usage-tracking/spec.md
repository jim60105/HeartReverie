## ADDED Requirements

### Requirement: Optional upstream-billed cost in `TokenUsageRecord`

The `TokenUsageRecord` shape SHALL accept an OPTIONAL `upstreamCostUsd` field of type `number | null`. When present and non-null the value SHALL be a finite, non-negative number expressed in USD representing the upstream provider's authoritative billed cost for the generation. When the upstream LLM does not report a usable cost, the field SHALL be omitted from the record or SHALL be `null`. The engine SHALL NEVER synthesise this value from a client-side price table or any other estimate; it SHALL come from the upstream `usage.cost` field on the final SSE chunk only.

#### Scenario: Upstream reports a positive cost

- **GIVEN** the final SSE chunk contains `usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, cost: 0.0123 }`
- **WHEN** `executeChat()` builds the `TokenUsageRecord`
- **THEN** the record SHALL have `upstreamCostUsd === 0.0123`

#### Scenario: Upstream omits `cost`

- **GIVEN** the final SSE chunk contains `usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }` with no `cost` key
- **WHEN** `executeChat()` builds the `TokenUsageRecord`
- **THEN** the record SHALL NOT include `upstreamCostUsd` (the field SHALL be absent or `null`)

#### Scenario: Upstream emits a non-finite or negative `cost`

- **GIVEN** the final SSE chunk contains `usage.cost = -1` or `cost = NaN` or `cost = Infinity` or `cost = "0.01"` (a string)
- **WHEN** `executeChat()` builds the `TokenUsageRecord`
- **THEN** the value SHALL be treated as absent and the record SHALL NOT include `upstreamCostUsd`

#### Scenario: `_usage.json` roundtrip preserves `upstreamCostUsd`

- **GIVEN** a `TokenUsageRecord` with `upstreamCostUsd: 0.005` is appended to `_usage.json`
- **WHEN** `readUsage()` reads the file
- **THEN** the returned record SHALL have `upstreamCostUsd === 0.005`

#### Scenario: `_usage.json` roundtrip tolerates absence of `upstreamCostUsd`

- **GIVEN** a `_usage.json` entry without the `upstreamCostUsd` key
- **WHEN** `readUsage()` parses it
- **THEN** the record SHALL be returned and SHALL NOT have an `upstreamCostUsd` property

### Requirement: Request opts into upstream usage accounting

The LLM request body constructed by `executeChat()` SHALL include `usage: { include: true }` as a top-level field, sent unconditionally on every chat-completion request. This field is the OpenRouter opt-in that triggers emission of `usage.cost` on the final SSE chunk; OpenAI-compatible backends that do not recognise the field ignore it without error.

#### Scenario: Every chat completion request opts in

- **GIVEN** any successful or failed `executeChat()` invocation
- **WHEN** the request body is serialised for the upstream `fetch()`
- **THEN** the serialised JSON SHALL contain a top-level `usage` object with `include === true`, alongside `stream_options.include_usage === true`
