# Spec Delta

## MODIFIED Requirements

### Requirement: Pre-LLM-fetch hook dispatch site

The engine SHALL dispatch a hook stage named `pre-llm-fetch` from `streamLlmAndPersist()` in `writer/lib/chat-shared.ts`, exactly once per generation, immediately before the first upstream transport attempt's `fetch(...)` (whose URL is built from `config.LLM_API_BASE_URL` per the `llm-api-transport` capability). The dispatch SHALL occur AFTER the request body has been fully constructed (so handlers see the final `messages` array and request parameters) and BEFORE any network I/O is initiated. If `hookDispatcher.dispatch` rejects or any registered handler throws, the upstream request SHALL still be issued — error isolation is handled by the existing `HookDispatcher.dispatch` catch-and-log behaviour.

Because both `executeChat()` and `executeContinue()` (and any future caller) funnel through `streamLlmAndPersist()`, this single dispatch site SHALL cover all chat-completion code paths. There is exactly one dispatch site; the hook is not re-dispatched on retry or fallback.

#### Scenario: Dispatch occurs before upstream fetch
- **WHEN** `streamLlmAndPersist()` has built the request body and is about to issue the first upstream transport attempt's `fetch(...)`
- **THEN** the engine SHALL call `hookDispatcher.dispatch("pre-llm-fetch", payload)` and SHALL await the returned promise before issuing the upstream request

#### Scenario: Covers both executeChat and executeContinue
- **WHEN** the user triggers either a chat completion via `executeChat()` or a continue-last-chapter completion via `executeContinue()`
- **THEN** the `pre-llm-fetch` hook SHALL be dispatched exactly once for each call, because both execution paths delegate to `streamLlmAndPersist()` which holds the single dispatch site

#### Scenario: Handler exception does not prevent the fetch
- **WHEN** a `pre-llm-fetch` handler throws an exception
- **THEN** `streamLlmAndPersist()` SHALL continue to the `fetch(...)` call, the upstream request SHALL be issued with the request body byte-identical to the no-handler case, the error SHALL be logged via the existing dispatcher catch-and-log path, and the offending handler entry's `errorCount` SHALL increment by one

#### Scenario: Dispatcher-level rejection does not prevent the fetch
- **WHEN** the awaited `hookDispatcher.dispatch("pre-llm-fetch", payload)` promise itself rejects (e.g., an internal dispatcher bug bubbles past the per-handler catch)
- **THEN** `streamLlmAndPersist()` SHALL catch the rejection, log it once via `log.warn("pre-llm-fetch dispatch failed", { correlationId, error })`, and SHALL still issue the upstream `fetch(...)` with the byte-identical request body

#### Scenario: No handler registered — fetch unchanged
- **WHEN** no plugin has registered a `pre-llm-fetch` handler
- **THEN** the bytes posted upstream SHALL be byte-for-byte identical to the pre-activation behaviour, and dispatch overhead SHALL be limited to the existing `handlers.length === 0` early return in `HookDispatcher.dispatch`

### Requirement: Pre-LLM-fetch payload shape

The `pre-llm-fetch` hook context object dispatched by `streamLlmAndPersist()` SHALL contain the following fields:

- `correlationId` (`string`) — the per-request correlation ID minted at the top of `streamLlmAndPersist()` and shared with all loggers in this chat execution; SHALL be a non-empty string (never `undefined`).
- `messages` (`ChatMessage[]`) — the final message array that will be serialized into the upstream `requestBody.messages`. Type matches the existing `ChatMessage` interface in `writer/types.ts`.
- `model` (`string`) — the resolved model name from `llmConfig.model`.
- `requestMetadata` (`Readonly<Record<string, unknown>>`) — a structured view of the upstream sampler/control knobs that will be sent on the first transport attempt: every key of that attempt's request body except `messages` (Chat Completions) or `input` (Responses). SHALL include at minimum `stream` (boolean) and `model` (string). For Chat Completions it SHALL contain `temperature`, `top_p`, `top_k`, `repetition_penalty`, `frequency_penalty`, `presence_penalty`, `min_p`, `top_a`, optionally `max_completion_tokens`, optionally `reasoning`; for Responses it SHALL contain the keys defined by the `llm-api-transport` Responses request body.
- `transport` (`"responses" | "chat-completions"`) — the transport of the first planned attempt, i.e. the shape of `requestMetadata`.
- `storyDir` (`string`) — absolute path to the story directory.
- `series` (`string`) — the series name under `playground/`.
- `name` (`string`) — the story name under `playground/<series>/`.
- `writeMode` (`{ kind: string }`) — the discriminated-union write-mode tag (`"write-new-chapter"`, `"append-to-existing-chapter"`, `"continue-last-chapter"`, or `"replace-last-chapter"`) so subscribers can distinguish the trigger.
- `logger` — injected by `HookDispatcher` (existing behaviour, identical to all other stages).

A TypeScript interface `PreLlmFetchPayload` SHALL be exported from `writer/types.ts` defining these fields. The interface is for plugin authors and tests; the dispatcher continues to accept the general `Record<string, unknown>` type.

#### Scenario: Payload fields are present and correct
- **WHEN** a `pre-llm-fetch` handler runs during a normal chat request
- **THEN** `context.correlationId`, `context.messages`, `context.model`, `context.requestMetadata`, `context.transport`, `context.storyDir`, `context.series`, `context.name`, and `context.writeMode.kind` SHALL all be defined and SHALL reflect the values that will be used for the first planned upstream transport attempt's `fetch(...)` call

#### Scenario: TypeScript type is exported
- **WHEN** a plugin module imports `PreLlmFetchPayload` from `writer/types.ts`
- **THEN** the import SHALL succeed and the interface SHALL include the fields listed above

#### Scenario: correlationId is non-empty
- **WHEN** any `pre-llm-fetch` dispatch occurs
- **THEN** `context.correlationId` SHALL be a non-empty string (the UUID minted on entry to `streamLlmAndPersist()`)

#### Scenario: Responses-first payload mirrors the Responses body
- **GIVEN** `LLM_API_MODE` is `auto` with the default `LLM_API_BASE_URL`, an empty fallback cache, and a `write-new-chapter` generation
- **WHEN** a `pre-llm-fetch` handler runs
- **THEN** `context.transport` SHALL be `"responses"`, `context.requestMetadata` SHALL contain `store: false` and SHALL NOT contain `input` or `messages`, and the hook SHALL be dispatched exactly once even if the generation falls back to Chat Completions

### Requirement: Pre-LLM-fetch payload is observe-only

Handlers for `pre-llm-fetch` MAY read any field of the context object for observation, telemetry, audit, or capture. Handlers SHALL NOT influence the outgoing upstream request — mutating `context.messages`, `context.model`, `context.requestMetadata`, or any other field SHALL NOT change the bytes posted upstream. The dispatcher SHALL document this contract by typing `messages` and `requestMetadata` as `Readonly` in the exported `PreLlmFetchPayload` interface; runtime enforcement is provided by deep-cloning AND deeply freezing **only** `messages` and `requestMetadata` (via `deepFreeze(structuredClone(...))`) before they are placed onto the dispatched payload, so any handler attempt to mutate either the top-level array/object or any nested object SHALL throw a `TypeError` under strict mode (Deno ESM modules are strict by default).

The outer context object itself SHALL NOT be deep-frozen, and the remaining top-level fields (`model`, `writeMode`, `correlationId`, `storyDir`, `series`, `name`) SHALL NOT be frozen either. Handlers MAY reassign those fields on their local view of the context, but doing so is purely observational: (a) the engine uses the locally-built `requestBody` (not the dispatched context) for the actual fetch, so reassignment SHALL NOT change the bytes posted upstream, and (b) the dispatcher provides NO peer-isolation guarantee for those non-frozen fields when handlers run in parallel — handlers MUST treat the entire stage as observe-only and MUST NOT depend on peer handlers leaving any field untouched.

Because the deep-freeze invariant makes the `readOnly: true` contract runtime-enforced rather than convention-only, the `pre-llm-fetch` stage is **parallel-eligible** under the standard `PARALLEL_ALLOWED` + `readOnly: true` rules defined in the `hook-parallel-dispatch` capability. A plugin MAY register `{ parallel: true, readOnly: true }` (or `{ readOnly: true }` and rely on Track B auto-promote) on `pre-llm-fetch`, and the dispatcher SHALL place such handlers in the parallel bucket so they fan out concurrently via `Promise.allSettled`. The "observe-only" guarantee SHALL remain intact in either bucket: parallel handlers see the same deep-frozen `messages` and `requestMetadata`, so concurrent execution cannot produce a different outgoing request than serial execution.

#### Scenario: Handler mutation does not alter the request
- **WHEN** a `pre-llm-fetch` handler executes `context.messages = []` or `context.messages.push({ role: "system", content: "rogue" })`
- **THEN** the bytes posted upstream SHALL be byte-for-byte identical to the no-handler case for that request

#### Scenario: Nested mutation throws under strict mode
- **WHEN** a `pre-llm-fetch` handler executes `context.messages[0].content = "tampered"` or `context.requestMetadata.temperature = 9.9` (nested-property reassignment of a deeply-frozen object)
- **THEN** the assignment SHALL throw a `TypeError` (Deno ESM strict mode) and the bytes posted upstream SHALL remain byte-for-byte identical to the no-handler case. The thrown error SHALL be absorbed by the existing per-handler `try/catch` and SHALL NOT prevent the fetch.

#### Scenario: Stage is parallel-eligible under readOnly contract
- **WHEN** a plugin manifest declares `hooks: [{ stage: "pre-llm-fetch", parallel: true, readOnly: true }]` or a plugin calls `hooks.register("pre-llm-fetch", h, { parallel: true, readOnly: true })`
- **THEN** the dispatcher SHALL register the handler in the parallel bucket (it SHALL NOT coerce `parallel: true` to `false`), and at the next dispatch the handler SHALL be invoked concurrently with other parallel `pre-llm-fetch` handlers
- **AND** the deep-freeze invariant on `messages` and `requestMetadata` SHALL apply equally to parallel handlers — any nested mutation attempt from a parallel handler SHALL throw `TypeError`

#### Scenario: Parallel handler mutation does not affect peer handlers
- **WHEN** two parallel `pre-llm-fetch` handlers are dispatched concurrently and one of them attempts `context.messages.push(...)`
- **THEN** the pushing handler's call SHALL throw `TypeError` (due to the deep-freeze)
- **AND** the second handler SHALL observe the unchanged frozen `messages` array
- **AND** the bytes posted upstream SHALL remain byte-for-byte identical to the no-handler case
