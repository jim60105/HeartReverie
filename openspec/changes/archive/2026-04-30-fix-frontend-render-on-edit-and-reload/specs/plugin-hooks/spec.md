## ADDED Requirements

### Requirement: Plugin readiness signals

The `usePlugins()` composable SHALL expose two reactive flags:

- `pluginsReady: Ref<boolean>` — flips to `true` only when `initPlugins()` completes a fully successful run (every plugin's manifest fetched, every declared `frontend.js` dynamically imported, and every `register()` resolved).
- `pluginsSettled: Ref<boolean>` — flips to `true` whenever `initPlugins()` finishes, regardless of success or failure.

Both flags SHALL start as `false`, MAY flip to `true` at most once per page lifetime, and SHALL NEVER flip back to `false`. On failure, `pluginsSettled` SHALL flip to `true` while `pluginsReady` SHALL remain `false`. Failures SHALL be surfaced to the user via a visible diagnostic (toast or equivalent notification) rather than silently swallowed.

#### Scenario: Successful initialization flips both flags
- **WHEN** `initPlugins()` runs against an `/api/plugins` response listing three plugins, all of whose `frontend.js` modules import and `register()` successfully
- **THEN** `pluginsReady.value` and `pluginsSettled.value` SHALL both flip from `false` to `true`

#### Scenario: Fetch failure flips only pluginsSettled
- **WHEN** the `/api/plugins` request fails (network error, non-2xx status, or JSON parse error)
- **THEN** `pluginsReady.value` SHALL remain `false`, `pluginsSettled.value` SHALL flip to `true`, and a user-visible failure notification SHALL be emitted

#### Scenario: Per-plugin import failure flips only pluginsSettled
- **WHEN** any plugin's dynamic `import()` or `register()` throws
- **THEN** `pluginsReady.value` SHALL remain `false`, `pluginsSettled.value` SHALL flip to `true`, and a user-visible failure notification SHALL be emitted

### Requirement: Idempotent and concurrency-safe plugin initialization

`initPlugins()` SHALL be safe to call multiple times concurrently. The composable SHALL hold a module-level in-flight initialization promise; if `initPlugins()` is invoked while a previous call is still pending, the new call SHALL await the same promise rather than starting a second initialization. Once `pluginsSettled` is `true`, subsequent calls SHALL return immediately without performing any work.

#### Scenario: Concurrent initPlugins calls share one in-flight promise
- **WHEN** two callers invoke `initPlugins()` synchronously, before the first call has resolved
- **THEN** both calls SHALL await the same in-flight promise, the `/api/plugins` endpoint SHALL be fetched at most once, and each plugin's `register()` SHALL be invoked at most once

#### Scenario: initPlugins after settled is a no-op
- **WHEN** `initPlugins()` is called a second time after `pluginsSettled.value === true`
- **THEN** the call SHALL return immediately, SHALL NOT re-fetch plugins, SHALL NOT re-import modules, and SHALL NOT re-invoke any `register()` function

### Requirement: Async register() functions are awaited

`initPlugins()` SHALL treat the return value of each plugin's `register()` function as a possible thenable: it SHALL await `Promise.resolve(register(...))` before considering that plugin's initialization complete. A plugin whose `register()` returns a `Promise` SHALL therefore be guaranteed to have completed all asynchronous setup (e.g. dynamic imports of its own dependencies, hook registrations performed inside `await`-ed code) before `pluginsReady` or `pluginsSettled` flip.

#### Scenario: Async register completes before pluginsReady flips
- **WHEN** a plugin's `register()` returns a `Promise` that resolves after a 50ms async hook registration
- **THEN** `pluginsReady.value` SHALL remain `false` until that `Promise` has resolved, even if all other plugins registered synchronously

### Requirement: Hook registry exposes handler counts

The `FrontendHookDispatcher` SHALL expose a `getHandlerCount(stage: HookStage): number` method returning the current number of registered handlers for the given stage. This API supports diagnostic instrumentation, tests asserting registration order, and future render-time gating decisions. The method SHALL be a synchronous, side-effect-free read of internal state.

#### Scenario: getHandlerCount reflects registration state
- **WHEN** two plugins each register a `frontend-render` handler and one plugin registers a `chapter:render:after` handler
- **THEN** `frontendHooks.getHandlerCount("frontend-render")` SHALL return `2` and `frontendHooks.getHandlerCount("chapter:render:after")` SHALL return `1`

### Requirement: Chapter rendering is gated on pluginsSettled

Components that mount the markdown rendering pipeline (specifically `ContentArea.vue` mounting `ChapterContent.vue`) SHALL NOT mount the chapter rendering subtree until `pluginsSettled.value === true`. The gate SHALL use `pluginsSettled` (not `pluginsReady`) so that a plugin-load failure does not permanently hide chapter content; in the failure case, the chapter SHALL render against the empty plugin handler set, matching the existing "no plugins registered" rendering contract.

#### Scenario: Chapter does not mount before pluginsSettled
- **WHEN** `currentContent.value` is non-empty but `pluginsSettled.value === false`
- **THEN** `<ChapterContent>` SHALL NOT be mounted; `ContentArea` SHALL render a loading placeholder

#### Scenario: Chapter mounts after plugins settle, including on failure
- **WHEN** `pluginsSettled` flips to `true` (regardless of `pluginsReady`'s value) and `currentContent.value` is non-empty
- **THEN** `<ChapterContent>` SHALL mount and `useMarkdownRenderer` SHALL run with the currently-registered handler set
