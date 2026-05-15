## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Error isolation

If a hook handler throws an error during execution, the hook system SHALL catch the error, log it with the plugin name, hook stage, error details, AND the dispatch phase (`"serial"` for handlers in the serial bucket or `"parallel"` for handlers in the parallel bucket — see the `hook-parallel-dispatch` capability for bucket assignment). The hook system SHALL increment the `errorCount` on the corresponding `HandlerEntry` (so subsequent calls to `introspect()` reflect the new count) and continue executing the remaining handlers for that stage. A single handler failure SHALL NOT prevent other handlers from running or cause the overall request to fail. The `errorCount` SHALL be stored in memory only and SHALL reset to zero when the process restarts; it SHALL NOT be persisted to disk.

For parallel-bucket handlers, error isolation SHALL be achieved via `Promise.allSettled`: the dispatcher SHALL inspect every settled result, increment `errorCount` for every `rejected` entry, and emit one `log.error` per rejection. The dispatcher SHALL NOT rethrow.

#### Scenario: Handler throws and others continue

- **WHEN** handler A (priority 50, serial) throws an error and handler B (priority 100, serial) is also registered for the same stage
- **THEN** the hook system SHALL log the error from handler A with `dispatchPhase: "serial"`, increment handler A's `errorCount` by one, and proceed to execute handler B normally

#### Scenario: Error log includes context

- **WHEN** a handler from plugin `my-plugin` throws an error during the `post-response` stage
- **THEN** the log entry SHALL include the plugin name `my-plugin`, the stage `post-response`, the `dispatchPhase` (`"serial"` or `"parallel"`), and the error message/stack trace

#### Scenario: Request completes despite handler error

- **WHEN** a `post-response` handler throws an error (in either bucket)
- **THEN** the server SHALL still return the HTTP response with the chapter content successfully

#### Scenario: errorCount increments on repeated throws

- **WHEN** the same handler throws on three separate dispatch calls
- **THEN** `introspect()` SHALL report that handler's `errorCount` as `3` (or higher if additional throws occurred since), and a process restart SHALL reset the count to `0`

#### Scenario: errorCount is not persisted across restarts

- **WHEN** the process is restarted after handler exceptions were recorded
- **THEN** the dispatcher SHALL initialize all `errorCount` values to `0` for newly-loaded handlers and SHALL NOT read any prior counter values from disk

#### Scenario: Parallel bucket — single rejection does not stop the others

- **GIVEN** five parallel handlers, two of which throw
- **WHEN** the parallel pass runs
- **THEN** all five SHALL settle
- **AND** the dispatcher SHALL emit exactly two `log.error` entries, each with `dispatchPhase: "parallel"` and the offending plugin name
- **AND** the corresponding `HandlerEntry.errorCount` values SHALL each increment by one
- **AND** the overall `dispatch()` promise SHALL resolve
