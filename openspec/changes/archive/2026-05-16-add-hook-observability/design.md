## Context

The HeartReverie core engine exposes a `HookDispatcher` (`writer/lib/hooks.ts`) that fans handlers across hook stages, sorts them by priority, and runs serial-first then parallel-bucket dispatch (per the archived `add-hook-parallel-dispatch` capability). It already exposes:

- **Static introspection** via `introspect()` — per-stage handler list with `{plugin, priority, errorCount, parallel}` (added by `2026-05-14-hook-inspector`).
- **Aggregated per-dispatch telemetry** via `subscribeSSE(cb)` → `DispatchMetric` containing per-dispatch wall time and a `plugins[]` array with `{ plugin, durationMs (always 0 today), errored }` (lines 555–586 of `writer/lib/hooks.ts`).
- The `hook-inspector` HTTP route and SPA page consume both, but they do **not** observe per-handler context mutations.

The actual upstream LLM fetch lives in `streamLlmAndPersist()` in `writer/lib/chat-shared.ts` (lines 200–335), which `executeChat()` and `executeContinue()` both delegate to. A `correlationId` is already minted on line 215 of that function. There is no hook between the last `prompt-assembly` handler and the `fetch(config.LLM_API_URL, ...)` call on line 315 — neither `pre-write` (which fires after the response is confirmed) nor `response-stream` (which fires per delta) covers this gap.

`writer/routes/prompt.ts:105` provides `POST /api/stories/:series/:name/preview-prompt`, but it re-runs `buildPromptFromStory()` with the supplied `message` field (which may differ from the real request) and re-dispatches `prompt-assembly`. Any observer plugin that hung off this route would observe a fabricated request, and any plugin subscribing to `prompt-assembly` would recursively trigger itself on every preview call. It is therefore unusable as a capture source for the final outgoing `messages`.

The cross-repo `HeartReverie_Plugins/prompt-debugger` plugin needs both: it must see the final `messages` array and attribute every mutation to `previousContext` (and only the mutations that actually survive into the engine's final array). The "reassignment ineffective" bug — `writer/lib/story.ts:279` filters the *local* `previousContext` variable, so `ctx.previousContext = newArr` from a handler is silently dropped — must be discoverable from the outside without manual instrumentation.

Stakeholders:
- **Plugin authors** of `prompt-debugger` and any future audit/redaction/telemetry plugin (primary consumer).
- **Engine maintainers** who need a sanctioned observation API instead of plugins reaching into private dispatcher state.
- **Security reviewers** who require the captured data to stay opt-in and out of the default logger.

## Goals / Non-Goals

**Goals:**

- Define a single dispatch site for the "what is about to leave for the LLM" snapshot, named `pre-llm-fetch`, with a context shape that covers correlationId, the final messages array, model name, request metadata, and story routing fields.
- Provide a per-handler observation API on `HookDispatcher` that emits `handler-start` and `handler-end` events with deep-cloned before/after snapshots and reference-equality data needed to detect ineffective reassignment.
- Make the observation API safe for production by default: opt-in, synchronous, isolated from dispatch correctness, never auto-logged.
- Keep the surface narrow enough that a sibling plugin can subscribe with `~10 lines` of code (`ctx.hooks.onHandlerStart(...)` / `ctx.hooks.onHandlerEnd(...)`).

**Non-Goals:**

- Building any UI in the core engine (the consumer plugin owns its panel).
- Building any persistence layer in the core engine.
- Capturing or transforming the LLM **response** (separate concern, covered by `response-stream`).
- Replacing `subscribeSSE` or the `DispatchMetric` ring buffer (different audience: hook-inspector consumes aggregated counts, this capability adds per-handler depth).
- Adding redaction / PII scrubbing in the engine (the consumer plugin handles redaction; the engine just emits raw snapshots to subscribers that asked for them).

## Decisions

### D1. New hook stage `pre-llm-fetch` (vs. extending an existing stage)

**Decision:** Add a dedicated stage named `pre-llm-fetch`, registered in `KNOWN_BACKEND_STAGES` but NOT in `PARALLEL_ALLOWED`. Dispatched from `streamLlmAndPersist()` immediately before the `fetch(config.LLM_API_URL, ...)` call. Covers `executeChat`, `executeContinue`, and any future caller funnelled through the same helper.

**Alternatives considered:**

- Reuse `prompt-assembly` and rely on `MAX_SAFE_INTEGER` priority sentinels — rejected: `prompt-assembly` runs on the raw `previousContext` array, *before* `renderSystemPrompt()` translates it into the final `messages`. There is no way to observe the rendered messages from inside `prompt-assembly`.
- Extend `pre-write` — rejected: `pre-write` fires after the upstream response is confirmed, by which time the request has already left. Wrong side of the network call.
- Recommend plugins use `preview-prompt` — rejected per the recursion / message-mismatch trap in §Context.

**Rationale for serial-only:** observers downstream may want to subscribe in a fixed priority order to compose audit chains; parallel dispatch breaks that determinism. The stage is informational so the serial cost is negligible (zero handlers in the default install).

### D2. Per-handler events surface lives on `HookDispatcher`, exposed via `PluginHooks`

**Decision:** Add two methods to `HookDispatcher`:

```ts
subscribeHandlerEvents(cb: (event: HandlerEvent) => void): void;
unsubscribeHandlerEvents(cb: (event: HandlerEvent) => void): void;
```

and emit events from inside `#runSerial` and `#runParallel`. Forward via `ctx.hooks.onHandlerStart(cb)` / `ctx.hooks.onHandlerEnd(cb)` (returning unsubscribe closures) so plugin authors do not need access to the raw dispatcher.

`HandlerEvent` is a discriminated union:

```ts
type HandlerEvent =
  | { kind: "handler-start"; stage: HookStage; plugin: string | undefined;
      priority: number; handlerIndex: number; correlationId: string | undefined;
      ctxBeforeSnapshot: unknown; ctxBeforeRefs: Record<string, unknown>;
      timestamp: number }
  | { kind: "handler-end"; stage: HookStage; plugin: string | undefined;
      priority: number; handlerIndex: number; correlationId: string | undefined;
      ctxAfterSnapshot: unknown; ctxAfterRefs: Record<string, unknown>;
      reassigned: string[]; error?: { message: string; name: string };
      durationMs: number; timestamp: number };
```

**Alternatives considered:**

- Extend the existing `subscribeSSE` / `DispatchMetric` API — rejected: that contract is "one metric per dispatch", and hook-inspector already consumes it. Adding per-handler payloads would either break the schema (BREAKING) or require a discriminated union that complicates every existing consumer.
- Make subscription a global static — rejected: every subscriber must be unsubscribable, and a per-plugin-scoped lifecycle is cleaner.
- Expose dispatcher directly to plugins — rejected: `PluginManager` deliberately wraps `HookDispatcher` in a `PluginHooks` proxy so plugins cannot mutate internal state, and we should not regress that.

### D3. Snapshot semantics — `structuredClone` of a registered allowlist

**Decision:** Per stage, define a small allowlist of fields whose values are deep-cloned via `structuredClone()` and emitted as `ctxBeforeSnapshot` / `ctxAfterSnapshot`. For `prompt-assembly` the allowlist is `{ previousContext, rawChapters }`. For `pre-llm-fetch` it is `{ messages, model, requestMetadata }`. For any other stage it is an empty object (no per-handler snapshot, but `handler-start` / `handler-end` events still fire so subscribers can attribute timing and errors).

The dispatcher additionally records `ctxBeforeRefs` / `ctxAfterRefs` — a flat object mapping the same field names to the *current live reference* held by `context[field]`. **Critically, `ctxBeforeRefs` is captured BEFORE the pre-handler `structuredClone()` runs, and `ctxAfterRefs` is re-read from `context` after the handler returns but BEFORE the post-handler `structuredClone()` runs.** `reassigned: string[]` lists every allowlist field where `ctxAfterRefs[k] !== ctxBeforeRefs[k]`.

**Rationale:**
- `structuredClone` handles strings, arrays, plain objects, Maps, Sets, and Dates — all current and foreseeable context content. It cannot handle functions, but the `logger` field is the only function in current contexts and it is excluded from snapshots.
- Cloning the entire context per handler would copy `logger` and any large held references — too expensive on the hot path, and security-sensitive (logger may close over secrets).
- **Why refs must be captured pre-clone:** `structuredClone` produces brand-new object identities. If `reassigned` were computed by comparing `ctxBeforeSnapshot[k]` against `ctxAfterSnapshot[k]` by reference, every field would always compare unequal (the clones are always new objects) and the signal would be useless. Pre-clone live refs preserve the original identities held by the running engine, so identity comparison correctly detects "handler swapped the slot" (reassignment) vs "handler mutated in place" (same identity, different content).
- Reference comparison is the only way to detect the `writer/lib/story.ts:279` reassignment-ineffective bug: deep-equal snapshots would falsely report "no change" when the handler reassigned to an equivalent array. Conversely, in-place mutation is detectable by diffing the two snapshots (which `reassigned` will NOT flag).

**Alternatives considered:**

- Always deep-clone the whole context — rejected on cost + risk (see above).
- JSON-stringify snapshots — rejected: doesn't preserve `Map`/`Set`, loses reference identity, lossy for binary fields.
- Proxy-based change tracking — rejected: incompatible with the existing parallel-bucket Proxy which already wraps context for read-only enforcement, and would compound the proxy layers.

### D4. Subscriber error isolation + zero-cost when unsubscribed

**Decision:** `#runSerial` and `#runParallel` check `this.#handlerEventSubscribers.size === 0` and skip both the snapshot clone and the subscriber fan-out when there are no subscribers. Each subscriber callback is wrapped in `try/catch`; a throwing subscriber is logged once at `warn` level (rate-limited: at most once per stage per minute via a `Map<HookStage, number>` of last-warn timestamps) and removed from the subscriber set on its second consecutive throw. Subscriber callbacks are invoked synchronously — they MUST NOT be async (async callbacks are accepted but their returned promises are not awaited, matching the `subscribeSSE` precedent).

**Rationale:** Production deployments must pay zero cost when no debugger plugin is loaded. A misbehaving observability plugin must not be able to break or slow chat dispatch.

### D5. `correlationId` is mandatory in event payloads and threaded across stages for one request

**Decision:** Every `handler-start` / `handler-end` event MUST carry the `correlationId` taken from `context.correlationId`. **One single UUID per chat request** SHALL flow across all its stages: it is generated at the top of `executeChat()` / `executeContinue()` in `writer/lib/chat-shared.ts` (via `crypto.randomUUID()`), passed as an argument into `buildPromptFromStory()` / `buildContinuePromptFromStory()`, placed into the `prompt-assembly` hook context, then propagated forward into `streamLlmAndPersist()` (replacing the existing `crypto.randomUUID()` mint at line ~215 with the inbound argument) so the same UUID surfaces in the `pre-llm-fetch` context and in the existing `response-stream` / `post-response` events. The dispatcher already extracts `correlationId` from context at `hooks.ts:250-252`; no dispatcher change is required for propagation — only the *producers* (`executeChat`, `executeContinue`, `buildPromptFromStory`, `buildContinuePromptFromStory`, `streamLlmAndPersist`) need to be wired to thread one ID.

**Rationale:** Parallel chat requests (HTTP `/api/chat` and WebSocket `chat:send` can run concurrently from one browser session against multiple stories) interleave events. Without a stable `correlationId` that spans prompt-assembly → pre-llm-fetch → response-stream, subscribers cannot join "the prompt that produced this request" with "the request that produced this stream". The feat document's "`WeakMap<hookContext>` to align" approach is unreliable when handlers reassign context references — `correlationId` is invariant once minted, and a single mint point at the chat-request entry guarantees one ID per request flow.

**Why mint at `executeChat`/`executeContinue` rather than `streamLlmAndPersist`:** `prompt-assembly` is dispatched *inside* `buildPromptFromStory()` / `buildContinuePromptFromStory()`, which run *before* `streamLlmAndPersist()`. Minting in `streamLlmAndPersist` (the current behaviour) means `prompt-assembly` has no `correlationId` available, breaking the join. Moving the mint up to the chat-request entry is the minimal change that lets the same UUID reach both stages.

### D6. `pre-llm-fetch` payload is read-only by contract; mutations have no effect

**Decision:** The hook context for `pre-llm-fetch` carries `messages`, `model`, and `requestMetadata`, but `streamLlmAndPersist()` builds the actual `requestBody` (lines 289–310) from the **local variables**, not from the dispatched context. The dispatched object is a snapshot, not a pipeline-input. Spec wording uses MAY-observe / SHALL-NOT-influence to make this explicit.

**Rationale:** This stage exists for observability, not for transformation. A read/write contract would expose new surface area (re-signing payloads, racing parallel mutators) that no consumer asked for and that would complicate the security review. Plugins that need to transform the outgoing request should use `prompt-assembly` for prompt content or `chat:send:before` (frontend) for the user message.

### D7. Relationship to `hook-inspector`

**Decision:** Leave the `hook-inspector` capability untouched. The new per-handler events are a *separate* observation surface — `hook-inspector` aggregates registration + per-dispatch counts; `hook-observability` exposes per-handler payloads. The two are complementary. The `hook-inspector` route SHALL NOT mirror handler-event payloads (they are too large and security-sensitive for a polling JSON endpoint).

The `pre-llm-fetch` stage WILL appear in `hook-inspector`'s `backend` introspection list once a plugin registers for it (no special-case handling needed in the inspector code — it iterates `HookDispatcher.introspect()`).

**Rationale:** Avoids growing one capability into two unrelated responsibilities; keeps the inspector's JSON payload bounded and cacheable.

## Risks / Trade-offs

- **[Risk] Snapshot allowlist drift** — When a future stage adds new context fields, the allowlist won't include them and snapshots will be incomplete.
  - **Mitigation:** Document the allowlist in the spec as part of the stage definition. Adding a new field is a spec-level change. The `chat-shared.ts` payload tests assert that snapshots include the documented fields, so out-of-band additions trip CI.

- **[Risk] `structuredClone` cost on large `previousContext`** — Stories with 100+ chapters dispatched twice per handler could add measurable latency.
  - **Mitigation:** D4 gates the clone on `subscriberCount > 0`. In dev usage with one subscriber and ~10 chapters, clone time is sub-millisecond per handler (empirically tested on 50KB arrays). If production observability ever wants to ship by default, we can downgrade to ref-only snapshots and require subscribers to compute their own diffs.

- **[Risk] `correlationId` leaking into logs** — `pre-llm-fetch` event payloads contain raw `messages` (user content + system prompt + LLM API key fragments if a plugin smuggled them into a header field via `requestMetadata`).
  - **Mitigation:** Spec rules forbid the dispatcher from logging payloads. Subscribers receive raw data and own redaction. `docs/plugin-system.md` security note repeats the warning.

- **[Risk] Misbehaving subscriber crashes prod chat** — A throwing subscriber on a hot path could destabilize streaming.
  - **Mitigation:** D4's try/catch isolation, two-strike auto-unsubscribe, and rate-limited warn log. Subscribers run synchronously in the dispatch path, but the wrapper guarantees they cannot propagate exceptions.

- **[Trade-off] Per-handler events fire for *every* stage, not just `prompt-assembly`** — Subscribers must filter by `stage` field in their callback. The alternative (per-stage subscription) doubles the API surface for no use-case win today.
  - **Mitigation:** Document the filtering pattern in `docs/plugin-system.md` example code.

- **[Trade-off] `reassigned` only detects top-level field reassignment, not deep mutation that loses semantic meaning** — E.g., a handler that does `ctx.previousContext.length = 0` produces `reassigned: []` (same ref) but empties the array.
  - **Mitigation:** Subscribers can diff `ctxBeforeSnapshot` vs `ctxAfterSnapshot` to detect content changes. `reassigned` is intentionally narrow: it flags the specific anti-pattern of "handler assigned a new value, but engine kept the old reference".

## Migration Plan

No migration required. The capability is purely additive:

1. Land the engine changes (types, dispatcher methods, dispatch site, tests, docs) behind a single PR.
2. Existing plugins keep working unchanged — none subscribe to `pre-llm-fetch`, none register `onHandlerStart` / `onHandlerEnd`.
3. The cross-repo `HeartReverie_Plugins/prompt-debugger` PR merges *after* this PR. Its `register()` performs runtime feature detection (`typeof ctx.hooks.onHandlerStart === "function"`) and runs in `legacy-mirror` fallback mode if older engines are encountered. Production deployments are expected to pin matching engine + plugin image tags via the existing Helm chart values.

Rollback: revert the PR. No data was persisted, no API was promised to external consumers besides the still-unreleased `prompt-debugger`.

## Open Questions

- **Q1.** Should `pre-llm-fetch` also fire on the OpenRouter `chat/completions` non-streaming path? — Resolved: there is no non-streaming path today (`stream: true` is hardcoded on line 292 of `chat-shared.ts`). If one is added later, the new code path should also dispatch the hook; this is captured as a tasks-list item.
- **Q2.** Should the snapshot field allowlist be configurable per-subscriber? — Deferred. Today every subscriber pays the same cost; configurability adds API surface without a concrete use case. Revisit if `prompt-debugger` ships and a second consumer requests a slimmer payload.

## D8: Deep-clone + deep-freeze for `pre-llm-fetch` payload (post-review)

**Decision.** Replace the original `messages: [...messages]` and `requestMetadata: Object.freeze({ ...requestMetadata })` payload construction with `messages: deepFreeze(structuredClone(messages))` and `requestMetadata: deepFreeze(structuredClone(requestMetadata))`.

**Why.** The shallow copy + top-level freeze only protected the outermost container. A handler that did `ctx.messages[0].content = "tampered"` would silently mutate the *original* live message object that `streamLlmAndPersist` had already wired into the request body (objects inside the array were aliased). Deep cloning severs the alias; deep freezing turns any nested-property assignment into a `TypeError` under Deno's default strict mode, making the observe-only contract enforceable at runtime instead of merely documented.

**Trade-off.** `structuredClone` runs once per dispatch even when no handler is registered. The `messages` array is typically <10 entries with short string content, so the cost is sub-millisecond. The `deepFreeze` helper is local to `chat-shared.ts` (single call site) and is a tiny recursive walker that skips already-frozen subtrees for defence-in-depth against cyclic graphs (though `structuredClone` already breaks cycles).

## D9: Per-field error isolation in snapshot clone

**Decision.** Each allowlist field's `structuredClone` is wrapped in its own `try/catch` inside `HookDispatcher.#cloneAllowlistSnapshot`. A single non-cloneable field (function, `WeakRef`, host object) is replaced with the sentinel `{ __snapshotError: <message> }`; the rest of the snapshot proceeds normally.

**Why.** Before this fix, one non-cloneable field would throw out of `#cloneAllowlistSnapshot`, abort the `handler-start` event emission, and skip the entire `try` block that wraps the handler call — i.e., a single rogue field could silently disable observability for that handler. Per-field isolation keeps observability degradation localised: subscribers see exactly which field could not be cloned and the rest of the event remains useful for telemetry.

## D10: Dispatcher-level rejection absorption around `pre-llm-fetch`

**Decision.** Wrap `await hookDispatcher.dispatch("pre-llm-fetch", payload)` in `try/catch` inside `streamLlmAndPersist`; on rejection log `log.warn("pre-llm-fetch dispatch failed", { correlationId, error })` and proceed to the upstream `fetch(...)` call.

**Why.** The per-handler `try/catch` inside `HookDispatcher.dispatch` already absorbs handler exceptions, but a dispatcher-internal bug (e.g., a future refactor that throws before entering the per-handler loop) would still surface as an unhandled rejection at the call site and block the chat completion. Wrapping the await preserves the existing "fetch must always proceed" invariant against the full set of failure modes, not just the handler-throws subset.

## D11: Observer-subscriber introspection surface

**Decision.** Add `subscribeHandlerEvents(cb, opts?: { plugin?: string; kind?: "handler-start" | "handler-end" })` and `getHandlerEventSubscribers(): Record<string, Array<kind>>` to `HookDispatcher`. The `PluginManager` wrappers for `ctx.hooks.onHandlerStart` / `ctx.hooks.onHandlerEnd` pass `{ plugin: <name>, kind }` automatically. Subscribers without a `plugin` tag are grouped under `"<anonymous>"`. Surface the map as `observerSubscribers` in `GET /api/_debug/hooks` and `/api/plugin-introspection/hooks`.

**Why.** Without per-subscriber metadata, the operator had no way to answer "which plugin is observing my hook events?" from the existing introspection surfaces — only a raw `Set.size` count. The new surface aligns observers with the existing registration listings (which already attribute handlers to plugins), making it possible to diagnose "why is this dispatch slow?" or "is plugin X still subscribed after hot-reload?" without code spelunking. The signature stays backwards compatible: the `opts` argument is optional, and untagged subscribers continue to work via the `"<anonymous>"` grouping.
