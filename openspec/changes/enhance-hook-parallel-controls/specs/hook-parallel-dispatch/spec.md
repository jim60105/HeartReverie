## MODIFIED Requirements

### Requirement: Stage allowlist enforcement (PARALLEL_ALLOWED)

The dispatcher SHALL define a hard-coded allowlist `PARALLEL_ALLOWED = {"prompt-assembly", "post-response", "response-stream", "pre-llm-fetch"}`. Any manifest `hooks[]` entry declaring `parallel: true` for a stage outside this allowlist SHALL be coerced to `parallel: false` at manifest load time with a `log.warn` identifying the plugin, the stage, and the allowlist. The dispatcher itself SHALL never start a parallel pass for a non-allowed stage, even if a corrupted internal entry indicates otherwise.

`pre-write` and `strip-tags` SHALL NEVER be eligible for parallel dispatch. Frontend stage names (e.g. `chapter:dom:ready`, `notification`, `action-button:click`) MAY appear in `hooks[]` entries for introspection annotations (reads/writes/note for hook-inspector conflict detection), but `parallel: true` on such entries SHALL be coerced to `false` by the validator since they are not in PARALLEL_ALLOWED.

The inclusion of `pre-llm-fetch` in PARALLEL_ALLOWED is sound because the dispatch site (`streamLlmAndPersist()` in `writer/lib/chat-shared.ts`) deep-clones AND deep-freezes both `messages` and `requestMetadata` via `deepFreeze(structuredClone(...))` before placing them onto the dispatched payload — any handler that violates the `readOnly: true` contract throws a `TypeError` rather than corrupting peer handlers' view of the payload. Parallel `pre-llm-fetch` registrations SHALL still satisfy the `readOnly: true` requirement defined in "Requirement: `readOnly:true` contract for parallel entries"; missing or false `readOnly` with `parallel: true` SHALL be coerced to `parallel: false` (consistent with the `prompt-assembly` and `post-response` rule) rather than rejected.

#### Scenario: pre-write parallel:true declaration is coerced to serial

- **GIVEN** a plugin manifest declares `hooks: [{ stage: "pre-write", parallel: true, readOnly: true }]`
- **WHEN** the plugin manager validates the manifest
- **THEN** the validator SHALL emit a single `log.warn` containing the literal phrase `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the resulting handler entry SHALL be registered with `parallel: false`
- **AND** the dispatch behaviour for that stage SHALL be unchanged from today

#### Scenario: pre-llm-fetch parallel:true + readOnly:true is accepted

- **GIVEN** a plugin manifest declares `hooks: [{ stage: "pre-llm-fetch", parallel: true, readOnly: true }]`
- **WHEN** the plugin manager validates the manifest and registers the handler
- **THEN** the validator SHALL NOT emit a `parallel:true is only allowed for stages in PARALLEL_ALLOWED` warning for that entry
- **AND** the handler entry SHALL be registered with `parallel: true` and placed in the parallel bucket at dispatch time
- **AND** at the next `pre-llm-fetch` dispatch the handler SHALL run concurrently with any other parallel `pre-llm-fetch` handlers via `Promise.allSettled`

#### Scenario: pre-llm-fetch readOnly:true auto-promotes to parallel (Track B)

- **GIVEN** a plugin registers via `hooks.register("pre-llm-fetch", h, { readOnly: true })` with no explicit `parallel` field
- **WHEN** the dispatcher processes the registration
- **THEN** the Track B default-on rule SHALL auto-promote the entry to `parallel: true` (because the stage is in PARALLEL_ALLOWED and `readOnly: true` was declared)
- **AND** the handler SHALL be placed in the parallel bucket at the next dispatch

### Requirement: Concurrency cap for parallel bucket

A manifest `hooks[]` entry MAY declare `concurrency: integer (>= 1)`. The validator SHALL coerce non-integer or `<1` values to `undefined` with `log.warn`. For each stage, the dispatcher SHALL compute the **effective concurrency** from the parallel bucket as follows: if **no** parallel entry declares a `concurrency` value, the effective concurrency SHALL be unbounded (equivalent to a single `Promise.allSettled` over the whole bucket); otherwise the effective concurrency SHALL be `Math.min(...)` over the set of declared `concurrency` values only, and parallel entries that omitted `concurrency` SHALL NOT contribute to the minimum (i.e., they SHALL NOT raise the cap and they SHALL still run under the same cap as the declared entries within their topological layer).

When the effective concurrency is a finite integer `N`, the dispatcher SHALL execute the parallel bucket as a sequence of chunks of size `N`, each chunk being a `Promise.allSettled` whose settlement is awaited before the next chunk starts.

**Chunking SHALL operate WITHIN topological layers, NEVER across dependency edges** (see "DependsOn DAG ordering"). Concretely:

1. The dispatcher first computes topological layers from the parallel bucket's `dependsOn` graph (layer 0 = nodes with no in-edges; layer k = nodes whose every predecessor lies in layers 0..k-1).
2. Within each layer, entries are sorted by priority-asc as the secondary key.
3. Each layer is then chunked by the effective `concurrency`: a layer with `M` entries and effective concurrency `N` produces `ceil(M/N)` sequential `Promise.allSettled` chunks of up to `N` entries each.
4. The dispatcher SHALL `await` every chunk of layer `k` (i.e. all of layer `k` SHALL settle) before starting any chunk of layer `k+1`.

This guarantees that a handler MUST NOT start until **all** of its declared `dependsOn` predecessors have settled, even when those predecessors and the dependent could numerically fit in the same chunk. Dependency edges therefore act as **hard barriers** that override the chunking heuristic.

**Registration-time throttle warning.** Because effective concurrency is the minimum across all declared values, a parallel-bucket plugin that declares a lower `concurrency` than its peers silently lowers the cap for the entire bucket — both for peers that declared a higher value and for peers that declared no `concurrency` at all. To make this "most-restrictive wins" interaction visible to plugin authors and operators, the dispatcher SHALL emit an advisory `log.warn` at `register()` time via the registering plugin's `baseLogger` (falling back to the module-level dispatcher logger when no plugin logger is attached) whenever a new parallel-bucket registration would cause a bucket to have a non-uniform effective cap — specifically, the warning SHALL fire when, considering the new entry together with all already-registered parallel entries on the same stage, the bucket contains at least one pair of entries `(x, y)` such that one of the following holds:
- (a) **finite-vs-unbounded mismatch:** one entry declares a finite `concurrency` value and another entry omits `concurrency` (would otherwise run unbounded); OR
- (b) **finite-vs-higher-finite mismatch:** two entries both declare a finite `concurrency` value but the values differ (e.g., `1` vs `5`) — the lower value will throttle the higher one.

The dispatcher SHALL only emit the warning when the new registration is itself the cause of the mismatch — i.e., the warning SHALL NOT fire if the bucket was already heterogeneous before the new entry was added and the new entry's `concurrency` (or omission thereof) does not introduce a new mismatch pair against any existing entry. Equivalently, the warning fires when adding the new entry transitions the bucket from "no mismatch involving the new entry" to "at least one mismatch involving the new entry".

The warning payload SHALL include the stage name, the throttling plugin name(s) and their declared `concurrency` value(s), and the names (and where applicable, declared values) of the parallel-bucket plugins that will be slowed by the cap. The warning text SHALL state that the throttling plugin's `concurrency` will throttle the entire parallel bucket on the named stage. The warning is **informational only** — dispatch behaviour (the `Math.min(...)` rule, chunking, layer barriers, and error isolation) SHALL NOT change as a result of the warning being emitted. The check SHALL be O(handlers per stage) and SHALL NOT involve any I/O. Serial-bucket handlers SHALL be ignored by the check (they do not participate in the concurrency cap calculation).

**Dedup across process lifetime.** The dispatcher SHALL maintain a module-scoped suppression set keyed by the tuple `${stage}::${registering-plugin}::${declared-concurrency ?? "none"}` where `registering-plugin` is the plugin whose `register()` call triggered the candidate warning and `declared-concurrency` is that plugin's declared `concurrency` value (or the literal string `"none"` when the field was omitted). Before emitting the warning, the dispatcher SHALL compute the tuple, check the set, and emit + insert only when the tuple is not yet present. The set SHALL persist for the lifetime of the process and SHALL NOT be cleared by plugin-manager reload cycles, so subsequent re-registrations from the same plugin with the same `concurrency` declaration on the same stage SHALL remain silent. The set SHALL be reset only by process restart. The dispatcher module SHALL also export a test-only reset helper (`/** @internal */`-marked) that clears the suppression set, so test cases that exercise the warning can guarantee independence between cases.

#### Scenario: concurrency:1 collapses parallel bucket to sequential

- **GIVEN** four parallel entries with `concurrency: 1` declared on at least one
- **WHEN** the parallel pass runs
- **THEN** the four handlers SHALL execute one-at-a-time (each `Promise.allSettled` chunk contains exactly one handler)
- **AND** the observed wall-time SHALL approximate the sum of individual durations (within bench tolerance)

#### Scenario: concurrency:N chunks the bucket

- **GIVEN** four parallel entries with effective `concurrency: 2`
- **WHEN** the parallel pass runs
- **THEN** the dispatcher SHALL execute two `Promise.allSettled` chunks of two handlers each, sequentially
- **AND** the wall-time SHALL approximate `2 × max(handlerDuration)` for uniform handlers

#### Scenario: Non-integer concurrency is coerced to undefined

- **GIVEN** a manifest entry declares `concurrency: 0` (or `-3`, or `"two"`, or `1.5`)
- **WHEN** the validator processes the entry
- **THEN** the entry's `concurrency` SHALL be coerced to `undefined`
- **AND** a `log.warn` SHALL be emitted naming the plugin, stage, and rejected value

#### Scenario: Dependency edge forces a barrier even when chunk would fit both

- **GIVEN** two parallel entries on the same stage: plugin `a` declares `dependsOn: ["b"]`, plugin `b` has no `dependsOn`, and the effective `concurrency` is `2`
- **WHEN** the parallel pass runs
- **THEN** the dispatcher SHALL place `b` in topological layer 0 and `a` in layer 1
- **AND** plugin `b`'s handler SHALL fully settle BEFORE plugin `a`'s handler starts, even though `concurrency: 2` would numerically allow both to share a single chunk
- **AND** the parallel pass SHALL execute as two sequential chunks (layer 0 with `{b}`, then layer 1 with `{a}`), NOT as one chunk containing `{a, b}` together

#### Scenario: Throttle warning fires when a capped handler joins an unbounded bucket

- **GIVEN** plugin `obs-a` is already registered for `prompt-assembly` with `{ parallel: true, readOnly: true }` (no `concurrency` declared)
- **WHEN** plugin `obs-b` registers for `prompt-assembly` with `{ parallel: true, readOnly: true, concurrency: 1 }`
- **THEN** the dispatcher SHALL emit a single `log.warn` whose payload identifies plugin `obs-b` as the throttling plugin, the declared `concurrency` value `1`, the stage `prompt-assembly`, and plugin `obs-a` as the unbounded peer that will be slowed
- **AND** the warning text SHALL state that plugin `obs-b`'s `concurrency` will throttle the entire `prompt-assembly` parallel bucket
- **AND** the dispatch behaviour for that stage SHALL be unchanged from the case where the warning was not emitted (effective concurrency remains `1` per the `Math.min(...)` rule)

#### Scenario: Throttle warning fires when an unbounded handler joins a capped bucket

- **GIVEN** plugin `obs-a` is already registered for `prompt-assembly` with `{ parallel: true, readOnly: true, concurrency: 1 }`
- **WHEN** plugin `obs-b` registers for `prompt-assembly` with `{ parallel: true, readOnly: true }` (no `concurrency` declared)
- **THEN** the dispatcher SHALL emit a single `log.warn` whose payload identifies plugin `obs-a` as the throttling plugin (with `concurrency: 1`), plugin `obs-b` as the unbounded handler being slowed, and the stage `prompt-assembly`
- **AND** the dispatch behaviour for that stage SHALL be unchanged

#### Scenario: Throttle warning fires when a lower finite concurrency joins a higher finite bucket

- **GIVEN** plugin `obs-a` is already registered for `prompt-assembly` with `{ parallel: true, readOnly: true, concurrency: 5 }`
- **WHEN** plugin `obs-b` registers for `prompt-assembly` with `{ parallel: true, readOnly: true, concurrency: 1 }`
- **THEN** the dispatcher SHALL emit a single `log.warn` whose payload identifies plugin `obs-b` as the throttling plugin (declared `concurrency: 1`), plugin `obs-a` (declared `concurrency: 5`) as the peer that will be slowed, and the stage `prompt-assembly`
- **AND** the warning text SHALL state that plugin `obs-b`'s `concurrency` will throttle the entire `prompt-assembly` parallel bucket
- **AND** the effective concurrency for the bucket SHALL be `1` per the `Math.min(...)` rule, and dispatch behaviour SHALL be unchanged from the case where the warning was not emitted

#### Scenario: No throttle warning when all parallel handlers share the same concurrency profile

- **GIVEN** two parallel handlers on `prompt-assembly`, both declaring `concurrency: 2`
- **WHEN** the second handler is registered
- **THEN** the dispatcher SHALL NOT emit a throttle warning (the bucket is homogeneous — every parallel handler declared the same finite cap, so there is no mismatch)

#### Scenario: No throttle warning when all parallel handlers omit concurrency

- **GIVEN** two parallel handlers on `prompt-assembly`, neither declaring `concurrency`
- **WHEN** the second handler is registered
- **THEN** the dispatcher SHALL NOT emit a throttle warning (the bucket runs unbounded; there is no cap to surface)

#### Scenario: Serial-bucket handlers are ignored by the throttle warning check

- **GIVEN** a serial handler is registered on `prompt-assembly` with no `concurrency` field
- **WHEN** a parallel handler with `concurrency: 1` is subsequently registered for the same stage
- **THEN** the dispatcher SHALL NOT cite the serial handler in the throttle warning payload (the serial handler does not participate in the parallel bucket and is not subject to the cap)
- **AND** if the serial handler is the only other handler on the stage, the dispatcher SHALL NOT emit any throttle warning at all

#### Scenario: Throttle warning is deduped across plugin reloads

- **GIVEN** plugin `obs-a` is registered on `prompt-assembly` with `{ parallel: true, readOnly: true }` and plugin `obs-b` is then registered with `{ parallel: true, readOnly: true, concurrency: 1 }`, causing one throttle warning to be emitted for plugin `obs-b`
- **WHEN** the plugin manager re-registers `obs-b` (e.g., during an `auto-reload` cycle) with the same `{ parallel: true, readOnly: true, concurrency: 1 }` declaration
- **THEN** the dispatcher SHALL NOT emit a second throttle warning for that registration (the `${stage}::${plugin}::${concurrency}` tuple is already in the module-scoped suppression set)
- **AND** if the process restarts and `obs-b` re-registers with the same declaration, the warning SHALL fire again exactly once (the suppression set lives only as long as the process)
- **AND** if `obs-b` changes its declared `concurrency` value (e.g., to `2`), the warning SHALL fire again on the next registration because the tuple is now distinct
