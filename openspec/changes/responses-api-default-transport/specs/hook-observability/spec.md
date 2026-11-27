# Spec Delta

## MODIFIED Requirements

### Requirement: Pre-LLM-fetch hook dispatch site

The engine SHALL dispatch a hook stage named `pre-llm-fetch` from `streamLlmAndPersist()` in `writer/lib/chat-shared.ts`, exactly once per generation, immediately before the first upstream transport attempt's `fetch(...)` (whose URL is derived from `config.LLM_API_URL` per the `llm-api-transport` capability). The dispatch SHALL occur AFTER the request body has been fully constructed (so handlers see the final `messages` array and request parameters) and BEFORE any network I/O is initiated. If `hookDispatcher.dispatch` rejects or any registered handler throws, the upstream request SHALL still be issued — error isolation is handled by the existing `HookDispatcher.dispatch` catch-and-log behaviour.

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
- **GIVEN** `LLM_API_MODE` is `auto` with the default `LLM_API_URL` and an empty fallback cache
- **WHEN** a `pre-llm-fetch` handler runs
- **THEN** `context.transport` SHALL be `"responses"`, `context.requestMetadata` SHALL contain `store: false` and SHALL NOT contain `input` or `messages`, and the hook SHALL be dispatched exactly once even if the generation falls back to Chat Completions
