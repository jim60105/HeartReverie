## 1. Types

- [x] 1.1 Add optional `readonly upstreamCostUsd?: number | null` to `TokenUsageRecord` in `writer/types.ts`
- [x] 1.2 Add optional `cost?: number` to `LLMStreamChunk.usage` in `writer/types.ts`

## 2. Request body opt-in

- [x] 2.1 In `writer/lib/chat-shared.ts`, add `usage: { include: true }` as a top-level sibling of `stream_options` in the constructed request body

## 3. SSE capture

- [x] 3.1 Extend the local `tokenUsage` state in `chat-shared.ts` with a fourth slot `cost: number | null` (initialised to `null`)
- [x] 3.2 In the `parsed.usage` branch of `handlePayload`, validate `parsed.usage.cost` is `typeof "number"`, `isFinite`, and `>= 0`; otherwise treat as `null`
- [x] 3.3 Pass `upstreamCostUsd: tokenUsage.cost` into `buildRecord(...)` at the usage-record construction site

## 4. usage.ts roundtrip

- [x] 4.1 Extend `buildRecord` input with optional `upstreamCostUsd?: number | null`; emit the field on the returned record only when finite and non-negative
- [x] 4.2 Extend `coerceRecord` to read `upstreamCostUsd` from disk, validate it the same way, and include it on the returned record when valid; records without it MUST still parse

## 5. Tests

- [x] 5.1 `buildRecord` unit test: returns the cost when provided
- [x] 5.2 `buildRecord` unit test: omits the field when absent / null / negative / non-finite
- [x] 5.3 `appendUsage` + `readUsage` roundtrip test: cost survives disk roundtrip; records without cost still parse
- [x] 5.4 SSE-driven test in `chat_shared_usage_test.ts`: final chunk with `usage.cost: 0.0123` → `ctx.usage.upstreamCostUsd === 0.0123` on the dispatched `post-response` payload
- [x] 5.5 SSE-driven test: final chunk without `cost` → field absent from `ctx.usage`
- [x] 5.6 SSE-driven test: negative cost → field absent

## 6. Spec validation

- [x] 6.1 Run `openspec validate add-upstream-cost-to-usage-payload --strict` and confirm pass
