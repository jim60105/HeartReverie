## Why

A sibling-repo plugin (`HeartReverie_Plugins/prompt-debugger`) — a dev-only tool that captures the final `messages` array sent to the upstream LLM and attributes every `previousContext` mutation to the plugin that performed it — cannot be built against the current core engine. Two facts are missing from the runtime:

1. There is no hook fired between "all `prompt-assembly` handlers have finished" and "`fetch(LLM_API_URL, ...)` is invoked". The closest existing surface is `POST /api/stories/:series/:name/preview-prompt` (`writer/routes/prompt.ts:104`), but it re-runs `buildPromptFromStory()` and therefore re-dispatches `prompt-assembly` — a debugger plugin that listened there would recursively trigger itself, see a fabricated user `message`, and never observe what the live request actually sends.
2. `HookDispatcher` (`writer/lib/hooks.ts`) only exposes a per-dispatch aggregated `DispatchMetric` (via `subscribeSSE`) and a static `introspect()`. It does not expose per-handler before/after context snapshots, so a third-party observer cannot determine which plugin mutated `previousContext[3]`, or whether a plugin called `ctx.previousContext = newArray` (a reassignment that `writer/lib/story.ts:279` silently discards because it filters the *local* variable, not `hookContext.previousContext`).

Adding these two surfaces is a prerequisite for the cross-repo `prompt-debugger` rollout. The same surfaces are reusable by any future observability/telemetry/audit-trail plugin without forcing those plugins to monkey-patch the dispatcher or register sentinel `MIN/MAX_SAFE_INTEGER`-priority handlers.

## What Changes

- Add a new backend hook stage **`pre-llm-fetch`**, dispatched by `streamLlmAndPersist()` in `writer/lib/chat-shared.ts` immediately before the `fetch(config.LLM_API_URL, ...)` call. Context shape: `{ correlationId, messages, model, requestMetadata, storyDir, series, name, writeMode, logger }`. Handlers are read-only with respect to the request; mutations to `context.messages` or `context.requestMetadata` SHALL NOT affect the outgoing HTTP request.
- Extend `HookDispatcher` with a **per-handler event surface**: `subscribeHandlerEvents(cb)` / `unsubscribeHandlerEvents(cb)` emitting `handler-start` and `handler-end` events containing `{ stage, plugin, priority, handlerIndex, correlationId, ctxBeforeSnapshot, ctxAfterSnapshot?, reassigned?, error?, durationMs }`. Subscribers run synchronously, are isolated from dispatch (subscriber throws are caught), and observe but never mutate context.
- Plumb a thin opt-in API onto `PluginHooks` so plugins can subscribe without reaching for the bare dispatcher: `ctx.hooks.onHandlerStart(cb)` and `ctx.hooks.onHandlerEnd(cb)`, returning unsubscribe functions.
- Extend `writer/types.ts` with the new types: `PreLlmFetchPayload`, `HandlerEvent`, `HandlerEventSubscriber`, and add `"pre-llm-fetch"` to `HookStage`, `VALID_STAGES`, and `KNOWN_BACKEND_STAGES`. The stage is **serial-only** (not in `PARALLEL_ALLOWED`).
- Register a manifest `hooks: [{ stage: "pre-llm-fetch", ... }]` entry path through `PluginManager` validation so the `hook-inspector` declare-vs-register cross-check accepts the new stage without manual additions per plugin.
- Document the new surface in `docs/plugin-system.md` (new "Pre-LLM-Fetch hook" and "Per-handler observability events" subsections) and link from `docs/prompt-template.md` where prompt-assembly is described.
- Add Deno test coverage for: dispatch-site invocation, payload immutability vs. outgoing request, per-handler event ordering, snapshot deep-clone behaviour, `reassigned` detection, subscriber error isolation, and parallel-bucket correlation across concurrent chat requests via `correlationId`.

No backward-compatibility section is required: HeartReverie is pre-release with no production deployments, and the new stage is additive (existing plugins that never subscribe to it are unaffected).

## Capabilities

### New Capabilities

- `hook-observability`: Per-handler event surface on `HookDispatcher`, `pre-llm-fetch` hook dispatch site, snapshot semantics, and the opt-in plugin subscription API. Cross-cutting capability consumed by future observability plugins (including the cross-repo `prompt-debugger`).

### Modified Capabilities

- `plugin-hooks`: Adds `pre-llm-fetch` as a registered hook stage with a documented context shape and dispatch-site contract; extends the `PluginHooks` interface with `onHandlerStart` / `onHandlerEnd` subscription methods.

## Impact

- Affected code:
  - `HeartReverie/writer/lib/hooks.ts` — add `pre-llm-fetch` to `VALID_STAGES` / `KNOWN_BACKEND_STAGES`; add per-handler event emission inside `#runSerial` and `#runParallel`; add `subscribeHandlerEvents` / `unsubscribeHandlerEvents`; deep-clone snapshot policy via `structuredClone`.
  - `HeartReverie/writer/lib/chat-shared.ts` — (a) at the entry of `executeChat()` and `executeContinue()`, allocate a single `correlationId = crypto.randomUUID()` per chat request and thread it as an argument into `buildPromptFromStory()` / `buildContinuePromptFromStory()` and into `streamLlmAndPersist()`. (b) replace the existing `crypto.randomUUID()` mint inside `streamLlmAndPersist()` (line ~215) with the inbound argument so the same UUID flows through `prompt-assembly` and into `pre-llm-fetch`. (c) dispatch `pre-llm-fetch` right before the upstream `fetch(...)` call (line ~315) with the propagated `correlationId`. Covers both `executeChat` and `executeContinue` since both funnel through `streamLlmAndPersist`.
  - `HeartReverie/writer/lib/story.ts` — extend `buildPromptFromStory()` and `buildContinuePromptFromStory()` to accept the inbound `correlationId` argument and include it in the `prompt-assembly` hook context (in addition to existing `previousContext`, `rawChapters`, `storyDir`, `series`, `name` fields). Both call sites (lines ~275 and ~374) thread the same UUID.
  - `HeartReverie/writer/lib/plugin-manager.ts` — extend the `PluginHooks` proxy passed in `PluginRegisterContext` to forward `onHandlerStart` / `onHandlerEnd` to the dispatcher with the originating plugin name bound for diagnostics.
  - `HeartReverie/writer/types.ts` — `HookStage` union, `PreLlmFetchPayload`, `HandlerEvent`, `HandlerEventSubscriber`, `PluginHooks` interface extension.
  - `HeartReverie/writer/lib/hook-pipeline-fields.ts` — no change required (the new stage has no mutable pipeline field; `messages`/`requestMetadata` are read-only by contract).
  - Built-in plugin manifests under `HeartReverie/plugins/*/plugin.json` — no edits required (none currently subscribe to `pre-llm-fetch`).
  - Tests: `writer/lib/hooks.test.ts`, `writer/lib/chat-shared.test.ts` (or a new `writer/lib/pre-llm-fetch.test.ts`), `writer/lib/plugin-manager.test.ts`.
  - Docs: `docs/plugin-system.md`, `docs/prompt-template.md` (cross-link).
- Cross-repo dependency: `HeartReverie_Plugins/prompt-debugger` and any future observability plugin depend on this capability. The plugin-side OpenSpec change (`HeartReverie_Plugins/openspec/changes/add-prompt-debugger/`) MUST merge after this change. The plugin runtime detection (`typeof ctx.hooks.onHandlerStart === "function"`) lets the consumer plugin degrade gracefully against an older engine, but the documented "supported" configuration is core-then-plugin.
- No new runtime dependencies. No new HTTP routes. No new persistence. No frontend changes (this is a backend-only capability; the consumer plugin owns its own UI).
- Performance: per-handler event emission adds `structuredClone` of the registered snapshot fields per handler, plus a synchronous fan-out to subscribers. With zero subscribers (the default), the cost is two cheap `Set.size === 0` checks per handler and no clone. Subscribers are documented as opt-in dev tooling — production deployments are expected to leave them unsubscribed.
- Security: per-handler events expose the full `prompt-assembly` `previousContext` and the final `messages` array, both of which may contain user PII and unredacted secrets. The dispatcher SHALL NOT log event payloads to the default logger at any level; subscribers are responsible for their own retention and redaction policies. `docs/plugin-system.md` MUST carry a security note stating "subscribing to handler events captures user content — store with care, never write to stdout/stderr".
