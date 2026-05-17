## Context

The hook dispatcher (`writer/lib/hooks.ts`) ships a two-bucket dispatch algorithm (serial-first, then parallel) with three opt-in safety knobs: a `PARALLEL_ALLOWED` allowlist, a `readOnly: true` contract for parallel entries, and a per-handler `concurrency` cap. The just-archived `add-hook-observability` change added a new `pre-llm-fetch` dispatch site and — critically — codified that the dispatched `messages` and `requestMetadata` are deep-cloned and **deep-frozen** (`deepFreeze(structuredClone(...))`) at `writer/lib/chat-shared.ts:357-372` so handlers cannot tamper with the outgoing request even by accident.

That freeze invariant fundamentally changes the safety analysis for parallel `pre-llm-fetch` dispatch: any handler that violates the read-only contract throws a `TypeError` rather than silently corrupting the payload observed by peer handlers. The original "serial-only" decision (recorded in the `plugin-hooks` spec, the `hook-observability` spec, and the absence of `pre-llm-fetch` from `PARALLEL_ALLOWED`) was made before the freeze was in place. With the freeze, the conservative belt is now redundant.

Separately, the `Math.min(...declaredConcurrencies)` rule for effective parallel-bucket concurrency (`writer/lib/hooks.ts:788`) is intentional ("most-restrictive wins") and has been observed in production to silently slow unrelated observer plugins when a single plugin declares `concurrency: 1`. There is no operator-visible signal at registration time — only a wall-time delta that requires hook-inspector spelunking to attribute. A cheap one-shot warn log at `register()` time would have caught the last two reports without changing dispatch behaviour.

This change bundles those two surgical updates. Neither is large in isolation; bundling reduces churn on the hook capability specs.

## Goals / Non-Goals

**Goals:**
- Allow plugins to register `{ parallel: true, readOnly: true }` on `pre-llm-fetch` without manifest rejection, and route them through the existing parallel bucket machinery (`Promise.allSettled`, layer chunking, `dependsOn` DAG, error isolation).
- Honour the existing Track B "default-on" rule on `pre-llm-fetch`: `{ readOnly: true }` with no explicit `parallel` SHALL auto-promote.
- Make the "most-restrictive concurrency wins" rule visible at registration time via a single advisory `log.warn` per offending register call, so plugin authors stop being surprised when an unrelated plugin throttles their bucket.
- Keep behaviour identical for already-correct setups (no warning, no extra dispatch overhead, no change in `Promise.allSettled` semantics).

**Non-Goals:**
- Not changing the `Math.min(...)` cap rule (operators may still want one plugin to throttle the bucket; the warning is an aid, not a policy change).
- Not introducing a per-plugin "max-concurrency" override or a manifest-level "do not coerce me" escape hatch.
- Not removing the deep-freeze in `chat-shared.ts` — the freeze is exactly the invariant that makes parallel dispatch sound; this change relies on it.
- Not adding any new RegisterOptions fields. Both fixes work within the current `{ parallel?, readOnly?, concurrency?, dependsOn? }` surface.
- Not adding any new HTTP routes, persistence, or frontend changes.
- Not back-porting Track B auto-promote to non-readOnly registrations (out of scope and contractually impossible).

## Decisions

### Decision 1: Extend `PARALLEL_ALLOWED` rather than introduce a new "frozen-payload-eligible" tier

**Choice:** Append `"pre-llm-fetch"` to the existing `PARALLEL_ALLOWED` set in `writer/lib/hooks.ts:22-26` and update both the `plugin-hooks` and `hook-parallel-dispatch` spec deltas to list it.

**Alternatives considered:**
- *Introduce a separate `FROZEN_PAYLOAD_PARALLEL_ALLOWED` tier* to signal "this stage is parallel-eligible only because its payload is deep-frozen". Rejected: the distinction is invisible at runtime (the dispatcher cannot tell what the dispatch site did with `structuredClone` / `deepFreeze` after the fact), and from the manifest validator's perspective the rule is identical. Two tiers would invite drift.
- *Gate `pre-llm-fetch` parallelism on a new `frozenPayload: true` self-declaration in the manifest.* Rejected: plugins cannot self-attest to a property of the dispatch site they don't control; the dispatcher is the only party that knows the payload is frozen.

The expanded allowlist is the cleanest match to the existing mental model: "is this stage eligible for the parallel bucket? look at `PARALLEL_ALLOWED`".

### Decision 2: Trust the freeze, do not add a runtime "is-frozen" assertion at the dispatch site

**Choice:** The deep-freeze contract lives entirely in `writer/lib/chat-shared.ts` (where the payload is constructed). The dispatcher does NOT re-check `Object.isFrozen(...)` on the payload before parallel fan-out.

**Scope of the freeze:** The dispatch site deep-freezes **only** `messages` and `requestMetadata`. The outer context object itself, and the other top-level fields it carries (`model`, `writeMode`, `correlationId`, `storyDir`, `series`, `name`), are NOT frozen. The runtime safety argument for parallel dispatch rests entirely on the immutability of `messages` and `requestMetadata` (the two fields that contain the user-influenceable payload sent upstream). Handler-level reassignment of the other top-level fields is documented as observe-only with no peer-isolation guarantee — it cannot change the outgoing fetch bytes (the engine uses the locally-built `requestBody`, not the dispatched context), but parallel peer handlers MUST NOT depend on those fields being untouched. The spec deltas in `plugin-hooks` and `hook-observability` document this narrowed scope explicitly.

**Rationale:** Adding a runtime assertion would either (a) silently coerce parallel handlers to serial when the assertion fails — which silently re-introduces the old, less-safe behaviour — or (b) throw at dispatch time, which would break a working request to fix a developer-side mistake. The safer move is to keep the freeze co-located with the dispatch site and rely on the existing per-handler `try/catch` to absorb any `TypeError` from a misbehaving handler. The spec deltas explicitly document the dispatch site as the locus of the freeze guarantee.

### Decision 3: Throttle warning is advisory, deduped per process lifetime, and emitted via the plugin's `baseLogger`

**Choice:** At `register()` time, after the new `HandlerEntry` is pushed onto the per-stage list, walk the **existing** parallel entries on the same stage. Emit at most one `log.warn` for the registration if adding the new entry introduces a concurrency mismatch against any existing parallel entry. The trigger covers two distinct cases:

- **(a) finite-vs-unbounded mismatch:** one of the two entries declares a finite `concurrency` and the other omits `concurrency` (would otherwise run unbounded).
- **(b) finite-vs-higher-finite mismatch:** both entries declare a finite `concurrency` but with *different* values (e.g., `1` vs `5`); the lower value will silently throttle the higher one via `Math.min(...)`.

The warning logs the throttling plugin name(s) + their declared value, the slowed plugin name(s) (with their declared value where applicable, or `"unbounded"` for omitted-`concurrency` peers) + the stage. The warning fires only when the new registration is itself the cause of the mismatch — i.e., the dispatcher SHALL evaluate mismatches only between the new entry and each pre-existing parallel entry, not among the pre-existing entries themselves (those would have already fired their own warnings when they were registered).

To keep dev-mode iteration quiet (the `auto-reload` capability re-registers handlers on every file change), the dispatcher SHALL maintain a module-scoped suppression `Set<string>` keyed by `${stage}::${plugin}::${concurrencyValue ?? "none"}` where `plugin` is the **registering** plugin (the one whose `register()` call triggered the warning) and `concurrencyValue` is that plugin's declared `concurrency` (or the literal `"none"` if undefined). On each potential warning, the dispatcher SHALL compute the tuple, check the set, and emit + insert only if the tuple is not yet present. The set persists for the lifetime of the process; it is NOT cleared on plugin reload, by design. This ensures the warning fires the first time a misconfiguration is detected and then stays silent until the operator restarts the process. The dispatcher module SHALL also export a `/** @internal */`-marked test-only reset helper (e.g. `_resetThrottleWarnDedupForTesting()`) so unit tests can clear the suppression between cases.

**Alternatives considered:**
- *Emit the warning at `dispatch()` time instead.* Rejected: dispatch is on the hot path; warning there would mean a duplicate log on every chunked invocation. Registration is one-shot per plugin load.
- *Emit a warning every time `register()` is called on a heterogeneous bucket, even on identical reloads.* Rejected: would spam dev logs during `auto-reload`. The dedup `Set` was chosen as the lighter alternative to a full structural diff.
- *Throw at registration time.* Rejected: behaviour change. The user explicitly asked for an advisory-only signal.
- *Route the warning through `log.error` or `log.info` instead of `log.warn`.* Rejected: `log.error` implies actionable failure; `log.info` would understate the "you might be surprised by this throttling" framing. `log.warn` matches the precedent set by the existing `parallel:true is only allowed for stages in PARALLEL_ALLOWED` warning.
- *Reset the dedup set on every plugin-manager reload cycle.* Rejected: defeats the dedup purpose during dev iteration, which is exactly the workflow where a single misconfiguration can re-trigger the warning hundreds of times.
- *Key the dedup tuple on the unbounded-peer list rather than just the registering plugin.* Rejected: the peer list churns as plugins load in different orders, producing false-new tuples; keying on `(stage, registering-plugin, declared-concurrency)` captures the actionable unit of "this plugin's declaration is the surprise" while staying stable across reloads.
- *Only warn on finite-vs-unbounded (case **a**) and leave finite-vs-higher-finite (case **b**) silent.* Rejected: the actionable surprise — a plugin's bucket being throttled by a peer's lower `concurrency` declaration — is identical in both cases. Operators investigating a wall-time regression need the same signal whether the throttled peer omitted `concurrency` or declared a higher value.

The warning text is structured to be searchable: it includes the literal phrase that a `concurrency` declaration will "throttle the entire `<stage>` parallel bucket", so operators grepping logs can find every instance. Plugin name + stage are included as structured fields (not just interpolated into the message) for `log.warn`'s JSON-friendly handlers.

### Decision 4: The throttle warning ignores serial-bucket handlers

**Choice:** The walk over existing handlers at registration time filters by `entry.parallel === true`. Serial handlers — even those with a (functionally unused) `concurrency` field — SHALL NOT be cited in the warning or trigger it.

**Rationale:** Effective concurrency is a property of the *parallel* bucket only. A serial handler with `concurrency: 1` does not throttle anything (it already runs alone). Including serial handlers would produce false positives that would train operators to ignore the warning.

## Risks / Trade-offs

- **Risk:** Plugin authors mis-read "parallel-eligible" as "always parallel", register a `pre-llm-fetch` handler that depends on serial-bucket peer state, and break under concurrency.
  - **Mitigation:** The spec delta retains the explicit `readOnly: true` requirement (Track B auto-promote only fires when `readOnly: true` is set). Mutation-style handlers that miss `readOnly: true` continue to land in the serial bucket. The deep-freeze also blocks any handler that tries to compensate by mutating the payload directly. Documentation in `docs/plugin-system.md` SHALL call out the "you are observing, not orchestrating" framing.

- **Risk:** The throttle warning becomes noisy in dev mode (`auto-reload`) because plugins re-register on every file change.
  - **Mitigation:** A module-scoped suppression `Set<string>` keyed by `${stage}::${registering-plugin}::${declared-concurrency ?? "none"}` ensures each unique misconfiguration is logged exactly once per process lifetime. The set is NOT cleared on plugin reload, so dev iteration stays quiet after the first warning. Operators who need to see the warning again can restart the process.

- **Risk:** Existing tests that assert on `pre-llm-fetch` being rejected from the parallel bucket will fail.
  - **Mitigation:** Those tests are the canary for this change — the proposal explicitly calls them out. The implementation tasks include updating or replacing them with the new accept-and-parallel-dispatch tests.

- **Trade-off:** The throttle warning's "fire on heterogeneous bucket transition" rule means the *first* parallel handler to register never triggers a warning, even if it declares `concurrency: 1`. This is intentional — with one handler, there is no peer being slowed yet. The second registration is the natural firing point.

## Migration Plan

Not applicable. HeartReverie is pre-release with no production users. No deprecated paths to retire. Built-in plugins (`HeartReverie/plugins/*/plugin.json`) do not currently declare `parallel: true` on `pre-llm-fetch`, so the change is additive: existing plugins keep working unchanged; new plugins MAY opt into parallel `pre-llm-fetch`.

## Open Questions

_None — all decisions on log level, dedup behaviour, and out-of-scope follow-ups are recorded in the "Decisions" and "Out of scope" sections._

## Out of scope

- **`prompt-debugger` migration.** The sibling-repo `HeartReverie_Plugins/prompt-debugger` currently registers its `pre-llm-fetch` handler serially. After this change lands, that plugin SHOULD be updated to declare `{ parallel: true, readOnly: true }` to take advantage of the new parallel-eligibility, but that update is a separate `HeartReverie_Plugins/openspec` change and is intentionally NOT part of this proposal.
