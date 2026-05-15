# Hook Parallel Dispatch

## Purpose

Opt-in parallel dispatch of hook handlers within a single stage, gated by per-handler declarations, with serial-first ordering, concurrency caps, dependency DAG, debug endpoints, and Track B default-on rule for readOnly handlers.
## Requirements
### Requirement: Two-bucket serial-first dispatch algorithm

`HookDispatcher.dispatch(stage, context)` SHALL split the registered handlers of a stage into two buckets based on each entry's effective `parallel` flag (see "Parallel opt-in and Track B default-on"): `serial[]` (entries with `parallel !== true`) and `parallel[]` (entries with `parallel === true`). The dispatcher SHALL execute the serial bucket first, in priority-ascending order, awaiting each handler before starting the next. After every serial handler has settled, the dispatcher SHALL start the parallel bucket using `Promise.allSettled` (subject to the `concurrency` cap and `dependsOn` topological order defined in their respective requirements). The dispatcher SHALL return the same `context` reference that was passed in.

**`response-stream` no-back-pressure special case (normative)**: when `stage === "response-stream"`, after the serial bucket has settled, the dispatcher SHALL **launch** the parallel bucket (i.e. call `Promise.allSettled(parallelHandlers.map(...))`) and **immediately return** the awaited-serial result to the caller WITHOUT awaiting the parallel-bucket promise. The caller (`writer/lib/chat-shared.ts` at the per-chunk dispatch point) is therefore never back-pressured by parallel handlers, regardless of how slow those handlers are. The dispatcher SHALL retain the parallel-bucket promise internally so that on settlement it can still (a) record rejections via `log.error` per "Parallel error isolation via Promise.allSettled", (b) update the ring buffer (see "Debug endpoints"), and (c) update the per-handler sliding-window wall-time for the 5 ms soft-warn rule. For ring-buffer / SSE accounting purposes, **dispatch completion** for `response-stream` SHALL be defined as the moment dispatch returns to the caller (= serial-bucket completion + parallel-bucket scheduled), NOT the moment the parallel bucket settles. The `durationMs` field SHALL reflect this definition.

For all other stages (`prompt-assembly`, `post-response`, and any non-allowlisted stage whose parallel bucket is forced empty by the validator), the dispatcher SHALL await the parallel-bucket `Promise.allSettled` before returning, matching the conventional sequential-then-parallel pattern. SSE `dispatchPhase` SHALL reflect this: for `response-stream`, the emitted phase SHALL be `"serial"` when no parallel handlers were launched, and `"mixed"` whenever at least one parallel handler was scheduled (regardless of its eventual settlement state).

When the parallel bucket is empty, dispatch behaviour SHALL be byte-identical to the legacy `for + await` loop (zero regression for any plugin that does not declare `hooks[]`).

#### Scenario: Serial bucket runs to completion before parallel bucket starts

- **GIVEN** stage `post-response` has three serial handlers with priorities 50, 100, 150 and two parallel handlers with priorities 10 and 200
- **WHEN** `dispatch("post-response", ctx)` is invoked
- **THEN** the serial handlers SHALL run in order 50 → 100 → 150 to completion before either parallel handler starts
- **AND** the two parallel handlers SHALL both start AFTER the serial handler at priority 150 has settled, regardless of their own priority values

#### Scenario: Parallel handler with low priority does not preempt serial handler with high priority

- **GIVEN** stage `prompt-assembly` has one serial handler at priority 150 and one parallel handler at priority 10
- **WHEN** `dispatch("prompt-assembly", ctx)` is invoked
- **THEN** the serial handler SHALL start first and run to completion
- **AND** the parallel handler SHALL only start AFTER the serial handler has settled

#### Scenario: Empty parallel bucket preserves legacy behaviour

- **GIVEN** a stage whose handlers are all `parallel: false` (or whose plugins declare no `hooks[]` at all)
- **WHEN** `dispatch(stage, ctx)` is invoked
- **THEN** the dispatcher SHALL execute the handlers in priority-ascending order with sequential `await`
- **AND** SHALL NOT construct any Proxy view or call `Promise.allSettled`
- **AND** the returned context SHALL be the same reference passed in, with the same set of own properties as today's implementation

#### Scenario: response-stream dispatch returns before parallel bucket settles (no back-pressure)

- **GIVEN** a `response-stream` parallel handler whose body deliberately blocks for 200 ms (`await new Promise(r => setTimeout(r, 200))`)
- **AND** the engine's per-chunk dispatch point at `writer/lib/chat-shared.ts` awaits `dispatch("response-stream", ctx)` before forwarding the chunk
- **WHEN** the LLM stream delivers one content delta
- **THEN** the `await dispatch(...)` SHALL resolve within milliseconds of the serial bucket completing (well before the 200 ms parallel handler settles)
- **AND** the engine SHALL forward the chunk to the chapter file / `onDelta` callback without waiting for the parallel handler
- **AND** when the parallel handler eventually settles, the dispatcher SHALL still update the ring buffer and emit any rejection log normally

#### Scenario: response-stream non-back-pressure is per-chunk (next chunk not blocked by prior chunk's parallel handler)

- **GIVEN** the same blocking 200 ms parallel handler is registered on `response-stream`
- **WHEN** the LLM stream delivers two content deltas in rapid succession
- **THEN** the second `dispatch("response-stream", ctx)` call SHALL start (and return) without waiting for the first chunk's parallel handler to settle
- **AND** both chunks SHALL be forwarded to the engine's downstream pipeline before the first parallel handler resolves

### Requirement: Parallel context view via Proxy with per-handler logger

For every handler in the parallel bucket, `HookDispatcher` SHALL pass a `Proxy(context)` view rather than the shared base context. The Proxy SHALL behave as follows:

- `get(target, "logger")` SHALL return a per-handler logger derived from the entry's `baseLogger` and the dispatch `correlationId`.
- `get(target, otherKey)` SHALL fall through to `Reflect.get(target, otherKey)` so the handler observes every mutation committed by the preceding serial bucket.
- `set(target, "logger", _)` SHALL be a no-op returning `true` (the per-handler logger slot is immutable from the handler's perspective).
- `set(target, otherKey, value)` SHALL pass through to `Reflect.set(target, otherKey, value)` in production (avoiding a crash failure mode for misbehaving plugins). When `HOOK_DEBUG=1` is set, the trap SHALL ADDITIONALLY emit `log.warn` with `{ plugin, stage, mutatedKey, dispatchPhase: "parallel" }` to flag the readOnly-contract violation.

For every handler in the serial bucket, `HookDispatcher` SHALL pass the **shared base context** (no Proxy, no `Object.create`). `context.logger` SHALL be mutated in place to the per-handler logger before invoking the handler. This preserves the invariant that serial mutators (e.g. `user-message` writing `context.preContent`, `context-compaction` mutating `context.previousContext` in place) are visible to the engine after dispatch.

#### Scenario: Parallel handlers each receive their own logger via Proxy

- **GIVEN** two parallel handlers from plugins `plugin-a` and `plugin-b` registered for the same stage
- **WHEN** both handlers read `context.logger.info("...")`
- **THEN** each handler's log entry SHALL be tagged with its own plugin name (the Proxy returns a per-handler logger keyed by entry identity)

#### Scenario: Serial mutator regression — `preContent` write survives dispatch

- **GIVEN** a serial handler registered for stage `pre-write` that assigns `context.preContent = "<user_message>hi</user_message>"`
- **WHEN** `dispatch("pre-write", ctx)` returns
- **THEN** the returned `ctx.preContent` SHALL equal `"<user_message>hi</user_message>"`
- **AND** the engine reading `preWriteCtx.preContent` immediately after dispatch SHALL observe that value (no Proxy or prototype-chain has hidden the write on a derived object)

#### Scenario: HOOK_DEBUG detects parallel handler write violation

- **GIVEN** `HOOK_DEBUG=1` is set in the environment
- **AND** a parallel handler from plugin `bad-actor` writes `context.foo = 1` despite having declared `readOnly: true`
- **WHEN** the parallel pass executes
- **THEN** the dispatcher SHALL emit a single `log.warn` with `plugin: "bad-actor"`, `stage`, `mutatedKey: "foo"`, and `dispatchPhase: "parallel"`
- **AND** the dispatch SHALL still complete successfully (no rethrow, no crash)

### Requirement: Stage allowlist enforcement (PARALLEL_ALLOWED)

The dispatcher SHALL define a hard-coded allowlist `PARALLEL_ALLOWED = {"prompt-assembly", "post-response", "response-stream"}`. Any manifest `hooks[]` entry declaring `parallel: true` for a stage outside this allowlist SHALL be coerced to `parallel: false` at manifest load time with a `log.warn` identifying the plugin, the stage, and the allowlist. The dispatcher itself SHALL never start a parallel pass for a non-allowed stage, even if a corrupted internal entry indicates otherwise.

`pre-write` and `strip-tags` SHALL NEVER be eligible for parallel dispatch. Frontend stage names (e.g. `chapter:dom:ready`, `notification`, `action-button:click`) MAY appear in `hooks[]` entries for introspection annotations (reads/writes/note for hook-inspector conflict detection), but `parallel: true` on such entries SHALL be coerced to `false` by the validator since they are not in PARALLEL_ALLOWED.

#### Scenario: pre-write parallel:true declaration is coerced to serial

- **GIVEN** a plugin manifest declares `hooks: [{ stage: "pre-write", parallel: true, readOnly: true }]`
- **WHEN** the plugin manager validates the manifest
- **THEN** the validator SHALL emit a single `log.warn` containing the literal phrase `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the resulting handler entry SHALL be registered with `parallel: false`
- **AND** the dispatch behaviour for that stage SHALL be unchanged from today

### Requirement: `readOnly:true` contract for parallel entries

A manifest `hooks[]` entry MAY declare `parallel: true` ONLY when it also declares `readOnly: true`. For stages `prompt-assembly` and `post-response`, missing or false `readOnly` with `parallel: true` SHALL be **coerced** to `parallel: false` with a `log.warn` `parallel:true requires readOnly:true`. For stage `response-stream`, the same combination SHALL be **rejected** (see "Response-stream allow_with_readOnly gate") — the high-frequency per-chunk dispatch makes misuse expensive enough to warrant a hard reject rather than a silent downgrade.

Parallel handlers SHALL be considered read-only by contract: they SHALL NOT write any top-level field of `context` (including in-place mutation of arrays or objects). Run-time enforcement is best-effort (Proxy `set` trap under `HOOK_DEBUG=1`); the primary guarantee is the manifest-level self-declaration plus authoring-doc guidance.

#### Scenario: parallel:true without readOnly:true on post-response is coerced

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", parallel: true }]` (no `readOnly`)
- **THEN** the validator SHALL emit a `log.warn` containing the literal phrase `parallel:true requires readOnly:true`
- **AND** the handler entry SHALL be registered with `parallel: false`

#### Scenario: parallel:true with readOnly:true on post-response is accepted

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true }]`
- **THEN** the validator SHALL accept the entry without coercion
- **AND** the resulting handler entry SHALL be placed in the parallel bucket at dispatch time

### Requirement: Response-stream allow_with_readOnly gate

The `response-stream` stage MAY accept `parallel: true` declarations, but ONLY when the same entry declares `readOnly: true`. If `parallel: true` is declared without `readOnly: true`, the validator SHALL **reject the declaration** with `log.error` containing the phrase `response-stream + parallel:true requires readOnly:true`. The rejected declaration SHALL be dropped (the handler entry SHALL be registered as `parallel: false`) so the plugin keeps loading.

For a `response-stream` entry that is accepted as `parallel: true` (i.e. with `readOnly: true`), the dispatcher SHALL perform **per-chunk fan-out**: each invocation of `dispatch("response-stream", ctx)` (one per content delta) SHALL run its parallel bucket via an independent `Promise.allSettled` whose result does NOT block the next chunk's dispatch. The engine's forward stream pipeline (writing the chunk to the chapter file, emitting via `onDelta`) SHALL NOT wait for any parallel handler from a prior chunk to settle.

The dispatcher SHALL maintain a sliding-window wall-time average (last N=50 chunks) per parallel `response-stream` handler. When the average exceeds 5 ms per chunk, the dispatcher SHALL emit `log.warn { plugin, stage: "response-stream", avgMs, samples }` once per crossing event (debounced to avoid log spam). This soft warning SHALL NOT change dispatch behaviour; it is advisory only.

#### Scenario: response-stream + parallel:true + readOnly:true is accepted with per-chunk fan-out

- **GIVEN** a plugin declares `hooks: [{ stage: "response-stream", parallel: true, readOnly: true }]` with two parallel handlers (a metrics counter and a log accumulator)
- **WHEN** the LLM stream delivers two consecutive content deltas
- **THEN** the dispatcher SHALL invoke the two parallel handlers concurrently within each chunk (observed by overlapping start timestamps)
- **AND** the second chunk's dispatch SHALL start without waiting for the first chunk's parallel handlers to settle

#### Scenario: response-stream + parallel:true + missing readOnly is rejected

- **GIVEN** a plugin declares `hooks: [{ stage: "response-stream", parallel: true }]` (no `readOnly`)
- **WHEN** the plugin manager validates the manifest
- **THEN** the validator SHALL emit `log.error` containing the literal phrase `response-stream + parallel:true requires readOnly:true`
- **AND** the resulting handler entry SHALL be registered with `parallel: false`
- **AND** the plugin SHALL still load (the declaration is dropped, not the plugin)

#### Scenario: response-stream slow parallel handler triggers soft warn

- **GIVEN** an accepted parallel `response-stream` handler whose average wall-time over the last 50 chunks exceeds 5 ms
- **WHEN** the dispatcher updates the sliding window after the 50th sample crossing the threshold
- **THEN** the dispatcher SHALL emit a single `log.warn` with `{ plugin, stage: "response-stream", avgMs, samples }`
- **AND** subsequent dispatches SHALL continue normally (the warn is advisory, not blocking)

### Requirement: Parallel error isolation via Promise.allSettled

The dispatcher SHALL collect the results of all parallel-bucket handlers using `Promise.allSettled`. For every result whose `status === "rejected"`, the dispatcher SHALL emit `log.error` with `{ stage, plugin, dispatchPhase: "parallel", error: { message, stack } }` AND SHALL increment the corresponding `HandlerEntry.errorCount` (matching the existing per-handler counter). The dispatcher SHALL NOT rethrow. A single handler failure SHALL NOT prevent other handlers (within the same parallel bucket or in subsequent dispatch calls) from running.

For `response-stream` (per "Two-bucket serial-first dispatch algorithm", `dispatch()` returns before the parallel bucket settles), the `Promise.allSettled` callback fires **asynchronously** after dispatch has already returned. Error logging, `errorCount` increment, ring-buffer update, and soft-warn sliding-window update for `response-stream` parallel handlers SHALL therefore happen out-of-band relative to the caller. Engine forward progress SHALL never be blocked by these post-hoc bookkeeping operations.

For serial handlers, the existing per-handler try/catch behaviour SHALL be preserved, with `log.error` payload extended to include `dispatchPhase: "serial"`.

#### Scenario: One rejected parallel handler does not stop the others

- **GIVEN** five parallel handlers registered for `post-response`, of which two are programmed to throw
- **WHEN** the parallel pass executes
- **THEN** all five handlers SHALL run to settlement
- **AND** the dispatcher SHALL emit exactly two `log.error` entries, each with `dispatchPhase: "parallel"` and the throwing plugin's name
- **AND** the dispatch promise SHALL resolve (no thrown exception out of `dispatch()`)

### Requirement: Parallel opt-in and Track B default-on

The dispatcher SHALL determine each handler entry's effective `parallel` flag from the manifest `hooks[]` entry as follows:

- If `parallel === true` (after the allowlist + readOnly gates pass): effective `parallel = true`.
- If `parallel === false` (explicit opt-out): effective `parallel = false`.
- If `parallel === undefined` AND `readOnly === true`: effective `parallel = true` (Track B default-on). The validator SHALL emit `log.debug` recording the auto-promotion (no warn).
- If `parallel === undefined` AND `readOnly !== true`: effective `parallel = false`.
- If the plugin manifest declares no `hooks[]` array at all: every handler from that plugin SHALL have effective `parallel = false`.

Per-handler `register(stage, handler, options)` overrides (see the `plugin-core` capability) SHALL apply the same evaluation rules with the manifest entry providing the defaults.

#### Scenario: readOnly:true without parallel is treated as parallel by default

- **GIVEN** a manifest declares `hooks: [{ stage: "post-response", readOnly: true }]` (no explicit `parallel`)
- **WHEN** the plugin's handler is dispatched
- **THEN** the handler SHALL run in the parallel bucket
- **AND** the validator SHALL have emitted at most one `log.debug` (not `log.warn`) recording the auto-promotion

#### Scenario: Explicit parallel:false opts out of Track B default-on

- **GIVEN** a manifest declares `hooks: [{ stage: "post-response", readOnly: true, parallel: false }]`
- **WHEN** the plugin's handler is dispatched
- **THEN** the handler SHALL run in the serial bucket

#### Scenario: Plugin without hooks[] is unaffected by Track B

- **GIVEN** a plugin whose `plugin.json` does NOT declare a `hooks` array at all
- **WHEN** the plugin registers a `post-response` handler
- **THEN** the handler SHALL run in the serial bucket regardless of its actual read/write behaviour
- **AND** the dispatch outcome SHALL be byte-identical to the legacy implementation

### Requirement: Concurrency cap for parallel bucket

A manifest `hooks[]` entry MAY declare `concurrency: integer (>= 1)`. The validator SHALL coerce non-integer or `<1` values to `undefined` with `log.warn`. For each stage, the dispatcher SHALL compute the **effective concurrency** as `Math.min(...declaredConcurrencies)` across all entries in that stage's parallel bucket; if any entry has `concurrency === undefined`, the effective concurrency SHALL be unbounded (equivalent to a single `Promise.allSettled` over the whole bucket).

When the effective concurrency is a finite integer `N`, the dispatcher SHALL execute the parallel bucket as a sequence of chunks of size `N`, each chunk being a `Promise.allSettled` whose settlement is awaited before the next chunk starts.

**Chunking SHALL operate WITHIN topological layers, NEVER across dependency edges** (see "DependsOn DAG ordering"). Concretely:

1. The dispatcher first computes topological layers from the parallel bucket's `dependsOn` graph (layer 0 = nodes with no in-edges; layer k = nodes whose every predecessor lies in layers 0..k-1).
2. Within each layer, entries are sorted by priority-asc as the secondary key.
3. Each layer is then chunked by the effective `concurrency`: a layer with `M` entries and effective concurrency `N` produces `ceil(M/N)` sequential `Promise.allSettled` chunks of up to `N` entries each.
4. The dispatcher SHALL `await` every chunk of layer `k` (i.e. all of layer `k` SHALL settle) before starting any chunk of layer `k+1`.

This guarantees that a handler MUST NOT start until **all** of its declared `dependsOn` predecessors have settled, even when those predecessors and the dependent could numerically fit in the same chunk. Dependency edges therefore act as **hard barriers** that override the chunking heuristic.

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

### Requirement: DependsOn DAG ordering

A manifest `hooks[]` entry MAY declare `dependsOn: string[]`, whose values are plugin names (cross-plugin references within the same stage are permitted). After all plugins have completed loading, the plugin manager SHALL build a directed graph over `(stage, plugin)` nodes using these declarations, separately per stage. If the graph for a given stage contains a cycle OR any `dependsOn` value on that stage names an unknown plugin (i.e. a plugin that did not load, or did not register a handler for this stage), the manager SHALL `log.error` the offence AND the dispatcher SHALL **stage-wide fall back to priority-asc-only ordering** for that stage's parallel bucket — that is, **every** `dependsOn` declaration on that stage SHALL be ignored, not just the offending one. This is the conservative choice: a partial dependency graph is more dangerous than no graph (handlers expecting a predecessor would silently start out of order), so the whole stage reverts to priority-only.

For stages whose dependency graph is acyclic AND every name resolves, the dispatcher SHALL compute topological layers as defined in "Concurrency cap for parallel bucket". Within each layer, the existing priority order SHALL be preserved as the secondary key. Dependency edges SHALL act as hard barriers between layers; concurrency chunking SHALL never merge entries from different layers.

#### Scenario: A depends on B — B runs first

- **GIVEN** two parallel entries: plugin `a` declaring `dependsOn: ["b"]` and plugin `b` with no `dependsOn`, both on stage `post-response`
- **WHEN** the parallel pass runs
- **THEN** plugin `b`'s handler SHALL start AND settle before plugin `a`'s handler starts

#### Scenario: Cycle triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `dependsOn: ["b"]`, plugin `b` declares `dependsOn: ["a"]`, and plugin `c` declares `dependsOn: ["a"]`, all on the same stage
- **WHEN** the plugin manager finalises the dependency graph
- **THEN** the manager SHALL emit `log.error` identifying the cycle
- **AND** **every** `dependsOn` declaration for that stage (including `c`'s, which is not itself part of the cycle) SHALL be ignored
- **AND** the parallel bucket for that stage SHALL run in priority-asc order only (no topological layering)
- **AND** the affected entries SHALL still register with their `parallel` / `readOnly` flags retained

#### Scenario: Unknown dependsOn name triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `dependsOn: ["ghost"]` where no plugin named `ghost` registered a handler for the same stage, and plugin `c` on the same stage declares a perfectly valid `dependsOn: ["b"]`
- **WHEN** the plugin manager finalises the dependency graph
- **THEN** the manager SHALL emit `log.error` identifying plugin `a` and the unknown name `ghost`
- **AND** **every** `dependsOn` declaration for that stage (including the well-formed `c → b` edge) SHALL be ignored
- **AND** the parallel bucket for that stage SHALL run in priority-asc order only
- **AND** all affected entries SHALL retain their `parallel` / `readOnly` flags

### Requirement: Debug endpoints `/api/_debug/hooks` and `/api/_debug/hooks/stream`

The server SHALL expose two HTTP endpoints behind the existing `X-Passphrase` middleware:

- `GET /api/_debug/hooks` SHALL return a JSON aggregate over the most recent N=200 dispatches retained in an in-memory ring buffer. The response body SHALL contain at least:
  - `perStage`: object keyed by stage name, each value `{ count: number, avgMs: number, p50Ms: number, p95Ms: number, serialCount: number, parallelCount: number }`.
  - `perPlugin`: object keyed by plugin name, each value `{ cumulativeMs: number, dispatchCount: number, errorCount: number }`.
  - `windowSize`: number — the actual sample count in the buffer (≤ 200).
- `GET /api/_debug/hooks/stream` SHALL be a Server-Sent Events endpoint that emits one event per `dispatch()` completion with payload `{ stage: string, dispatchPhase: "serial" | "parallel" | "mixed", durationMs: number, serialCount: number, parallelCount: number, plugins: Array<{ plugin: string, durationMs: number, errored: boolean }> }`. The connection SHALL emit a heartbeat comment line at least every 30 seconds to keep proxies alive.

Both payload shapes are part of this capability's contract; they are designated as the canonical upstream for the A8 prompt-debugger. Future fields MAY be added in a backward-compatible way (new optional keys) but the listed keys SHALL NOT be removed or have their types changed without a new spec change.

**SSE lifecycle**: the server SHALL track each connected subscriber and detect client disconnects (e.g. via `req.signal.aborted`, `res.on("close")`, or the equivalent Hono / Deno mechanism) within at most one heartbeat interval (i.e. ≤ 30 seconds). Upon disconnect, the server SHALL release the subscriber's resources (unsubscribe from the dispatcher's event emitter, drop any per-connection buffers). The server SHALL NOT support event replay: a reconnecting client SHALL receive only events emitted **after** its (re)connection completes. The `Last-Event-ID` request header SHALL be ignored — no `id:` lines are emitted, and there is no server-side history beyond the ring buffer (which is queried via the aggregate endpoint, not the SSE stream).

#### Scenario: Aggregate endpoint requires passphrase

- **GIVEN** the server is running with `X-Passphrase: secret` configured
- **WHEN** a client sends `GET /api/_debug/hooks` without the header
- **THEN** the server SHALL respond `401` (or whatever the existing passphrase middleware returns for missing auth)

#### Scenario: Aggregate endpoint returns the documented shape

- **GIVEN** the server has dispatched at least one hook in the current process lifetime
- **WHEN** a client sends `GET /api/_debug/hooks` with a valid passphrase
- **THEN** the response status SHALL be `200`
- **AND** the response body SHALL contain top-level keys `perStage`, `perPlugin`, `windowSize`
- **AND** every `perStage[*]` value SHALL contain numeric fields `count`, `avgMs`, `p50Ms`, `p95Ms`, `serialCount`, `parallelCount`

#### Scenario: SSE endpoint emits a payload per dispatch

- **GIVEN** an authenticated SSE connection to `GET /api/_debug/hooks/stream`
- **WHEN** the engine completes one `dispatch("post-response", ctx)` call
- **THEN** the client SHALL receive exactly one SSE `data:` line whose JSON payload contains the keys `stage`, `dispatchPhase`, `durationMs`, `serialCount`, `parallelCount`, `plugins`
- **AND** `plugins[*]` entries SHALL each contain string `plugin`, numeric `durationMs`, and boolean `errored`

#### Scenario: SSE emits heartbeats when idle

- **GIVEN** an authenticated SSE connection with no dispatch activity for 30+ seconds
- **WHEN** the heartbeat interval elapses
- **THEN** the server SHALL write at least one SSE comment line (`: heartbeat\n\n` or equivalent) to keep the connection alive

#### Scenario: Client disconnect releases subscriber resources

- **GIVEN** an authenticated SSE subscriber connected to `/api/_debug/hooks/stream`
- **WHEN** the client closes the connection (TCP FIN, browser tab close, or network drop)
- **THEN** the server SHALL detect the disconnect within at most one heartbeat interval (≤ 30 seconds)
- **AND** the server SHALL unsubscribe the connection from the dispatcher's event emitter, release any per-connection buffers, and SHALL NOT continue to append events for that subscriber
- **AND** a subsequent `dispatch()` SHALL NOT cause writes to the closed connection (no leaked file descriptor or memory)

#### Scenario: Reconnecting client receives no replay; Last-Event-ID is ignored

- **GIVEN** a client previously connected to `/api/_debug/hooks/stream`, received some events, disconnected, and is now reconnecting
- **AND** the reconnect request includes a `Last-Event-ID` header (or any `id:` cursor value)
- **WHEN** the server accepts the new connection
- **THEN** the server SHALL ignore the `Last-Event-ID` header (no buffered events from before reconnect SHALL be replayed)
- **AND** the new connection SHALL receive ONLY events corresponding to `dispatch()` calls that complete after the (re)connection is established
- **AND** the server SHALL NOT emit `id:` lines in the SSE payload (the protocol intentionally provides no replay mechanism; clients needing recent history SHALL query the aggregate endpoint instead)

### Requirement: Parallel hook dispatch (opt-in + readOnly default-on, backend-only)

The backend `HookDispatcher` SHALL support selective parallel dispatch of hook handlers within a single stage, gated by per-handler declarations carried on `HandlerEntry` and sourced from the plugin manifest `hooks[]` field (defined in the `plugin-core` capability) or per-handler `register()` options (also defined in `plugin-core`).

Within a single `dispatch(stage, ctx)` call:

1. Handlers SHALL be partitioned into a `serial[]` bucket (entries with effective `parallel !== true`) and a `parallel[]` bucket (entries with effective `parallel === true`).
2. The dispatcher SHALL execute the serial bucket first, in priority-ascending order, awaiting each handler before the next (matching today's behaviour exactly).
3. The dispatcher SHALL execute the parallel bucket second, after all serial handlers have settled, using `Promise.allSettled` as the failure-isolation mechanism. The parallel bucket SHALL be ordered first by `dependsOn` topological sort and then by priority-asc as the secondary key, and SHALL be chunked according to the effective `concurrency` (minimum of declared values; `undefined` → unbounded). The detailed algorithm, allowlist, readOnly contract, `response-stream` per-chunk fan-out, `concurrency` cap, `dependsOn` DAG, debug endpoints, and Track B default-on rule are normatively defined in the `hook-parallel-dispatch` capability.

**Priority semantics (BREAKING)**: A handler with effective `parallel: true` SHALL run AFTER every handler with effective `parallel: false` (regardless of their priority values). Priority is preserved only as the sort key within each bucket. The manifest validator SHALL emit a `log.warn` when an entry has `parallel: true` AND `priority < 100`, identifying the plugin and stage and stating that parallel handlers run after all serial handlers regardless of priority.

**Track B default-on (BREAKING behaviour)**: A `hooks[]` entry that explicitly declares `readOnly: true` without explicitly declaring `parallel` SHALL be treated as `parallel: true`. A plugin author MAY opt out by writing `parallel: false` alongside `readOnly: true`. A plugin that does NOT declare a `hooks[]` array at all SHALL have all of its handlers treated as `parallel: false`, regardless of their actual behaviour — this preserves byte-identical behaviour for every plugin shipped before this change.

**Scope (v1)**: This requirement governs the **backend** `HookDispatcher` only. The `FrontendHookDispatcher` (`reader-src/src/lib/plugin-hooks.ts`) and every frontend hook stage (`frontend-render`, `notification`, `chapter:render:after`, `chapter:dom:ready`, `chapter:dom:dispose`, `story:switch`, `chapter:change`, `chat:send:before`, `action-button:click`) SHALL be unchanged in v1. Frontend stage names MAY appear in `hooks[]` entries for introspection annotations (reads/writes/note for hook-inspector conflict detection), but their `parallel`, `readOnly`, `concurrency`, and `dependsOn` fields SHALL have no effect on dispatch — the frontend dispatcher ignores them.

#### Scenario: Serial-first ordering — mixed bucket

- **GIVEN** stage `post-response` has serial handlers at priorities 50/100/150 and parallel handlers at priorities 10/200
- **WHEN** `dispatch("post-response", ctx)` is invoked
- **THEN** the three serial handlers SHALL run sequentially in order 50 → 100 → 150
- **AND** both parallel handlers SHALL start AFTER the priority-150 serial handler has settled
- **AND** the parallel handler at priority 10 SHALL NOT preempt any serial handler

#### Scenario: Parallel handlers run AFTER all serial handlers regardless of priority

- **GIVEN** one serial handler at priority 150 and one parallel handler at priority 10 on the same stage
- **WHEN** dispatch executes
- **THEN** the serial handler at priority 150 SHALL start and settle first
- **AND** the parallel handler at priority 10 SHALL start only after that

#### Scenario: `Promise.allSettled` error isolation across parallel handlers

- **GIVEN** five parallel handlers, of which two throw during execution
- **WHEN** the parallel pass runs
- **THEN** all five handlers SHALL settle (no early termination)
- **AND** the dispatcher SHALL log exactly two errors, each carrying `dispatchPhase: "parallel"`, the plugin name, and the error message/stack
- **AND** the dispatch promise SHALL resolve (no thrown exception)

#### Scenario: Stage allowlist enforcement coerces non-allowed parallel declarations

- **GIVEN** a manifest declares `hooks: [{ stage: "pre-write", parallel: true, readOnly: true }]`
- **WHEN** the manifest is validated at load time
- **THEN** the entry SHALL be coerced to `parallel: false`
- **AND** the validator SHALL emit `log.warn` containing the phrase `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the affected stage's dispatch SHALL remain sequential

#### Scenario: `readOnly:true` is required for `parallel:true` on prompt-assembly / post-response

- **WHEN** a manifest declares `{ stage: "post-response", parallel: true }` without `readOnly: true`
- **THEN** the validator SHALL coerce `parallel` to `false` with `log.warn` containing `parallel:true requires readOnly:true`

#### Scenario: `response-stream` allow_with_readOnly — accepted

- **WHEN** a manifest declares `{ stage: "response-stream", parallel: true, readOnly: true }`
- **THEN** the validator SHALL accept the entry without coercion
- **AND** dispatch for `response-stream` SHALL invoke the parallel handlers per-chunk using `Promise.allSettled`
- **AND** the engine's forward stream pipeline (write to chapter file, emit `onDelta`) SHALL NOT wait for parallel handlers from the prior chunk to settle (no back-pressure)

#### Scenario: `response-stream` allow_with_readOnly — rejected on missing readOnly

- **WHEN** a manifest declares `{ stage: "response-stream", parallel: true }` (no `readOnly`)
- **THEN** the validator SHALL emit `log.error` containing `response-stream + parallel:true requires readOnly:true`
- **AND** the declaration SHALL be dropped (the handler SHALL register with `parallel: false`)
- **AND** the plugin SHALL still load

#### Scenario: `response-stream` slow parallel handler raises soft warn

- **GIVEN** a parallel `response-stream` handler whose sliding-window average wall-time over the last 50 chunks exceeds 5 ms
- **WHEN** the threshold is crossed
- **THEN** the dispatcher SHALL emit a `log.warn` with `{ plugin, stage: "response-stream", avgMs, samples }` (debounced to one per crossing event)
- **AND** dispatch behaviour SHALL be otherwise unchanged

#### Scenario: Track B — readOnly:true without parallel is treated as parallel

- **GIVEN** a manifest declares `hooks: [{ stage: "prompt-assembly", readOnly: true }]` with `parallel` undefined
- **WHEN** the handler is dispatched
- **THEN** it SHALL run in the parallel bucket (effective `parallel = true`)
- **AND** no `log.warn` SHALL be emitted for this promotion (debug log only)

#### Scenario: Track B opt-out via explicit `parallel: false`

- **GIVEN** a manifest declares `hooks: [{ stage: "prompt-assembly", readOnly: true, parallel: false }]`
- **WHEN** the handler is dispatched
- **THEN** it SHALL run in the serial bucket

#### Scenario: Plugin without `hooks[]` is unaffected

- **GIVEN** a plugin whose `plugin.json` does NOT declare a `hooks` array
- **WHEN** that plugin's `post-response` handler is dispatched
- **THEN** it SHALL run in the serial bucket
- **AND** the dispatch result SHALL be byte-identical to the legacy implementation (snapshot equivalent)

#### Scenario: `context.logger` isolation in parallel pass via Proxy view

- **GIVEN** two parallel handlers from plugins `alpha` and `beta` registered for the same stage
- **WHEN** both handlers read `context.logger` and emit a log line
- **THEN** each handler's log line SHALL be tagged with its own plugin name (per-handler logger derived from `baseLogger` and the dispatch `correlationId`)
- **AND** writes to `context.logger` by either handler SHALL be silently ignored (the slot is immutable through the Proxy)

#### Scenario: Serial mutator regression — preContent survives dispatch

- **GIVEN** a serial handler registered for stage `pre-write` that writes `context.preContent = "<user_message>hello</user_message>"`
- **WHEN** `dispatch("pre-write", ctx)` returns
- **THEN** the caller-visible `ctx.preContent` SHALL equal the written value
- **AND** the engine reading `ctx.preContent` immediately afterwards SHALL observe the same value (this scenario explicitly guards against using `Object.create(ctx)` or a Proxy for serial handlers)

#### Scenario: `concurrency: 1` collapses parallel bucket to sequential

- **GIVEN** four parallel handlers with effective `concurrency: 1`
- **WHEN** the parallel pass runs
- **THEN** the dispatcher SHALL execute the handlers as four sequential chunks of one handler each
- **AND** wall-time SHALL approximate the sum of individual durations

#### Scenario: `concurrency: N` chunks the parallel bucket

- **GIVEN** four parallel handlers with effective `concurrency: 2`
- **WHEN** the parallel pass runs
- **THEN** the dispatcher SHALL execute two `Promise.allSettled` chunks of two handlers each, sequentially

#### Scenario: Unset `concurrency` results in unbounded parallel dispatch

- **GIVEN** four parallel handlers, none declaring `concurrency`
- **WHEN** the parallel pass runs
- **THEN** the dispatcher SHALL invoke `Promise.allSettled` over all four handlers in a single batch

#### Scenario: `dependsOn` enforces topological order

- **GIVEN** parallel entry from plugin `a` declares `dependsOn: ["b"]` and entry from plugin `b` has no `dependsOn`, both on `post-response`
- **WHEN** the parallel pass runs
- **THEN** plugin `b`'s handler SHALL settle before plugin `a`'s handler starts

#### Scenario: `dependsOn` cycle triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `dependsOn: ["b"]`, plugin `b` declares `dependsOn: ["a"]`, and plugin `c` declares a well-formed `dependsOn: ["a"]` on the same stage
- **WHEN** the plugin manager finalises the graph
- **THEN** the manager SHALL emit `log.error` naming the cycle
- **AND** **every** `dependsOn` declaration for that stage (including `c`'s well-formed edge) SHALL be ignored
- **AND** dispatch ordering for that stage's parallel bucket SHALL fall back to priority-asc only

#### Scenario: `dependsOn` unknown plugin name triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `dependsOn: ["ghost"]` where no plugin named `ghost` registered a handler for the same stage, and plugin `c` on the same stage declares a well-formed `dependsOn: ["b"]`
- **WHEN** the plugin manager finalises the graph
- **THEN** the manager SHALL emit `log.error` identifying plugin `a` and `ghost`
- **AND** **every** `dependsOn` declaration for that stage (including `c → b`) SHALL be ignored
- **AND** dispatch ordering for that stage's parallel bucket SHALL fall back to priority-asc only; all affected entries SHALL retain their `parallel` / `readOnly` flags

#### Scenario: Debug endpoint `/api/_debug/hooks` returns documented aggregate

- **GIVEN** the server has dispatched at least one hook in the current process
- **WHEN** a client sends `GET /api/_debug/hooks` with the configured `X-Passphrase`
- **THEN** the response SHALL be `200` with a JSON body containing top-level keys `perStage`, `perPlugin`, `windowSize`
- **AND** every `perStage[*]` SHALL contain `count`, `avgMs`, `p50Ms`, `p95Ms`, `serialCount`, `parallelCount`

#### Scenario: Debug SSE endpoint emits payload per dispatch

- **GIVEN** an authenticated SSE connection to `GET /api/_debug/hooks/stream`
- **WHEN** the engine completes a single `dispatch()` call
- **THEN** the client SHALL receive exactly one SSE `data:` event whose JSON payload contains `stage`, `dispatchPhase`, `durationMs`, `serialCount`, `parallelCount`, and `plugins[]`

#### Scenario: Frontend dispatcher is unchanged in v1

- **GIVEN** a plugin registers a frontend handler (e.g. `frontend-render`, `notification`, `chapter:dom:ready`, `action-button:click`)
- **WHEN** the corresponding frontend dispatch occurs
- **THEN** the dispatcher SHALL behave exactly as it does today (synchronous for-loop or existing async sequential pattern)
- **AND** frontend `hooks[]` entries SHALL be accepted for introspection purposes but their parallel-dispatch fields (`parallel`, `readOnly`, `concurrency`, `dependsOn`) SHALL have no effect on dispatch
