# hook-observability Specification

## Purpose
TBD - created by archiving change add-hook-observability. Update Purpose after archive.
## Requirements
### Requirement: Pre-LLM-fetch hook dispatch site

The engine SHALL dispatch a hook stage named `pre-llm-fetch` from `streamLlmAndPersist()` in `writer/lib/chat-shared.ts`, exactly once per upstream LLM request, immediately before the `fetch(config.LLM_API_URL, ...)` call. The dispatch SHALL occur AFTER the request body has been fully constructed (so handlers see the final `messages` array and request parameters) and BEFORE any network I/O is initiated. If `hookDispatcher.dispatch` rejects or any registered handler throws, the upstream request SHALL still be issued — error isolation is handled by the existing `HookDispatcher.dispatch` catch-and-log behaviour.

Because both `executeChat()` and `executeContinue()` (and any future caller) funnel through `streamLlmAndPersist()`, this single dispatch site SHALL cover all chat-completion code paths. There is exactly one dispatch site; the hook is not re-dispatched on retry or fallback.

#### Scenario: Dispatch occurs before upstream fetch
- **WHEN** `streamLlmAndPersist()` has built the request body and is about to call `fetch(config.LLM_API_URL, ...)`
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
- **THEN** the bytes posted to `config.LLM_API_URL` SHALL be byte-for-byte identical to the pre-activation behaviour, and dispatch overhead SHALL be limited to the existing `handlers.length === 0` early return in `HookDispatcher.dispatch`

### Requirement: Pre-LLM-fetch payload shape

The `pre-llm-fetch` hook context object dispatched by `streamLlmAndPersist()` SHALL contain the following fields:

- `correlationId` (`string`) — the per-request correlation ID minted at the top of `streamLlmAndPersist()` and shared with all loggers in this chat execution; SHALL be a non-empty string (never `undefined`).
- `messages` (`ChatMessage[]`) — the final message array that will be serialized into the upstream `requestBody.messages`. Type matches the existing `ChatMessage` interface in `writer/types.ts`.
- `model` (`string`) — the resolved model name from `llmConfig.model`.
- `requestMetadata` (`Readonly<Record<string, unknown>>`) — a structured view of the upstream sampler/control knobs that will be sent. SHALL include at minimum `stream` (boolean), `model` (string), and the same keys present in `requestBody` (`temperature`, `top_p`, `top_k`, `repetition_penalty`, `frequency_penalty`, `presence_penalty`, `min_p`, `top_a`, optionally `max_completion_tokens`, optionally `reasoning`).
- `storyDir` (`string`) — absolute path to the story directory.
- `series` (`string`) — the series name under `playground/`.
- `name` (`string`) — the story name under `playground/<series>/`.
- `writeMode` (`{ kind: string }`) — the discriminated-union write-mode tag (`"write-new-chapter"`, `"append-to-existing-chapter"`, `"continue-last-chapter"`, or `"replace-last-chapter"`) so subscribers can distinguish the trigger.
- `logger` — injected by `HookDispatcher` (existing behaviour, identical to all other stages).

A TypeScript interface `PreLlmFetchPayload` SHALL be exported from `writer/types.ts` defining these fields. The interface is for plugin authors and tests; the dispatcher continues to accept the general `Record<string, unknown>` type.

#### Scenario: Payload fields are present and correct
- **WHEN** a `pre-llm-fetch` handler runs during a normal chat request
- **THEN** `context.correlationId`, `context.messages`, `context.model`, `context.requestMetadata`, `context.storyDir`, `context.series`, `context.name`, and `context.writeMode.kind` SHALL all be defined and SHALL reflect the values that will be used for the upstream `fetch(...)` call

#### Scenario: TypeScript type is exported
- **WHEN** a plugin module imports `PreLlmFetchPayload` from `writer/types.ts`
- **THEN** the import SHALL succeed and the interface SHALL include the fields listed above

#### Scenario: correlationId is non-empty
- **WHEN** any `pre-llm-fetch` dispatch occurs
- **THEN** `context.correlationId` SHALL be a non-empty string (the UUID minted on entry to `streamLlmAndPersist()`)

### Requirement: Pre-LLM-fetch payload is observe-only

Handlers for `pre-llm-fetch` MAY read any field of the context object for observation, telemetry, audit, or capture. Handlers SHALL NOT influence the outgoing upstream request — mutating `context.messages`, `context.model`, `context.requestMetadata`, or any other field SHALL NOT change the bytes posted to `config.LLM_API_URL`. The dispatcher SHALL document this contract by typing `messages` and `requestMetadata` as `Readonly` in the exported `PreLlmFetchPayload` interface; runtime enforcement is provided by deep-cloning AND deeply freezing `messages` and `requestMetadata` (via `deepFreeze(structuredClone(...))`) before they are placed onto the dispatched payload, so any handler attempt to mutate either the top-level array/object or any nested object SHALL throw a `TypeError` under strict mode (Deno ESM modules are strict by default).

#### Scenario: Handler mutation does not alter the request
- **WHEN** a `pre-llm-fetch` handler executes `context.messages = []` or `context.messages.push({ role: "system", content: "rogue" })`
- **THEN** the bytes posted to `config.LLM_API_URL` SHALL be byte-for-byte identical to the no-handler case for that request

#### Scenario: Nested mutation throws under strict mode
- **WHEN** a `pre-llm-fetch` handler executes `context.messages[0].content = "tampered"` or `context.requestMetadata.temperature = 9.9` (nested-property reassignment of a deeply-frozen object)
- **THEN** the assignment SHALL throw a `TypeError` (Deno ESM strict mode) and the bytes posted to `config.LLM_API_URL` SHALL remain byte-for-byte identical to the no-handler case. The thrown error SHALL be absorbed by the existing per-handler `try/catch` and SHALL NOT prevent the fetch.

#### Scenario: Stage is serial-only
- **WHEN** a plugin manifest declares `{ stage: "pre-llm-fetch", parallel: true }` or a plugin calls `hooks.register("pre-llm-fetch", h, { parallel: true })`
- **THEN** the dispatcher SHALL either ignore the `parallel: true` flag (treating the handler as serial) or reject the registration with a logged error; the runtime SHALL never invoke a `pre-llm-fetch` handler from the parallel bucket

### Requirement: HookDispatcher per-handler event subscription API

The backend `HookDispatcher` SHALL expose two public methods for subscribing to per-handler events:

- `subscribeHandlerEvents(cb: (event: HandlerEvent) => void): void`
- `unsubscribeHandlerEvents(cb: (event: HandlerEvent) => void): void`

`subscribeHandlerEvents` SHALL register the callback in an internal `Set`. `unsubscribeHandlerEvents` SHALL remove it. Both SHALL be synchronous, side-effect-free with respect to dispatch state, and SHALL NOT perform any I/O. The dispatcher SHALL emit exactly two events per registered handler invocation: a `handler-start` event before the handler runs and a `handler-end` event after the handler returns (or throws). The dispatcher SHALL invoke every registered callback for every event, in subscription order, synchronously, with each callback wrapped in `try/catch` so that a throwing subscriber does not affect dispatch correctness or other subscribers.

When `subscribeHandlerEvents` has zero registered callbacks, the dispatcher SHALL skip both the snapshot construction (Requirement: HandlerEvent payload shape and snapshot semantics) and the subscriber fan-out. This SHALL be a runtime check on `subscribers.size === 0`, not a compile-time toggle.

A subscriber callback that throws SHALL be logged once at `warn` level (subject to rate-limiting at most once per stage per 60 seconds), and SHALL be removed from the subscriber set after two consecutive throws on consecutive events.

#### Scenario: Subscribe receives both start and end events
- **WHEN** a caller invokes `subscribeHandlerEvents(cb)` then triggers a hook dispatch with one registered handler
- **THEN** `cb` SHALL be invoked exactly twice, first with `event.kind === "handler-start"` and second with `event.kind === "handler-end"`, in that order

#### Scenario: Unsubscribe stops events
- **WHEN** a caller invokes `subscribeHandlerEvents(cb)`, then `unsubscribeHandlerEvents(cb)`, then triggers a dispatch
- **THEN** `cb` SHALL NOT be invoked for that dispatch

#### Scenario: Zero subscribers means zero snapshot cost
- **WHEN** `subscribeHandlerEvents` has never been called (or all subscribers have unsubscribed) and a hook dispatch occurs
- **THEN** the dispatcher SHALL NOT invoke `structuredClone` on any context field and SHALL NOT allocate `HandlerEvent` objects

#### Scenario: Subscriber error does not break dispatch
- **WHEN** a subscriber callback throws
- **THEN** the dispatcher SHALL log the error once at `warn` level, the hook handler SHALL still run to completion, the remaining subscribers SHALL still be invoked for the same event, and the overall `dispatch()` return value SHALL be unaffected

#### Scenario: Two consecutive subscriber throws auto-unsubscribe
- **WHEN** the same subscriber callback throws on two consecutive event invocations
- **THEN** the dispatcher SHALL remove that callback from the subscriber set after the second throw and SHALL NOT invoke it again

### Requirement: HandlerEvent payload shape and snapshot semantics

Each `HandlerEvent` emitted by the per-handler subscription API SHALL be a plain object (no class instances) carrying the fields below. A TypeScript discriminated-union type `HandlerEvent` SHALL be exported from `writer/types.ts`.

**Common fields (both kinds):**
- `kind: "handler-start" | "handler-end"`
- `stage: HookStage`
- `plugin: string | undefined` — handler's owning plugin name; `undefined` when registered without a plugin name (rare; only the test harness does this).
- `priority: number`
- `handlerIndex: number` — 0-based position in the dispatcher's per-stage handler array, allowing subscribers to demux duplicate registrations.
- `correlationId: string | undefined` — taken from `context.correlationId` (the dispatcher already extracts this on line ~251). `undefined` is acceptable for stages whose context does not carry one. **This field SHALL be carried at the top level of the `HandlerEvent` object (alongside `stage`, `plugin`, `timestamp`); it SHALL NOT be nested inside `ctxBeforeSnapshot` or `ctxAfterSnapshot`. Subscribers SHALL read `event.correlationId`, never `event.ctxBeforeSnapshot.correlationId`.**
- `timestamp: number` — `performance.now()` at event emission.

**`handler-start` additional fields:**
- `ctxBeforeSnapshot: unknown` — deep clone (via `structuredClone`) of the snapshot allowlist subset of context fields for this stage. The allowlist per stage:
  - `prompt-assembly`: `{ previousContext, rawChapters }`
  - `pre-llm-fetch`: `{ messages, model, requestMetadata }`
  - any other stage: `{}` (empty object, no fields snapshotted)

  The clone SHALL be performed field-by-field with each `structuredClone` call wrapped in its own `try/catch`. When a single allowlist field is not cloneable (e.g., contains a function, a `WeakRef`, or a host object), that field's slot in the snapshot SHALL be replaced with the sentinel object `{ __snapshotError: <error message string> }` and the rest of the snapshot SHALL still be produced. A single non-cloneable field SHALL NOT abort the snapshot, the event emission, or the dispatch.
- `ctxBeforeRefs: Record<string, unknown>` — flat object whose keys are the same allowlist field names and whose values are the *current live references* held by `context[field]` **captured BEFORE `structuredClone` runs**. These are raw references into the dispatcher's live context, not clones. They are retained internally by the dispatcher solely to compute `reassigned` in the matching `handler-end` event. Subscribers SHALL treat `ctxBeforeRefs` as opaque and SHALL NOT mutate the referenced objects (use `ctxBeforeSnapshot` for safe inspection).

**`handler-end` additional fields:**
- `ctxAfterSnapshot: unknown` — deep clone of the same allowlist after handler completion. Even on handler error, the post-throw context state SHALL be snapshotted (this captures partial mutations).
- `ctxAfterRefs: Record<string, unknown>` — live references re-read from `context[field]` after the handler returns (and BEFORE the post-handler `structuredClone` for `ctxAfterSnapshot` runs).
- `reassigned: string[]` — sorted list of allowlist field names where `ctxAfterRefs[k] !== ctxBeforeRefs[k]` (strict reference inequality between the pre-clone live refs). Empty array when no reassignment occurred. This SHALL be the engine's authoritative signal that a handler reassigned a top-level context field. The comparison MUST be performed against the live `ctxBeforeRefs` / `ctxAfterRefs` captured around the handler call; it MUST NOT be performed against `ctxBeforeSnapshot` / `ctxAfterSnapshot` because `structuredClone` produces fresh object identities and would make every field appear "reassigned".
- `error: { message: string; name: string } | undefined` — present when the handler threw; absent otherwise. The dispatcher SHALL NOT include stack traces in this field (subscribers receive raw messages only; full stacks remain in dispatcher logs).
- `durationMs: number` — `performance.now()` delta between `handler-start` and `handler-end`.

The dispatcher SHALL preserve insertion order of subscribers when fanning out events. `structuredClone` SHALL be invoked exactly once per event per snapshot (not per subscriber).

#### Scenario: prompt-assembly start event snapshots previousContext
- **WHEN** a `prompt-assembly` handler is invoked and `subscribeHandlerEvents(cb)` is active
- **THEN** the `handler-start` event SHALL include `ctxBeforeSnapshot.previousContext` deep-equal to the current `context.previousContext` array, and modifying the original array AFTER the event fires SHALL NOT change the snapshot

#### Scenario: Reassignment detection uses pre-clone live refs
- **GIVEN** the dispatcher captured `ctxBeforeRefs.previousContext = <live ref to array A>` before invoking the handler (and before any clone)
- **WHEN** a `prompt-assembly` handler executes `context.previousContext = ["new"]` (reassignment of the slot to a new array B)
- **THEN** the dispatcher re-reads `ctxAfterRefs.previousContext = <live ref to array B>`, observes `ctxAfterRefs.previousContext !== ctxBeforeRefs.previousContext`, and the corresponding `handler-end` event SHALL include `reassigned: ["previousContext"]`

#### Scenario: In-place mutation does not trigger reassigned
- **GIVEN** the dispatcher captured `ctxBeforeRefs.previousContext = <live ref to array A>` before invoking the handler
- **WHEN** a `prompt-assembly` handler executes `context.previousContext[0] = "modified"` or `context.previousContext.push("new")` (in-place mutation of array A; the slot is never reassigned)
- **THEN** `ctxAfterRefs.previousContext` SHALL still strictly equal `ctxBeforeRefs.previousContext` (same array A), the corresponding `handler-end` event SHALL include `reassigned: []`, but `ctxAfterSnapshot.previousContext` SHALL deep-differ from `ctxBeforeSnapshot.previousContext` so subscribers can detect the content change via diff
- **AND** comparing `ctxBeforeSnapshot.previousContext` against `ctxAfterSnapshot.previousContext` by reference is meaningless (they are independent clones); subscribers MUST use `reassigned` as the authoritative reassignment signal

#### Scenario: Handler error attaches error field
- **WHEN** a registered handler throws an exception `new Error("boom")`
- **THEN** the corresponding `handler-end` event SHALL include `error: { message: "boom", name: "Error" }` and `error.message` SHALL NOT contain a stack trace

#### Scenario: handlerIndex demuxes multiple handlers from the same plugin
- **WHEN** plugin X registers two `prompt-assembly` handlers at priorities 50 and 150
- **THEN** the events emitted for each handler SHALL have distinct `handlerIndex` values (0 and 1, sorted by dispatch order) so subscribers can attribute events to the correct handler entry

#### Scenario: correlationId propagates from context
- **WHEN** `pre-llm-fetch` is dispatched with `context.correlationId === "abc-123"`
- **THEN** both the `handler-start` and `handler-end` events for every `pre-llm-fetch` handler invocation under that dispatch SHALL carry `correlationId: "abc-123"`

#### Scenario: Snapshot allowlist for unrecognized stage is empty
- **WHEN** events fire for a handler on stage `post-response` (not in the snapshot allowlist)
- **THEN** `ctxBeforeSnapshot` and `ctxAfterSnapshot` SHALL each equal `{}`, `reassigned` SHALL be `[]`, but the event SHALL still fire with valid `stage`, `plugin`, `priority`, `handlerIndex`, `correlationId`, and `durationMs` fields

### Requirement: Per-handler events fire for serial and parallel buckets

The per-handler event API SHALL emit events for handlers in both the serial bucket and the parallel bucket. The dispatch order of events MAY interleave when the parallel bucket has more than one handler (because parallel handlers run concurrently via `Promise.allSettled`), but for any single handler the `handler-start` event SHALL strictly precede that handler's `handler-end` event.

For parallel-bucket handlers, the dispatcher snapshots `ctxBeforeRefs` from the Proxy-wrapped view of context. Because parallel handlers are read-only by contract, `reassigned` SHALL almost always be `[]`; any non-empty `reassigned` from a parallel handler indicates a contract violation that should already have been logged by the existing `HOOK_DEBUG` warning path.

#### Scenario: Serial handlers emit ordered events
- **WHEN** three serial handlers are registered for `prompt-assembly` at priorities 50, 100, 200
- **THEN** the dispatcher SHALL emit events in the order `start(50), end(50), start(100), end(100), start(200), end(200)`

#### Scenario: Parallel handlers may interleave but pair correctly
- **WHEN** two parallel handlers are registered for `response-stream` and a chunk dispatch occurs
- **THEN** each handler's `handler-end` SHALL be preceded by its own `handler-start` (the two pairs may interleave in any order, but pair ordering is preserved)

### Requirement: Plugin-facing subscription API

The `PluginHooks` interface (exposed to plugins via `PluginRegisterContext.hooks`) SHALL include two optional methods:

- `onHandlerStart?(cb: (event: HandlerEvent & { kind: "handler-start" }) => void): () => void`
- `onHandlerEnd?(cb: (event: HandlerEvent & { kind: "handler-end" }) => void): () => void`

When invoked, each method SHALL forward to `HookDispatcher.subscribeHandlerEvents`, filtering the callback to only the relevant `event.kind`. Each method SHALL return an `unsubscribe` function that, when called, removes the underlying subscription. The methods are optional (typed `?`) so plugin code can feature-detect with `typeof ctx.hooks.onHandlerStart === "function"`; the engine SHALL always provide them when the new capability is active.

The originating plugin name SHALL NOT be automatically bound onto the subscriber callback's view of events — subscribers receive raw `HandlerEvent` objects carrying the *target* handler's `plugin` field (which is the plugin whose handler was invoked, not the plugin that subscribed).

#### Scenario: Plugin subscribes via PluginHooks
- **WHEN** a plugin's `register(ctx)` calls `const off = ctx.hooks.onHandlerStart!((ev) => { /* ... */ })` and then triggers a dispatch
- **THEN** the callback SHALL be invoked once per `handler-start` event for every stage

#### Scenario: Unsubscribe function works
- **WHEN** a plugin calls `const off = ctx.hooks.onHandlerStart!(cb)` then `off()` and triggers a dispatch
- **THEN** `cb` SHALL NOT be invoked

#### Scenario: Feature detection
- **WHEN** a plugin checks `typeof ctx.hooks.onHandlerStart === "function"` against an engine that has shipped this capability
- **THEN** the check SHALL evaluate to `true`

### Requirement: New observability surfaces SHALL NOT introduce logging of payloads

This requirement scopes only to the **new surfaces added by this change**: the new `pre-llm-fetch` dispatch site and the new per-handler event emission code. It does NOT regulate pre-existing log statements (e.g., the existing `llmLog.info("LLM request", { ..., messages, ... })` in `writer/lib/chat-shared.ts` that already logs request bodies — that statement is out of scope for this change and SHALL NOT be considered a violation).

Specifically:

1. **New `pre-llm-fetch` dispatch site:** the code added by this change to dispatch `pre-llm-fetch` SHALL NOT introduce any new `log.*` call that includes `context.messages`, `context.requestMetadata`, or any other field from the `pre-llm-fetch` snapshot allowlist. Only an aggregated debug line (handler count + latency, matching existing dispatch debug logs) MAY be emitted.

2. **New per-handler event emission code:** the dispatcher's new `subscribeHandlerEvents` fan-out path SHALL NOT mirror any `HandlerEvent` payload (specifically `ctxBeforeSnapshot`, `ctxAfterSnapshot`, `ctxBeforeRefs`, `ctxAfterRefs`, `error`) to `log.info`, `log.debug`, `log.warn`, or `log.error`. Existing dispatch-level aggregated logs (e.g., `log.debug("Hook dispatch completed", ...)`) SHALL continue to emit only their pre-existing aggregated fields (`stage`, counts, `latencyMs`) and SHALL NOT be extended to include snapshot data.

Subscribers are responsible for their own retention and redaction; the new engine surface is observe-only.

#### Scenario: New pre-llm-fetch dispatch site does not log payloads
- **WHEN** the new `pre-llm-fetch` dispatch is added to `streamLlmAndPersist`
- **THEN** no new `log.info`/`log.debug`/`log.warn`/`log.error` call referencing `messages`, `requestMetadata`, or the dispatched context SHALL be introduced by this change (pre-existing `llmLog.info("LLM request", ...)` is unrelated to this change and remains untouched)

#### Scenario: Dispatcher does not auto-log HandlerEvent payloads
- **WHEN** a plugin subscribes via `ctx.hooks.onHandlerStart` / `onHandlerEnd` and dispatches occur
- **THEN** the dispatcher SHALL fan events out to the subscriber callback only, SHALL NOT emit any `log.*` entry containing `ctxBeforeSnapshot`, `ctxAfterSnapshot`, `ctxBeforeRefs`, `ctxAfterRefs`, or `error.message` from the event, and SHALL NOT raise the verbosity of any existing aggregated log statement

### Requirement: Non-cloneable snapshot fields use sentinel
Each allowlist field in `ctxBeforeSnapshot` / `ctxAfterSnapshot` SHALL be cloned independently. If `structuredClone` throws for a single field (for instance the field holds a function, a `WeakRef`, or a non-cloneable host object), that field's slot SHALL be set to `{ __snapshotError: <message> }` where `<message>` is the thrown error's `message` (or `String(err)` fallback). All other allowlist fields SHALL still be cloned normally and the `handler-start` / `handler-end` event SHALL still be emitted. The dispatch SHALL NOT throw.

#### Scenario: One field non-cloneable, others succeed
- **GIVEN** a `prompt-assembly` handler runs with `context.previousContext = [{ note: "ok" }]` and `context.rawChapters = () => "function"` (a non-cloneable function)
- **WHEN** a subscriber is active and the dispatcher snapshots before invoking the handler
- **THEN** `ctxBeforeSnapshot.previousContext` SHALL be a normal deep clone of the array, `ctxBeforeSnapshot.rawChapters` SHALL be `{ __snapshotError: <message> }`, and the handler SHALL still execute to completion

### Requirement: Observer-subscriber introspection surface
The dispatcher SHALL expose `subscribeHandlerEvents(cb, opts?: { plugin?: string; kind?: "handler-start" | "handler-end" })`. The optional `plugin` and `kind` metadata SHALL be stored per subscriber and SHALL be exposed via a new public method `getHandlerEventSubscribers(): Record<string, Array<"handler-start" | "handler-end">>` whose keys are plugin names (subscribers registered without a `plugin` tag SHALL be grouped under the key `"<anonymous>"`) and whose values are deduped, alphabetically-sorted arrays of the kinds that plugin subscribes to. When a subscriber omits `kind`, both `"handler-start"` and `"handler-end"` SHALL be reported for that subscriber. The `PluginManager`'s wrappers for `ctx.hooks.onHandlerStart` and `ctx.hooks.onHandlerEnd` SHALL tag each underlying subscription with `{ plugin: <loaded plugin name>, kind: "handler-start" | "handler-end" }`.

The result of `getHandlerEventSubscribers()` SHALL be surfaced as the `observerSubscribers` field of the JSON payload returned by `GET /api/_debug/hooks` and by the `buildIntrospectionDump` helper that backs `/api/plugin-introspection/hooks`.

#### Scenario: Plugin name and kind appear in introspection
- **GIVEN** a plugin named `watcher` whose `register()` calls both `ctx.hooks.onHandlerStart!(fn)` and `ctx.hooks.onHandlerEnd!(fn)`
- **WHEN** the operator queries `GET /api/_debug/hooks` or invokes `dispatcher.getHandlerEventSubscribers()`
- **THEN** the response payload SHALL include `observerSubscribers["watcher"]` deep-equal to `["handler-end", "handler-start"]`

#### Scenario: Anonymous subscribers grouped under "<anonymous>"
- **GIVEN** a test harness calls `dispatcher.subscribeHandlerEvents(cb)` without an `opts` argument
- **WHEN** `dispatcher.getHandlerEventSubscribers()` is invoked
- **THEN** the returned record SHALL include the key `"<anonymous>"` with value `["handler-end", "handler-start"]`

