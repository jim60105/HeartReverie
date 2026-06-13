## Context

All paths are relative to the `HeartReverie/` repo root.

`createApp()` in `writer/app.ts` registers plugin routes; some plugins' `registerRoutes()` are async (they `await` dynamic imports). To guarantee the SPA catch-all fallback is registered only after those async registrations resolve, `createApp()` collects the returned promises and `initPluginRoutes(app)` awaits them before `registerSpaFallback(app, config)` runs (the contract is specified in the `plugin-core` "SPA fallback does not shadow async plugin routes" requirement).

The promises are currently smuggled onto the Hono instance through five `as unknown as` casts. Write side (~`app.ts:191–198`):

```ts
// Track async registrars for initPluginRoutes
if (result instanceof Promise) {
  (app as unknown as { _pendingPluginInits?: Promise<unknown>[] })._pendingPluginInits ??= [];
  (app as unknown as { _pendingPluginInits?: Promise<unknown>[] })._pendingPluginInits!.push(result);
}
```

Read side (~`app.ts:238–245`):

```ts
export async function initPluginRoutes(app: Hono): Promise<void> {
  const pending =
    (app as unknown as { _pendingPluginInits?: Promise<unknown>[] })._pendingPluginInits;
  if (pending?.length) {
    await Promise.all(pending);
    delete (app as unknown as { _pendingPluginInits?: Promise<unknown>[] })._pendingPluginInits;
  }
}
```

The compiler is overruled at every touch point (including a `!` non-null assertion right after a `??=`), and the `createApp → initPluginRoutes → registerSpaFallback` ordering is enforced only by comments. Consumer: `writer/server.ts` (~lines 61–72) calls `createApp(...)` then `await initPluginRoutes(app)` then `registerSpaFallback(app, config)` — that sequence is unchanged.

Constraints: TS strict, double quotes, semicolons, JSDoc. Pre-release, 0 users — no migration concerns.

## Goals / Non-Goals

**Goals:**

- Remove all five `as unknown as` casts and the `_pendingPluginInits` property smuggling.
- Keep the exact same behavior: async registrars collected in `createApp()`, awaited by `initPluginRoutes()` before the SPA fallback registers.
- Zero public-API change — no signature change, no `createApp` return-type change.

**Non-Goals:**

- No change to `writer/server.ts` (the call sequence stays as is).
- No change to `createApp`'s return type (the WeakMap approach avoids it).
- No new tests unless the Step-0 sweep finds a test poking `_pendingPluginInits` directly.

## Decisions

### Decision: Module-level `WeakMap<Hono, Promise<unknown>[]>` keyed by app instance

Add near the top of `writer/app.ts`, after imports:

```ts
/**
 * Async plugin route registrations started in createApp, awaited by
 * initPluginRoutes. Keyed by app instance so concurrent createApp calls
 * (tests) don't share state; WeakMap entries die with the app.
 */
const pendingPluginInits = new WeakMap<Hono, Promise<unknown>[]>();
```

Write side becomes:

```ts
if (result instanceof Promise) {
  const pending = pendingPluginInits.get(app) ?? [];
  pending.push(result);
  pendingPluginInits.set(app, pending);
}
```

Read side becomes:

```ts
export async function initPluginRoutes(app: Hono): Promise<void> {
  const pending = pendingPluginInits.get(app);
  if (pending?.length) {
    await Promise.all(pending);
    pendingPluginInits.delete(app);
  }
}
```

Keep all existing JSDoc on `initPluginRoutes` and `registerSpaFallback`.

**Why a WeakMap over alternatives:**

- **Keyed by `app`** so concurrent `createApp()` calls in tests never share state — exactly the property the cast-on-instance approach also had, but now type-safe.
- **`WeakMap`** so entries are garbage-collected with their app; no manual lifetime management and no leak across test apps.
- **Alternative — a typed property on a `createApp`-local subclass / augmented Hono type:** rejected; it would change or widen the public `createApp` return type and still entangle transient state with the framework object.
- **Alternative — return the promise array from `createApp` and pass it to `initPluginRoutes`:** rejected; it changes `createApp`'s public signature and `server.ts`'s call sequence (an explicit Non-Goal).

## Risks / Trade-offs

- **[The cast sites don't match the documented excerpts (drift)]** → Run the drift check (`git diff` on `writer/app.ts` and `writer/server.ts` since the plan's base commit) first; on mismatch, STOP and report.
- **[Some non-test code outside `app.ts` reads `_pendingPluginInits`]** → Would mean the property is a wider contract than the audit found. The Step-0 sweep (`grep -rn "initPluginRoutes\|_pendingPluginInits" writer/ tests/ --include="*.ts"`) gates this; a hit outside `app.ts` is a STOP condition.
- **[A test pokes `_pendingPluginInits` directly]** → Rewrite it against the public sequence (`createApp → initPluginRoutes`); the behavior contract is unchanged.

## Migration Plan

1. Introduce the WeakMap; rewrite both the write and read sides. Verify `grep -n "_pendingPluginInits" writer/app.ts` and `grep -n "as unknown as" writer/app.ts` both return no matches.
2. Full gates: `deno check writer/server.ts && deno task test:backend && deno task fmt && deno task lint`.

The behavior contract (async registrars awaited before the SPA fallback registers) is already covered by existing plugin-route tests, which are the regression net. This is an internal type-hygiene change with no new runtime endpoint, so the green backend suite is the verification surface.

Rollback is a trivial revert of `writer/app.ts`.

## Dependency Ordering

This change is **independent** of the other three advisor changes. It touches only `writer/app.ts` and shares no files with `move-readtemplate-to-lib` (006, `lib`/`routes`), `extract-ws-request-wrapper` (007, frontend), or `unify-frontend-apierror` (009, frontend). It can land in any order relative to them.

## Open Questions

None. This is intended to be a trivially-green mechanical diff; anything else is a flag to report.
