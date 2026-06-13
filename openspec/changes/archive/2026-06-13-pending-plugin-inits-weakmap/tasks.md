## 1. Pre-flight

- [x] 1.1 Run the drift check: `git -C HeartReverie diff --stat <base>..HEAD -- writer/app.ts writer/server.ts`. On any mismatch with the documented excerpts, STOP and report.
- [x] 1.2 Confirm the five cast sites match the excerpts (write side ~`app.ts:191-198`, read side ~`app.ts:238-245`). If they don't, STOP and report.
- [x] 1.3 Sweep for direct references: `grep -rn "initPluginRoutes\|_pendingPluginInits" writer/ tests/ --include="*.ts"`. If any non-test code outside `app.ts` reads `_pendingPluginInits`, STOP and report (the property would be a wider contract than the audit found). Note any test poking `_pendingPluginInits` directly.

## 2. Introduce the WeakMap and replace both sides

- [x] 2.1 In `writer/app.ts`, add a module-level `const pendingPluginInits = new WeakMap<Hono, Promise<unknown>[]>();` (near the top, after imports) with JSDoc explaining it is keyed by app instance so concurrent `createApp` calls don't share state and entries die with the app.
- [x] 2.2 Replace the write side in `createApp()`: `if (result instanceof Promise) { const pending = pendingPluginInits.get(app) ?? []; pending.push(result); pendingPluginInits.set(app, pending); }`.
- [x] 2.3 Replace the read side in `initPluginRoutes(app)`: `const pending = pendingPluginInits.get(app); if (pending?.length) { await Promise.all(pending); pendingPluginInits.delete(app); }`. Keep the existing JSDoc on `initPluginRoutes` and `registerSpaFallback`.
- [x] 2.4 If task 1.3 found a test poking `_pendingPluginInits` directly, rewrite it against the public sequence (`createApp` → `initPluginRoutes`). _(N/A — sweep found no test poking the property directly.)_
- [x] 2.5 Verify: `grep -n "_pendingPluginInits" writer/app.ts` → no matches; `grep -n "as unknown as" writer/app.ts` → no matches.

## 3. Verification gates

- [x] 3.1 `deno check writer/server.ts` → exit 0.
- [x] 3.2 `deno task test:backend` → all pass (existing plugin-route tests cover the "async registrars awaited before SPA fallback" contract; no new tests needed).
- [x] 3.3 `deno task fmt` and `deno task lint` → exit 0.
- [x] 3.4 Confirm `writer/server.ts` is unchanged (the `createApp → initPluginRoutes → registerSpaFallback` call sequence stays as is) and no files outside `writer/app.ts` (plus any rewritten test) were modified (`git status`).

## 4. Done criteria

- [x] 4.1 `grep -rn "_pendingPluginInits" writer/ tests/` returns no matches.
- [x] 4.2 `grep -c "as unknown as" writer/app.ts` returns 0.
- [x] 4.3 `deno task test:backend` exits 0.
- [x] 4.4 `deno task fmt` and `deno task lint` exit 0.
- [x] 4.5 No files outside the in-scope list modified.
