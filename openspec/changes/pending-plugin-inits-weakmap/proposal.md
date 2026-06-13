## Why

`createApp()` tracks async plugin route registrations by stashing a `_pendingPluginInits` array directly on the Hono instance through five `as unknown as` casts (including a non-null assertion immediately after a `??=`). The compiler is overruled at every touch point, and the `createApp → initPluginRoutes → registerSpaFallback` ordering contract is enforced only by comments. A module-level `WeakMap<Hono, Promise<unknown>[]>` removes all five casts with zero public-API change and no GC concerns.

## What Changes

- Add a module-level `const pendingPluginInits = new WeakMap<Hono, Promise<unknown>[]>();` to `writer/app.ts`, keyed by app instance so concurrent `createApp()` calls (in tests) never share state and entries die with the app.
- Rewrite the write side in `createApp()` to `get`/`push`/`set` against the WeakMap instead of the `(app as unknown as { _pendingPluginInits?: … })._pendingPluginInits ??= []` cast pattern.
- Rewrite the read side in `initPluginRoutes(app)` to `get` then `delete` against the WeakMap instead of the cast-based read and `delete (app as …)._pendingPluginInits`.
- Preserve all existing JSDoc on `initPluginRoutes` and `registerSpaFallback`, the public function signatures, and the `createApp → initPluginRoutes → registerSpaFallback` ordering contract.
- This is a **type-hygiene refactor with no public-API change and no behavior change**: async registrars are still collected during `createApp()` and awaited by `initPluginRoutes()` before `registerSpaFallback()` runs.

## Capabilities

### New Capabilities
_None._ This is an internal type-hygiene change; no new top-level capability is introduced.

### Modified Capabilities
- `plugin-core`: Add a requirement that the pending async plugin route registrations are tracked in a module-level `WeakMap<Hono, Promise<unknown>[]>` keyed by app instance (not a property smuggled onto the Hono instance via casts), while the `createApp → initPluginRoutes → registerSpaFallback` ordering and the SPA-fallback-after-async-plugin-routes guarantee are unchanged.
- `typescript-type-system`: Add a requirement that `writer/app.ts` contains no `as unknown as` casts and no `_pendingPluginInits` property smuggling for pending plugin-init tracking.
- `backend-refactor`: Add a requirement that per-app transient state SHALL be stored in a typed module-level `WeakMap` keyed by the app instance rather than smuggled as ad-hoc properties on the framework object.

## Impact

- **Backend code**: `writer/app.ts` only (introduce the WeakMap, rewrite both the write and read sides). `writer/server.ts` is unchanged — the `createApp(...) → await initPluginRoutes(app) → registerSpaFallback(app, config)` call sequence stays exactly as is.
- **Tests**: existing plugin-route tests are the regression net (the contract "async registrars are awaited before the SPA fallback registers" is already covered); if a test pokes `_pendingPluginInits` directly, rewrite it against the public sequence.
- **Verification**: `grep -n "_pendingPluginInits" writer/app.ts` and `grep -n "as unknown as" writer/app.ts` both return no matches.
- No public-API change, no return-type change to `createApp`, no migration concerns (pre-release, 0 users).
