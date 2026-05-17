## Why

Token-based pricing tables are inaccurate when the LLM provider routes to many upstream backends each with their own per-call billing (OpenRouter is the canonical example). OpenRouter already exposes the true provider-billed amount on the final SSE chunk as `usage.cost` (USD) when the request opts in via `usage: { include: true }` at the top level of the request body. The engine currently strips this number on the floor: it reads `prompt_tokens`/`completion_tokens`/`total_tokens` but discards every other key on the upstream `usage` object. Plugins that want to attribute real spend (rather than estimate it from a stale price sheet) therefore have no way to see the authoritative figure.

## What Changes

- **MODIFIED:** `executeChat()` SHALL add `usage: { include: true }` as a top-level field of the LLM request body, alongside the existing `stream_options: { include_usage: true }`. Non-OpenRouter OpenAI-compatible backends ignore unknown top-level fields, so this is safe to send unconditionally.
- **MODIFIED:** The SSE parser in `chat-shared.ts` SHALL additionally capture `usage.cost` from the final usage chunk when it is a finite non-negative number; otherwise it SHALL be treated as absent. The captured value SHALL be passed through `buildRecord(...)` and reach `ctx.usage.upstreamCostUsd` on every `post-response` payload, alongside the existing token counts.
- **ADDED:** A new optional field `upstreamCostUsd?: number | null` SHALL be declared on `TokenUsageRecord` (`writer/types.ts`). The field SHALL be present and finite when the upstream reported a usable cost; it SHALL be omitted (or `null`) otherwise. The engine SHALL NEVER synthesise the field from a price table or any other client-side estimate.
- **MODIFIED:** `buildRecord(...)` and `coerceRecord(...)` in `writer/lib/usage.ts` SHALL roundtrip the new optional field through `_usage.json`: records written with a cost SHALL parse back with the cost; records written without a cost SHALL continue to parse cleanly with the field omitted.

## Capabilities

### Modified Capabilities

- `token-usage-tracking`: extends the `TokenUsageRecord` shape and the SSE-parsing contract to cover the new optional `upstreamCostUsd` field.
- `plugin-hooks`: documents that the `post-response` payload's `usage.upstreamCostUsd` (when present) is the provider-billed USD amount, not a client-side estimate.

## Impact

- **Code touched:** `writer/types.ts`, `writer/lib/chat-shared.ts` (request body + SSE parse + `buildRecord` call), `writer/lib/usage.ts` (`buildRecord` signature + `coerceRecord` parse).
- **Disk format:** `_usage.json` gains an OPTIONAL `upstreamCostUsd` key per record. Old records without the key remain valid; new records that lack it are still valid. No migration.
- **Plugin API:** strictly additive. `ctx.usage` is still `TokenUsageRecord | null`; subscribers that ignore `upstreamCostUsd` keep working.
