# Implementation Tasks

## 1. Types (`writer/types.ts`)

- [x] 1.1 Add `"pre-llm-fetch"` to the `HookStage` union type.
- [x] 1.2 Define and export `interface PreLlmFetchPayload` with fields `correlationId: string`, `messages: ChatMessage[]`, `model: string`, `requestMetadata: Readonly<Record<string, unknown>>`, `storyDir: string`, `series: string`, `name: string`, `writeMode: { kind: string }`.
- [x] 1.3 Define and export `type HandlerEvent` as a discriminated union (`kind: "handler-start" | "handler-end"`) with the fields specified in `specs/hook-observability/spec.md` (common: `stage`, `plugin?`, `priority`, `handlerIndex`, `correlationId?`, `timestamp`; start-only: `ctxBeforeSnapshot`, `ctxBeforeRefs`; end-only: `ctxAfterSnapshot`, `ctxAfterRefs`, `reassigned`, `error?`, `durationMs`).
- [x] 1.4 Extend the `PluginHooks` interface with optional `onHandlerStart?(cb): () => void` and `onHandlerEnd?(cb): () => void`.

## 2. HookDispatcher (`writer/lib/hooks.ts`)

- [x] 2.1 Add `"pre-llm-fetch"` to `KNOWN_BACKEND_STAGES` and `VALID_STAGES`; leave it OUT of `PARALLEL_ALLOWED` (serial-only).
- [x] 2.2 Add a `#handlerEventSubscribers: Set<(ev: HandlerEvent) => void>` field and a per-subscriber consecutive-throw counter (e.g., `WeakMap<Function, number>`).
- [x] 2.3 Implement public methods `subscribeHandlerEvents(cb)` and `unsubscribeHandlerEvents(cb)` that mutate the set synchronously.
- [x] 2.4 Define a private `#emitHandlerEvent(event: HandlerEvent)` helper that iterates the subscriber set, wraps each invocation in `try/catch`, increments the throw counter on error, removes the subscriber and logs a rate-limited (max once per stage per 60 s) `warn` after two consecutive throws, and resets the counter on a clean invocation.
- [x] 2.5 Define a private snapshot allowlist map: `prompt-assembly → ["previousContext", "rawChapters"]`, `pre-llm-fetch → ["messages", "model", "requestMetadata"]`, other stages → `[]`.
- [x] 2.6 In `#runSerial` and `#runParallel`, before invoking each handler: if `#handlerEventSubscribers.size === 0` skip all snapshot work; otherwise build `ctxBeforeRefs` by reading each allowlist field's *current live reference* from `context` (raw, no clone) into a flat `Record<string, unknown>`, THEN build `ctxBeforeSnapshot` by `structuredClone`-ing the same fields (snapshot is built AFTER refs are captured), record `performance.now()`, and call `#emitHandlerEvent({ kind: "handler-start", ... })`.
- [x] 2.7 After each handler returns or throws: if subscribers exist, re-read each allowlist field's live reference from `context` into `ctxAfterRefs` BEFORE running `structuredClone` for `ctxAfterSnapshot`, compute `reassigned` by comparing `ctxAfterRefs[k] !== ctxBeforeRefs[k]` (strict, identity-based; sorted output) — the comparison MUST be against the live `ctxBeforeRefs`/`ctxAfterRefs`, NOT against the cloned snapshots — then build `ctxAfterSnapshot` via `structuredClone`, attach `error: { message, name }` on throw (no stack), compute `durationMs`, and emit the `handler-end` event. The handler's existing error-handling path SHALL remain unchanged otherwise.
- [x] 2.8 Verify the early-return `if (handlers.length === 0)` already at the top of `dispatch()` is preserved so the no-handler-no-subscriber path is allocation-free.

## 3. Dispatch site + correlationId threading (`writer/lib/chat-shared.ts`, `writer/lib/story.ts`)

- [x] 3.1 At the entry of `executeChat()` and `executeContinue()` in `writer/lib/chat-shared.ts`, allocate exactly one `const correlationId = crypto.randomUUID()` per chat request.
- [x] 3.2 Extend the signatures of `buildPromptFromStory()` and `buildContinuePromptFromStory()` in `writer/lib/story.ts` to accept the inbound `correlationId: string` argument; thread it into the `prompt-assembly` hook context object (alongside existing `previousContext`, `rawChapters`, `storyDir`, `series`, `name`) at both dispatch sites (lines ~275 and ~374).
- [x] 3.3 Pass the same `correlationId` from `executeChat()` / `executeContinue()` into `streamLlmAndPersist()` (add it as an argument); inside `streamLlmAndPersist()`, replace the existing `const correlationId = crypto.randomUUID()` mint (line ~215) with the inbound argument so the same UUID flows from `prompt-assembly` through `pre-llm-fetch` and onward into `response-stream` / `post-response`.
- [x] 3.4 Inside `streamLlmAndPersist()`, after `requestBody` is fully built and before `const response = await fetch(config.LLM_API_URL, ...)`, build a `PreLlmFetchPayload` (`correlationId`, `messages: requestBody.messages`, `model: llmConfig.model`, `requestMetadata: { ...requestBody, stream: true }` minus `messages`, plus `storyDir`, `series`, `name`, `writeMode`).
- [x] 3.5 Await `hookDispatcher.dispatch("pre-llm-fetch", payload)`. The dispatcher's existing per-handler catch will swallow handler errors; do NOT wrap in extra `try/catch` (preserve any dispatcher-level surfaced errors). The new dispatch site SHALL NOT add any `log.*` call that includes `messages` or `requestMetadata` — only the aggregated dispatch-debug line the dispatcher already emits is permitted.
- [x] 3.6 Confirm via inspection that `executeContinue()` (and any other caller) reaches `streamLlmAndPersist()`, so a single dispatch site covers all chat code paths.

## 4. Plugin-facing API wiring (`writer/lib/plugin-manager.ts`)

- [x] 4.1 In the per-plugin `PluginHooks` proxy returned to plugin `register(ctx)` callbacks, attach `onHandlerStart` and `onHandlerEnd` methods that wrap `hookDispatcher.subscribeHandlerEvents`, filter the inbound event by `event.kind`, and return an unsubscribe closure that calls `hookDispatcher.unsubscribeHandlerEvents` and is idempotent (use a captured `unsubscribed` flag).
- [x] 4.2 Ensure that when a plugin is hot-reloaded or unloaded, every subscribe-handler-event registration created via that plugin's proxy is cleaned up (call all captured unsubscribes during teardown).
- [x] 4.3 Validate the manifest path: when a manifest declares a `pre-llm-fetch` handler with `parallel: true`, log a warning and force `parallel: false` (or reject the registration — pick one and document in the docs update).

## 5. Backend unit tests (`writer/lib/hooks.test.ts`)

- [x] 5.1 Add a test that `subscribeHandlerEvents`/`unsubscribeHandlerEvents` are no-ops when no handlers fire.
- [x] 5.2 Add a test that one registered serial handler produces exactly one `handler-start` followed by one `handler-end` event with matching `handlerIndex`, monotonically increasing `timestamp`, and `durationMs >= 0`.
- [x] 5.3 Add a test that reassigning a snapshot-allowlist field (`context.previousContext = ["x"]`) produces `reassigned: ["previousContext"]` in the `handler-end` event. Assert this is driven by pre-clone live-ref comparison (not by clone identity) by verifying the same test still passes when `structuredClone` is left untouched.
- [x] 5.4 Add a test that in-place mutation (`context.previousContext.push("x")`) produces `reassigned: []` AND that `ctxAfterSnapshot.previousContext` deep-differs from `ctxBeforeSnapshot.previousContext`. Assert both branches in the same test to lock in the contrast.
- [x] 5.5 Add a test that a non-allowlisted stage (`post-response`) still emits `handler-start`/`handler-end` events with empty snapshots and `reassigned: []`.
- [x] 5.6 Add a test that a throwing handler produces `handler-end.error.message` and the dispatcher's existing error path still runs.
- [x] 5.7 Add a test that a throwing subscriber callback is auto-unsubscribed after two consecutive throws and that the dispatch result is unaffected.
- [x] 5.8 Add a test confirming that with zero subscribers there are zero `structuredClone` calls (use a `globalThis.structuredClone` spy or count via a Proxy).
- [x] 5.9 Add a test that two handlers from the same plugin at different priorities receive distinct `handlerIndex` values.

## 6. Integration tests for `pre-llm-fetch` (`writer/lib/chat-shared.test.ts` or new test file)

- [x] 6.1 Stub the upstream `fetch` and run `streamLlmAndPersist()`; assert exactly one `pre-llm-fetch` dispatch with the expected payload shape (`correlationId` non-empty, `messages` matches the built array, `model` and `requestMetadata` match `requestBody`, `writeMode.kind` reflects the call).
- [x] 6.2 Add a test where a `pre-llm-fetch` handler mutates `context.messages`/`context.requestMetadata`; assert the actual `fetch` body bytes are unchanged.
- [x] 6.3 Add a test where a `pre-llm-fetch` handler throws; assert the upstream `fetch` is still invoked and the handler's error is logged via the existing dispatcher path.
- [x] 6.4 Add a test covering `executeContinue()` reaching the same dispatch site.
- [x] 6.5 Add a test that captures the `correlationId` seen by a `prompt-assembly` handler and the `correlationId` seen by the `pre-llm-fetch` handler within the same `executeChat()` invocation and asserts they are strictly equal — i.e. one UUID per chat request flows across both stages.
- [x] 6.6 Add a test asserting that the new `pre-llm-fetch` dispatch code (and the new `HandlerEvent` fan-out path in the dispatcher) does NOT introduce any `log.*` call containing `messages`, `requestMetadata`, `ctxBeforeSnapshot`, or `ctxAfterSnapshot` — e.g. by spying on `log.info`/`log.debug`/`log.warn`/`log.error` and asserting none of the captured argument trees contain those keys.

## 7. Documentation (`HeartReverie/docs/plugin-system.md`, `HeartReverie/docs/prompt-template.md`)

- [x] 7.1 In `docs/plugin-system.md`, add a "Pre-LLM-fetch stage" subsection documenting the dispatch site, context shape, serial-only constraint, and observation-only contract. Include a minimal handler example.
- [x] 7.2 In `docs/plugin-system.md`, add a "Handler-event subscription" subsection documenting `ctx.hooks.onHandlerStart` / `ctx.hooks.onHandlerEnd`, the `HandlerEvent` shape, snapshot allowlist semantics, `reassigned` detection, and the zero-subscriber zero-cost guarantee. Include a worked example showing reassignment detection.
- [x] 7.3 In `docs/prompt-template.md`, cross-link to the new "Pre-LLM-fetch stage" subsection from the section that explains where the rendered messages get sent.

## 8. Validation

- [x] 8.1 Run `cd HeartReverie && deno task test` (or the equivalent existing Deno test command) and confirm all new tests pass alongside the existing suite.
- [x] 8.2 Run `cd HeartReverie && openspec validate add-hook-observability --strict` and resolve any reported issues.
- [x] 8.3 Run `scripts/podman-build-run.sh` and exercise a chat completion end-to-end to confirm no startup warnings, no behavioural regression, and that a sample subscriber receives events as expected.

## 9. Hardening fixes (post-review)

- [x] 9.1 **BLOCKING-1**: `pre-llm-fetch` payload — replace shallow `[...messages]` / `Object.freeze({...requestMetadata})` with `deepFreeze(structuredClone(...))` in `writer/lib/chat-shared.ts` so handlers cannot mutate nested objects through shared references. Add a `deepFreeze` helper local to `chat-shared.ts`.
- [x] 9.2 **QUALITY-5**: `HookDispatcher.#cloneAllowlistSnapshot` — wrap each allowlist field's `structuredClone` in its own `try/catch`; on failure store the sentinel `{ __snapshotError: <message> }` for that field so a single non-cloneable value cannot abort the whole snapshot or the dispatch.
- [x] 9.3 **QUALITY-6**: `pre-llm-fetch` dispatch — wrap `await hookDispatcher.dispatch("pre-llm-fetch", payload)` in `try/catch`; log `log.warn("pre-llm-fetch dispatch failed", { correlationId, error })` and proceed with the fetch so a dispatcher-level rejection cannot block the LLM call.
- [x] 9.4 **QUALITY-8**: Observer subscription introspection — add `HandlerEventSubscriptionOptions { plugin?: string; kind?: "handler-start" | "handler-end" }` to `writer/types.ts`. Extend `HookDispatcher.subscribeHandlerEvents(cb, opts?)` to record per-subscriber metadata, add `getHandlerEventSubscribers(): Record<string, Array<"handler-start" | "handler-end">>` (plugin → sorted, deduped kinds; untagged subscribers grouped under `"<anonymous>"`). Tag `onHandlerStart`/`onHandlerEnd` subscriptions in `plugin-manager.ts` with `{ plugin: name, kind }`. Surface the map as `observerSubscribers` in `GET /api/_debug/hooks` and `/api/plugin-introspection/hooks`.
- [x] 9.5 **NIT-13**: Clarify in `specs/hook-observability/spec.md` and `docs/plugin-system.md` that `correlationId` is emitted at the **top level** of every `HandlerEvent` (next to `stage`, `plugin`, `timestamp`) and is NOT nested inside `ctxBeforeSnapshot` / `ctxAfterSnapshot`.
- [x] 9.6 Add coverage: `tests/writer/lib/hooks_test.ts` (QUALITY-5 non-cloneable sentinel; QUALITY-8 `getHandlerEventSubscribers`), `tests/writer/lib/chat_shared_pre_llm_fetch_test.ts` (BLOCKING-1 deep-frozen payload; QUALITY-6 dispatcher rejection absorbed), and new `tests/writer/lib/hooks_observer_subscribers_test.ts` (plugin-manager tagging surfaces through `getHandlerEventSubscribers` and `buildIntrospectionDump`).
