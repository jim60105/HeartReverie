## ADDED Requirements

### Requirement: Pending async plugin route registrations tracked in a WeakMap

`writer/app.ts` SHALL track the async plugin route registrations started during `createApp()` in a module-level `WeakMap<Hono, Promise<unknown>[]>` keyed by the app instance, rather than by attaching a `_pendingPluginInits` property to the Hono instance. `createApp()` SHALL append each async `registerRoutes()` promise to the array associated with that app instance in the WeakMap. `initPluginRoutes(app)` SHALL read the array for the given app from the WeakMap, await all promises with `Promise.all`, and then delete the WeakMap entry. Keying by app instance SHALL ensure concurrent `createApp()` calls (e.g. in tests) never share state, and WeakMap entries SHALL be eligible for garbage collection with their app.

This SHALL be a behavior-preserving change: the `createApp → initPluginRoutes → registerSpaFallback` ordering contract and the guarantee that the SPA fallback is registered only after all async plugin routes are initialized SHALL be unchanged. The public signatures of `createApp`, `initPluginRoutes`, and `registerSpaFallback` SHALL be unchanged, and `writer/server.ts`'s call sequence SHALL be untouched.

#### Scenario: Async registrars are collected and awaited per app instance

- **GIVEN** a plugin whose `registerRoutes()` returns a promise during `createApp()`
- **WHEN** `initPluginRoutes(app)` is called for that app
- **THEN** the promise SHALL be awaited (looked up by the app instance in the WeakMap) before `initPluginRoutes` resolves, and the WeakMap entry for that app SHALL be deleted afterward

#### Scenario: Concurrent createApp calls do not share pending state

- **WHEN** two `createApp()` calls run concurrently (e.g. two test app instances)
- **THEN** each app's pending async registrations SHALL be tracked under its own WeakMap key and `initPluginRoutes` SHALL await only the promises registered for the app passed to it

#### Scenario: SPA fallback still registers after async plugin routes

- **GIVEN** a plugin whose `registerRoutes()` awaits a dynamic import before registering `GET /api/plugins/example/data`
- **WHEN** `initPluginRoutes(app)` completes and `registerSpaFallback(app, config)` is called afterward
- **THEN** `GET /api/plugins/example/data` SHALL return the plugin's response (not 404 or index.html), preserving the existing non-shadowing guarantee

#### Scenario: No property smuggling remains

- **WHEN** `writer/app.ts` is searched for `_pendingPluginInits`
- **THEN** no matches SHALL be returned
