## ADDED Requirements

### Requirement: `post-response` payload exposes upstream-billed cost when available

When the `post-response` hook fires with a non-null `usage` and the upstream LLM reported a usable cost on the final SSE chunk, the dispatched payload's `usage.upstreamCostUsd` SHALL equal that upstream-reported USD amount (a finite number `>= 0`). When the upstream did not report a usable cost, `usage.upstreamCostUsd` SHALL be absent or `null` on the dispatched payload. The engine SHALL NEVER fabricate this value from a client-side price table; plugins that need a cost estimate when the upstream did not provide one MUST compute it themselves from the token counts.

#### Scenario: OpenRouter-style upstream populates the field

- **GIVEN** the upstream emits `usage.cost = 0.0123` on the final SSE chunk
- **WHEN** the `post-response` hook is dispatched
- **THEN** the deep-frozen payload SHALL satisfy `ctx.usage.upstreamCostUsd === 0.0123`

#### Scenario: Upstream omits the cost

- **GIVEN** the upstream emits a `usage` object without a `cost` key (e.g. OpenAI's native API)
- **WHEN** the `post-response` hook is dispatched with a non-null `usage`
- **THEN** the payload's `usage` SHALL NOT have an `upstreamCostUsd` property (or it SHALL be `null`), and the field SHALL NOT be synthesised by the engine
