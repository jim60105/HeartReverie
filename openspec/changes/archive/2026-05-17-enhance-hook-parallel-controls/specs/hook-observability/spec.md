## MODIFIED Requirements

### Requirement: Pre-LLM-fetch payload is observe-only

Handlers for `pre-llm-fetch` MAY read any field of the context object for observation, telemetry, audit, or capture. Handlers SHALL NOT influence the outgoing upstream request — mutating `context.messages`, `context.model`, `context.requestMetadata`, or any other field SHALL NOT change the bytes posted to `config.LLM_API_URL`. The dispatcher SHALL document this contract by typing `messages` and `requestMetadata` as `Readonly` in the exported `PreLlmFetchPayload` interface; runtime enforcement is provided by deep-cloning AND deeply freezing **only** `messages` and `requestMetadata` (via `deepFreeze(structuredClone(...))`) before they are placed onto the dispatched payload, so any handler attempt to mutate either the top-level array/object or any nested object SHALL throw a `TypeError` under strict mode (Deno ESM modules are strict by default).

The outer context object itself SHALL NOT be deep-frozen, and the remaining top-level fields (`model`, `writeMode`, `correlationId`, `storyDir`, `series`, `name`) SHALL NOT be frozen either. Handlers MAY reassign those fields on their local view of the context, but doing so is purely observational: (a) the engine uses the locally-built `requestBody` (not the dispatched context) for the actual fetch, so reassignment SHALL NOT change the bytes posted to `config.LLM_API_URL`, and (b) the dispatcher provides NO peer-isolation guarantee for those non-frozen fields when handlers run in parallel — handlers MUST treat the entire stage as observe-only and MUST NOT depend on peer handlers leaving any field untouched.

Because the deep-freeze invariant makes the `readOnly: true` contract runtime-enforced rather than convention-only, the `pre-llm-fetch` stage is **parallel-eligible** under the standard `PARALLEL_ALLOWED` + `readOnly: true` rules defined in the `hook-parallel-dispatch` capability. A plugin MAY register `{ parallel: true, readOnly: true }` (or `{ readOnly: true }` and rely on Track B auto-promote) on `pre-llm-fetch`, and the dispatcher SHALL place such handlers in the parallel bucket so they fan out concurrently via `Promise.allSettled`. The "observe-only" guarantee SHALL remain intact in either bucket: parallel handlers see the same deep-frozen `messages` and `requestMetadata`, so concurrent execution cannot produce a different outgoing request than serial execution.

#### Scenario: Handler mutation does not alter the request
- **WHEN** a `pre-llm-fetch` handler executes `context.messages = []` or `context.messages.push({ role: "system", content: "rogue" })`
- **THEN** the bytes posted to `config.LLM_API_URL` SHALL be byte-for-byte identical to the no-handler case for that request

#### Scenario: Nested mutation throws under strict mode
- **WHEN** a `pre-llm-fetch` handler executes `context.messages[0].content = "tampered"` or `context.requestMetadata.temperature = 9.9` (nested-property reassignment of a deeply-frozen object)
- **THEN** the assignment SHALL throw a `TypeError` (Deno ESM strict mode) and the bytes posted to `config.LLM_API_URL` SHALL remain byte-for-byte identical to the no-handler case. The thrown error SHALL be absorbed by the existing per-handler `try/catch` and SHALL NOT prevent the fetch.

#### Scenario: Stage is parallel-eligible under readOnly contract
- **WHEN** a plugin manifest declares `hooks: [{ stage: "pre-llm-fetch", parallel: true, readOnly: true }]` or a plugin calls `hooks.register("pre-llm-fetch", h, { parallel: true, readOnly: true })`
- **THEN** the dispatcher SHALL register the handler in the parallel bucket (it SHALL NOT coerce `parallel: true` to `false`), and at the next dispatch the handler SHALL be invoked concurrently with other parallel `pre-llm-fetch` handlers
- **AND** the deep-freeze invariant on `messages` and `requestMetadata` SHALL apply equally to parallel handlers — any nested mutation attempt from a parallel handler SHALL throw `TypeError`

#### Scenario: Parallel handler mutation does not affect peer handlers
- **WHEN** two parallel `pre-llm-fetch` handlers are dispatched concurrently and one of them attempts `context.messages.push(...)`
- **THEN** the pushing handler's call SHALL throw `TypeError` (due to the deep-freeze)
- **AND** the second handler SHALL observe the unchanged frozen `messages` array
- **AND** the bytes posted to `config.LLM_API_URL` SHALL remain byte-for-byte identical to the no-handler case
