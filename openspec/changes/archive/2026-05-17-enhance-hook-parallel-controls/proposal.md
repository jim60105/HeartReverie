## Why

Two unrelated friction points in the hook dispatcher are tripping up observer-style plugins and making misconfigurations hard to diagnose:

1. **`pre-llm-fetch` is still pinned to serial dispatch**, even though the just-archived `add-hook-observability` change made the stage's `messages` and `requestMetadata` fully immutable (`deepFreeze(structuredClone(...))` in `writer/lib/chat-shared.ts:357-372`). Strict-mode Deno modules already throw on any attempted mutation, so the original justification for forcing serial dispatch — "handlers might fight over the payload" — no longer applies. Observability plugins (`prompt-debugger`, metrics collectors, audit loggers) that all want to capture the outgoing request currently run one after another even though they are provably read-only. The `Track B` auto-promote logic in `writer/lib/hooks.ts:165-168` also rejects `readOnly: true` registrations on `pre-llm-fetch` for the same allowlist reason, defeating the whole point of Track B.
2. **A single plugin declaring `concurrency: 1` silently serialises every other parallel handler in the same bucket.** This is intentional (`effectiveConcurrency = Math.min(...)` at `writer/lib/hooks.ts:788`, "most-restrictive wins") but invisible at registration time. Plugin authors only discover their unrelated metrics plugin has been throttled to one-at-a-time by tracing dispatch timings — there is no warning telling them where the bottleneck came from.

Both fixes are small, contained, and unblock the cross-repo `prompt-debugger` rollout (which wants to register a parallel `pre-llm-fetch` handler).

## What Changes

- Add `"pre-llm-fetch"` to the `PARALLEL_ALLOWED` set in `writer/lib/hooks.ts`. The `readOnly: true` + `parallel: true` contract is unchanged; what changes is that the stage now qualifies for the parallel bucket and for the Track B auto-promote rule that converts `readOnly: true` registrations to `parallel: true` automatically. Per-handler dispatch ordering inside the bucket continues to follow the existing parallel-bucket semantics (`Promise.allSettled` fan-out, optional `concurrency` cap, optional `dependsOn` topo order).
- Document explicitly — both in `docs/plugin-system.md` and in the `plugin-hooks` / `hook-parallel-dispatch` / `hook-observability` specs — that the `pre-llm-fetch` payload is deep-frozen at the call site, so the `readOnly: true` contract is enforced by the runtime rather than relying on plugin discipline. This is the safety invariant that makes parallel dispatch sound.
- In `HookDispatcher.register()`, after a parallel-bucket handler entry is stored, walk the existing handler list for the same stage and emit a single `log.warn` via the plugin's `baseLogger` (falling back to the module-level `log` when no plugin logger is attached) whenever the new registration would cause a `concurrency` mismatch against any existing parallel handler. The trigger covers both (a) **finite-vs-unbounded** — the incoming or pre-existing entry declares `concurrency` while the other omits it — and (b) **finite-vs-higher-finite** — both entries declare `concurrency` but with different values (the lower value will throttle the higher one via `Math.min(...)`). The warning text SHALL include the stage name, the throttling plugin name(s) and their declared concurrency value(s), and the slowed peer plugin name(s) (with their declared value, or `"unbounded"` when the field is omitted) so operators can see exactly which handlers will be slowed. The warning is deduped for the lifetime of the process via a module-scoped `Set<string>` keyed on `${stage}::${registering-plugin}::${concurrency ?? "none"}`, so repeated re-registrations under `auto-reload` cycles stay quiet after the first warning per unique tuple. The dispatcher SHALL also export a `/** @internal */`-marked test-only reset helper that clears the suppression set, so tests can assert dedup behaviour deterministically.
- The warning is **informational only** — dispatch behaviour is unchanged. "Most-restrictive wins" remains the documented and tested rule.
- Test coverage:
  - `tests/writer/lib/hooks_test.ts` (or sibling test files): registering `{ parallel: true, readOnly: true }` on `pre-llm-fetch` is accepted (handler ends up in the parallel bucket); a `readOnly: true` registration with `parallel` unset Track-B-auto-promotes; a parallel handler that mutates the frozen `messages` array throws `TypeError` and the error is absorbed by per-handler error isolation; the engine's outgoing fetch body is byte-identical regardless.
  - A new test (or extension to the existing concurrency tests) registering two `prompt-assembly` plugins — one with `concurrency: 1`, one without — captures the warn log via an injected logger and asserts the message names both plugins and the stage. A mirror case registering the unbounded handler second and the `concurrency: 1` handler first SHALL produce the same warning.

No backward-compatibility section is required: HeartReverie is pre-release with no production users, and neither change alters dispatch output (only widens what is allowed to dispatch in parallel and adds an advisory log).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `plugin-hooks`: The `pre-llm-fetch` stage description loses its "**serial-only**" sentence and gains language stating that parallel dispatch is permitted under the existing `readOnly: true` contract (with runtime enforcement via the deep-freeze invariant). The corresponding "Pre-llm-fetch is serial-only" scenario is removed and replaced with one stating the stage participates in the parallel allowlist under the standard `readOnly: true` rule.
- `hook-parallel-dispatch`: The hard-coded `PARALLEL_ALLOWED` set is extended to include `"pre-llm-fetch"`. A new requirement is added covering the registration-time concurrency-throttle warning (its inputs, the exact log level/message shape, and the no-op effect on dispatch behaviour).
- `hook-observability`: The "Stage is serial-only" scenario under "Pre-LLM-fetch payload is observe-only" is removed and replaced with one stating that the deep-freeze invariant makes parallel dispatch on `pre-llm-fetch` safe — the requirement's main paragraph already establishes the freeze contract, so the change is purely about the parallel-vs-serial language.

## Impact

- Affected code:
  - `HeartReverie/writer/lib/hooks.ts` — add `"pre-llm-fetch"` to `PARALLEL_ALLOWED`; add the throttle-warning helper invoked from `register()` after a parallel-bucket entry is stored.
  - `HeartReverie/writer/lib/chat-shared.ts` — no functional change; the existing `deepFreeze(structuredClone(...))` at lines 357-372 is already the runtime invariant the spec relies on.
  - `HeartReverie/writer/types.ts` — extend `BackendParallelStage` (currently `"prompt-assembly" | "post-response" | "response-stream"`) to also include `"pre-llm-fetch"` so the static parallel-stage union matches the runtime `PARALLEL_ALLOWED` set. The `RegisterOptions` shape itself is unchanged (`parallel`, `readOnly`, and `concurrency` already exist).
- Affected tests:
  - `HeartReverie/tests/writer/lib/hooks_test.ts` — extend with the new acceptance cases for parallel `pre-llm-fetch` and the throttle warning.
  - `HeartReverie/tests/writer/lib/chat_shared_pre_llm_fetch_test.ts` (if present) — extend to cover a parallel-bucket handler that tries to mutate the frozen payload.
- Affected docs:
  - `HeartReverie/docs/plugin-system.md` — update the `pre-llm-fetch` and parallel-dispatch subsections to (a) state that `pre-llm-fetch` is in `PARALLEL_ALLOWED`, (b) reiterate that the payload is deep-frozen, (c) call out the new throttle warning under the parallel-dispatch best-practices section.
- No runtime dependency changes. No HTTP route changes. No frontend changes (this is a backend-only change). No persistence changes.
- Performance: enabling parallel dispatch for `pre-llm-fetch` reduces wall-time when multiple observer plugins are registered (they fan out via `Promise.allSettled`). The throttle warning runs once per `register()` call with cost `O(handlers per stage)` — negligible compared to existing manifest-load work.
- Security: no change. The deep-freeze invariant on the dispatched payload was introduced by the `add-hook-observability` change and remains the canonical defence against handler tampering; this change simply removes the (now-redundant) serial-only belt on top of the existing braces.
