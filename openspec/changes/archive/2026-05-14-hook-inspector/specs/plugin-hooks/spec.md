## ADDED Requirements

### Requirement: Backend HookDispatcher exposes per-handler introspection

The backend `HookDispatcher` SHALL expose a public method `introspect(): Record<HookStage, Array<{ plugin: string | undefined, priority: number, errorCount: number }>>` returning the currently-registered handler entries for every stage, sorted by priority ascending. The method SHALL be synchronous, return a fresh shallow copy of internal state (mutations by callers SHALL NOT affect future dispatches), and SHALL NOT perform any I/O. The `errorCount` value SHALL reflect the number of times the dispatcher has caught an exception thrown by that handler entry since the process started.

#### Scenario: introspect reflects registration
- **WHEN** plugin A has registered a `prompt-assembly` handler at priority 50, plugin B has registered a `prompt-assembly` handler at priority 100, and no other handlers exist
- **THEN** `hookDispatcher.introspect()["prompt-assembly"]` SHALL equal an array of two entries `[{plugin: "A", priority: 50, errorCount: 0}, {plugin: "B", priority: 100, errorCount: 0}]` in that order

#### Scenario: introspect is side-effect free
- **WHEN** `hookDispatcher.introspect()` is called twice in succession with no intervening register/dispatch calls
- **THEN** both calls SHALL return arrays that compare deep-equal

#### Scenario: Caller mutation does not affect dispatcher state
- **WHEN** a caller takes the returned object and mutates one of the entry arrays
- **THEN** subsequent calls to `dispatch()` and `introspect()` SHALL behave as if no caller mutation occurred (the returned arrays are detached copies)

### Requirement: Frontend FrontendHookDispatcher exposes per-handler introspection

The frontend `FrontendHookDispatcher` SHALL expose `introspect(): Record<HookStage, Array<{ plugin: string | undefined, priority: number, errorCount: number }>>` with the same contract as the backend dispatcher: synchronous, fresh shallow copy, no I/O. The `errorCount` SHALL count caught exceptions for each handler entry observed by the dispatcher since SPA boot. The existing `getHandlerCount(stage)` method SHALL be preserved for backward compatibility and SHALL continue to return the registered handler count per stage.

#### Scenario: Frontend introspect parallels backend
- **WHEN** a plugin registers a `frontend-render` handler at priority 100 and `chapter:render:after` at priority 200
- **THEN** `frontendHooks.introspect()["frontend-render"]` SHALL equal `[{plugin: <name>, priority: 100, errorCount: 0}]` and `frontendHooks.introspect()["chapter:render:after"]` SHALL equal `[{plugin: <name>, priority: 200, errorCount: 0}]`

### Requirement: Frontend dispatcher rejects async handlers on non-action stages

The `FrontendHookDispatcher.register(stage, handler, priority?, originPluginName?)` method SHALL synchronously throw an `Error` when `stage !== "action-button:click"` AND `handler.constructor.name === "AsyncFunction"`. The thrown error message SHALL name the offending stage, name the plugin (when `originPluginName` is supplied), and include a one-line migration hint pointing to the wrapping pattern `register(stage, (ctx) => { void doAsync(ctx).catch(log.error); })`. The dispatcher SHALL NOT register the handler in this case.

For `stage === "action-button:click"`, the dispatcher SHALL continue to accept async handlers (existing behavior preserved).

#### Scenario: Async handler on frontend-render is rejected
- **WHEN** a plugin calls `frontendHooks.register("frontend-render", async (ctx) => { /* ... */ })`
- **THEN** the call SHALL throw an `Error` whose message names `frontend-render` and includes the wrapping migration hint, and the handler SHALL NOT appear in `frontendHooks.introspect()["frontend-render"]`

#### Scenario: Async handler on action-button:click is allowed
- **WHEN** a plugin calls `frontendHooks.register("action-button:click", async (ctx) => { /* ... */ })`
- **THEN** the call SHALL succeed and the handler SHALL appear in `frontendHooks.introspect()["action-button:click"]`

#### Scenario: Sync handler on any stage is allowed
- **WHEN** a plugin calls `frontendHooks.register("frontend-render", (ctx) => { /* ... */ })`
- **THEN** the call SHALL succeed regardless of stage

### Requirement: Boot-time declare-vs-register cross-check for frontend dispatcher

The `FrontendHookDispatcher` SHALL expose a `finalizeBoot(): void` method invoked exactly once by the SPA bootstrap path after every loaded plugin's `register(hooks)` has been called. `finalizeBoot()` SHALL compare each plugin's manifest `hooks[]` declarations (delivered via the existing `GET /api/plugins` listing) against the set of stages on which the plugin actually registered handlers, scoping the comparison to **frontend stages only**. Specifically:

- `declaredFrontend(plugin) = manifest.hooks.map(h => h.stage).filter(s => s ∈ KNOWN_FRONTEND_STAGES)`
- `registeredFrontend(plugin) = stages on which the plugin's frontend.js called hooks.register(stage, …)` (captured via the per-plugin proxy described in `Hook handler origin tracking`).

Stages not in `KNOWN_FRONTEND_STAGES` (backend stages, declarative `strip-tags`, unknown future stages) SHALL be ignored — backend-stage enforcement is performed by `PluginManager` at backend load time.

When `manifest.hooks` is present and non-empty AND `symmetricDifference(declaredFrontend, registeredFrontend)` is non-empty for a plugin, `finalizeBoot()` SHALL surface a mismatch report listing every mismatching plugin and the symmetric difference per plugin (`declaredOnly` / `registeredOnly`). Plugins whose manifest omits `hooks` entirely SHALL be exempt (treated as "undeclared"). Full-stack plugins whose `hooks[]` mixes backend and frontend stages SHALL NOT be flagged for declared-only backend stages (those are not in `KNOWN_FRONTEND_STAGES`).

The error reporting mechanism SHALL be observable: an error banner SHALL be rendered in the SPA listing the mismatches, AND the `hook-inspector:report` event SHALL include a `bootMismatches: Array<{ plugin, declaredOnly: string[], registeredOnly: string[] }>` field on the next subsequent dispatch from the inspector page. `finalizeBoot()` SHALL NOT throw — the SPA continues running so the user can read the mismatch list — but plugin authors SHALL treat any non-empty mismatch as a hard error to fix.

#### Scenario: Manifest declared, register matches
- **WHEN** plugin X's manifest declares `hooks: [{stage: "frontend-render"}]` and plugin X's `register()` calls `hooks.register("frontend-render", h)` only
- **THEN** `finalizeBoot()` SHALL produce no mismatch report for plugin X

#### Scenario: Manifest declared, register additionally subscribes
- **WHEN** plugin X's manifest declares `hooks: [{stage: "frontend-render"}]` and plugin X's `register()` also calls `hooks.register("chapter:dom:ready", h2)`
- **THEN** `finalizeBoot()` SHALL produce a mismatch report `{ plugin: "X", declaredOnly: [], registeredOnly: ["chapter:dom:ready"] }`

#### Scenario: Manifest omits hooks entirely
- **WHEN** plugin Y's manifest has no `hooks` field and plugin Y registers handlers on multiple stages
- **THEN** `finalizeBoot()` SHALL produce no mismatch report for plugin Y (undeclared plugins are exempt)

#### Scenario: Full-stack plugin's backend-stage declarations are ignored by frontend check
- **WHEN** plugin Z's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "frontend-render"}]` and plugin Z's frontend.js only calls `hooks.register("frontend-render", h)`
- **THEN** `finalizeBoot()` SHALL produce no mismatch report for plugin Z because the backend-stage `prompt-assembly` is not in `KNOWN_FRONTEND_STAGES` and is excluded from `declaredFrontend`

### Requirement: Dispatchers reject duplicate registration per (plugin, stage) for action-button:click

`FrontendHookDispatcher.register()` SHALL reject any registration call whose `(plugin, stage)` pair already has a handler registered **when the stage is `action-button:click`**. The dispatcher SHALL throw an `Error` whose message names the plugin and stage. This invariant exists because `action-button:click` is dispatched per-button to a single owning plugin; allowing duplicates would make dispatch ordering ambiguous.

For all other stages (backend and frontend), plugins MAY register multiple handlers per `(plugin, stage)` at distinct priorities — this is a legitimate pattern for splitting unrelated responsibilities. The Hook Inspector renders such handlers as separate rows under the same plugin.

#### Scenario: action-button:click duplicate rejected
- **WHEN** a plugin's `frontend.js` calls `hooks.register("action-button:click", h1)` and then `hooks.register("action-button:click", h2)`
- **THEN** the second call SHALL throw an `Error` naming the plugin and `action-button:click`

#### Scenario: Multiple handlers per (plugin, stage) on non-action-button stages
- **WHEN** a plugin's `frontend.js` calls `hooks.register("frontend-render", h1, 30)` and then `hooks.register("frontend-render", h2, 60)`
- **THEN** both registrations SHALL succeed and both handlers SHALL appear in `frontendHooks.introspect()["frontend-render"]` sorted by priority

## MODIFIED Requirements

### Requirement: Error isolation

If a hook handler throws an error during execution, the hook system SHALL catch the error, log it with the plugin name, hook stage, and error details, increment the `errorCount` on the corresponding `HandlerEntry` (so subsequent calls to `introspect()` reflect the new count), and continue executing the remaining handlers for that stage. A single handler failure SHALL NOT prevent other handlers from running or cause the overall request to fail. The `errorCount` SHALL be stored in memory only and SHALL reset to zero when the process restarts; it SHALL NOT be persisted to disk.

#### Scenario: Handler throws and others continue
- **WHEN** handler A (priority 50) throws an error and handler B (priority 100) is also registered for the same stage
- **THEN** the hook system SHALL log the error from handler A, increment handler A's `errorCount` by one, and proceed to execute handler B normally

#### Scenario: Error log includes context
- **WHEN** a handler from plugin `my-plugin` throws an error during the `post-response` stage
- **THEN** the log entry SHALL include the plugin name `my-plugin`, the stage `post-response`, and the error message/stack trace

#### Scenario: Request completes despite handler error
- **WHEN** a `post-response` handler throws an error
- **THEN** the server SHALL still return the HTTP response with the chapter content successfully

#### Scenario: errorCount increments on repeated throws
- **WHEN** the same handler throws on three separate dispatch calls
- **THEN** `introspect()` SHALL report that handler's `errorCount` as `3` (or higher if additional throws occurred since), and a process restart SHALL reset the count to `0`

#### Scenario: errorCount is not persisted across restarts
- **WHEN** the process is restarted after handler exceptions were recorded
- **THEN** the dispatcher SHALL initialize all `errorCount` values to `0` for newly-loaded handlers and SHALL NOT read any prior counter values from disk
