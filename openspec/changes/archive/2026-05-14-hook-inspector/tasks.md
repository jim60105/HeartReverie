## 1. Backend — HookDispatcher introspection + error counting

- [x] 1.1 Add a mutable `errorCount: number` field to the internal `HandlerEntry` type in `writer/lib/hooks.ts`; initialize to `0` on registration.
- [x] 1.2 In `HookDispatcher.dispatch()` catch block, increment the offending entry's `errorCount` before logging.
- [x] 1.3 Add public `HookDispatcher.introspect(): Record<HookStage, Array<{ plugin: string | undefined; priority: number; errorCount: number }>>` returning a deep-detached snapshot of all current entries sorted by priority ascending.
- [x] 1.4 Add unit tests in `writer/lib/hooks.test.ts`: introspect shape & ordering, errorCount increments per caught throw, repeated introspect calls are deep-equal, caller mutation does not leak into dispatcher state, existing dispatch behavior is unchanged.

## 2. Backend — Engine-owned PIPELINE_FIELDS module

- [x] 2.1 Create `writer/lib/hook-pipeline-fields.ts` exporting `PIPELINE_FIELDS` as `readonly Array<{ stage: string; field: string }>` initialized to `[{stage:"response-stream",field:"chunk"},{stage:"chat:send:before",field:"message"},{stage:"prompt-assembly",field:"previousContext"}]`. Add a top-level JSDoc comment stating: engine-owned, single source of truth, plugin manifests cannot override.
- [x] 2.2 Add unit tests in `writer/lib/hook-pipeline-fields.test.ts`: array contents match the required minimum set; attempting to mutate the exported array does not affect a fresh re-import (TypeScript `readonly` enforcement is compile-time, but assert that the exported value is `Object.isFrozen` or equivalent runtime guard).

## 3. Backend — Manifest schema + declare/register cross-check (transactional)

- [x] 3.1 Add `PluginHookDeclaration` interface to `writer/types.ts` and add an optional `hooks?: readonly PluginHookDeclaration[]` field to `PluginManifest` (alongside the existing fields). Document inline that the old "hooks: object mapping stage to handler path" shape is removed.
- [x] 3.2 Extend `PluginManager.#validateManifest` to validate the new `hooks` array: missing `stage` → reject; `stage === "strip-tags"` → reject with strip-tags-redirect hint; duplicate `stage` values within the same `hooks[]` → reject; unknown stage (not in `KNOWN_BACKEND_STAGES ∪ KNOWN_FRONTEND_STAGES`) → `log.warn` (do not reject); `note` longer than 200 chars → reject; non-string entries in `reads`/`writes` → reject. Default a missing `hooks` field to `[]` only when post-processing manifests for the listing response — keep the manifest distinguishable between "field absent" (undeclared) and "field present and empty".
- [x] 3.3 Implement transactional registration in `PluginManager.#loadBackendModule`:
    - (a) Wrap `ctx.hooks` in a staging proxy that records each `register(stage, handler, priority?)` call into a per-plugin `Map<HookStage, StagedEntry[]>` instead of forwarding to the live `HookDispatcher`. The proxy SHALL throw if the same `(plugin, stage)` pair is registered twice in one `register(ctx)` call (per the "Dispatchers reject duplicate registration per (plugin, stage)" requirement in `plugin-hooks`).
    - (b) Invoke `plugin.register(ctx)`; if it throws for any reason, discard the staging map and remove the plugin from `#plugins`.
    - (c) Compute `declaredBackend = manifest.hooks.map(h => h.stage).filter(s => s ∈ KNOWN_BACKEND_STAGES \ {"strip-tags"})` and `registeredBackend = staging.keys()`. When `manifest.hooks` is non-empty and the symmetric difference is non-empty, throw a load error whose message contains `declaredOnly: [...]` and `registeredOnly: [...]`, discard the staging map, and remove the plugin from `#plugins`.
    - (d) On success, replay each staged registration into the real `HookDispatcher` exactly once.
- [x] 3.4 Add unit tests in `writer/lib/plugin-manager.test.ts`: valid declarations load; declared-only mismatch fails with `declaredOnly: [...]` text AND `HookDispatcher.introspect()` contains no handler from the failed plugin AND `#plugins` does not contain it; registered-only mismatch fails analogously; manifest with no `hooks` field loads regardless of register calls; manifest with `hooks: []` loads regardless of register calls; unknown-stage entry logs warn but does not block load and does not contribute to the strict check (e.g. declaring an unknown stage while registering `prompt-assembly` still loads cleanly); duplicate `stage` in `hooks[]` is rejected at manifest validation; `strip-tags` in `hooks[]` is rejected at manifest validation; full-stack plugin declaring both backend and frontend stages loads cleanly when only backend stages are registered by the backend module; `register(ctx)` throwing for any other reason still removes the plugin from `#plugins`.
- [x] 3.5 Update `GET /api/plugins` response shape to include the verbatim `hooks` array per plugin entry (defaulting to `[]` when the manifest omits the field). Add a route test asserting (a) declared array is serialized verbatim, (b) plugins without `hooks` field show `hooks: []`, (c) the response carries manifest declarations and NOT runtime priorities/errorCounts (those live only under `/api/plugin-introspection/hooks`).

## 4. Backend — Strip-tag declarations helper

- [x] 4.1 Add `PluginManager.getStripTagDeclarations(): Array<{ plugin: string; tags: string[]; scope: "prompt+display" | "prompt" | "display" }>` deriving from existing manifest data without recomputation cost on every introspect call.
- [x] 4.2 Add a test asserting it reports the correct plugin → tags mapping for at least one built-in strip-tag plugin (e.g. `options`).

## 5. Backend — Introspection HTTP route

- [x] 5.1 Create `writer/routes/plugin-introspect.ts` exporting `registerPluginIntrospectRoutes(app, deps)` that mounts `GET /api/plugin-introspection/hooks` and joins `HookDispatcher.introspect()` × manifest declarations × `getStripTagDeclarations()` × `PIPELINE_FIELDS` into the response shape required by the spec.
- [x] 5.2 Register the new route in `writer/app.ts` AFTER the existing passphrase middleware so the new route inherits passphrase gating; explicitly assert in code review that the namespace `/api/plugin-introspection/*` is disjoint from `/api/plugins/*`.
- [x] 5.3 Add route tests in `writer/routes/plugin-introspect.test.ts`: missing passphrase → 401; valid passphrase → 200; response keys include `backend`, `manifestDeclarations`, `stripTags`, `pipelineFields`, `generatedAt`; `pipelineFields` equals `PIPELINE_FIELDS`; loading a plugin named `_introspect` does NOT shadow the route.
- [x] 5.4 Share a `lib/introspection-dump.ts` helper invoked by both the HTTP route and the CLI (task 7.1) so the JSON shape is single-sourced; add a unit test asserting the shape returned by the helper matches the route response for a fixture plugin set.

## 6. Backend — Built-in plugin manifest updates

- [x] 6.1 Update built-in plugin manifests under `HeartReverie/plugins/*/plugin.json` to add a `hooks: [...]` array matching the stages each plugin actually registers. The exact set today is:
    - `context-compaction` — `[{stage: "prompt-assembly", reads: [], writes: ["previousContext"]}]` (see `plugins/context-compaction/handler.ts:28`)
    - `user-message` — `[{stage: "pre-write", reads: [], writes: ["preContent"]}]` (see `plugins/user-message/handler.ts:25`)
    - `thinking` — `[{stage: "frontend-render", reads: ["text"], writes: ["text", "placeholderMap"]}]` (see `plugins/thinking/frontend.js:21`)
    - `response-notify` — `[{stage: "notification"}]` (see `plugins/response-notify/frontend.js:19`)
    - `dialogue-colorize` — two `hooks[]` entries for the two `register()` sites at `plugins/dialogue-colorize/frontend.js:214,242` (likely `frontend-render` + `chapter:dom:ready`; verify against the file before submitting)
    - `polish` — `[{stage: "action-button:click"}]` (see `plugins/polish/frontend.js:17`)
    - `start-hints` — verify against source (frontend-only plugin)
    Plugins whose `register()` call set does not match the above SHALL have the manifest amended accordingly; `_shared/` is NOT a plugin and SHALL NOT receive a manifest update.
- [x] 6.2 Run `scripts/podman-build-run.sh` and confirm `podman logs heartreverie` contains no `Plugin ... hook declarations do not match registration` error.
- [x] 6.3 Commit the manifest changes together with the validator change so the engine never lands in a state where a built-in plugin fails the new check.

## 7. Backend — Deno CLI task

- [x] 7.1 Create `scripts/introspect-hooks.ts` that boots a minimal `PluginManager` (no HTTP server), calls the shared `lib/introspection-dump.ts` helper, writes the resulting JSON to stdout, and exits `0`. Guard against logging the passphrase or any other env value.
- [x] 7.2 Add `tasks.introspect:hooks` to `deno.json` invoking `deno run -A scripts/introspect-hooks.ts`.
- [x] 7.3 Add `scripts/__tests__/introspect-hooks.test.ts` asserting (a) the JSON shape matches the HTTP route response for a fixture plugin set, (b) exit code is `0`, (c) stderr and stdout do not contain the passphrase even when `PASSPHRASE` env is set to a recognizable sentinel.

## 8. Frontend — FrontendHookDispatcher introspection + async-reject + boot check

- [x] 8.1 In `reader-src/src/lib/plugin-hooks.ts`, add a per-entry mutable `errorCount` field, increment it in the dispatch catch block, and add `introspect(): Record<HookStage, Array<{ plugin: string | undefined; priority: number; errorCount: number }>>` matching the backend contract.
- [x] 8.2 In `FrontendHookDispatcher.register()`, when `stage !== "action-button:click"` AND `handler.constructor.name === "AsyncFunction"`, throw an `Error` whose message includes the stage name, plugin (if known), and the migration hint `register(stage, (ctx) => { void doAsync(ctx).catch(log.error); })`.
- [x] 8.3 Register `hook-inspector:report` as a new fan-out stage in `VALID_FRONTEND_STAGES`.
- [x] 8.4 Reject duplicate `(plugin, stage)` registrations: when `register(stage, handler, priority?, originPluginName?)` is called and the dispatcher already holds an entry for the same `(originPluginName, stage)` pair, throw an `Error` naming the plugin and stage. Add a test.
- [x] 8.5 Add `FrontendHookDispatcher.finalizeBoot()` invoked exactly once by `useBootstrap()` after every plugin has finished `register(hooks)`. Compute `declaredFrontend = manifest.hooks.filter(stage ∈ KNOWN_FRONTEND_STAGES)` and `registeredFrontend = actual register stages observed via the per-plugin proxy`, take the symmetric difference, and surface mismatches via an error banner AND a `bootMismatches` payload that the inspector page reads on next refresh. MUST NOT throw.
- [x] 8.6 Add unit tests in `reader-src/src/lib/plugin-hooks.test.ts`: introspect shape; async-reject throws with required message; sync handler accepted; `action-button:click` async accepted; duplicate `(plugin, stage)` registration throws; `finalizeBoot()` correctly identifies declared-only and registered-only mismatches; `finalizeBoot()` exempts plugins whose manifests omit `hooks`; `finalizeBoot()` ignores declared backend-stage entries for full-stack plugins (e.g. a manifest declaring `prompt-assembly + frontend-render` with only `frontend-render` registered in frontend.js produces no mismatch).

## 9. Frontend — Conflict-detection lib

- [x] 9.1 Create `reader-src/src/lib/hook-inspector.ts` exporting `mergeFrontendDeclarations(clientIntrospect, manifestDeclarations): Record<string, HandlerInfo[]>` and `detectConflicts(serverIntrospect, frontendEnriched): ConflictReport[]`. Implement C1, C2, C3, C4 per the spec.
- [x] 9.2 Add unit tests in `reader-src/src/lib/hook-inspector.test.ts` covering: C1 multi-write (positive and pipelineFields-allowlisted negative); C2 stale-read (positive cross-plugin, including when the field IS on the pipelineFields list — C2 still fires); **C2 same-plugin reader/writer is NOT flagged** (the heuristic skips `reader.plugin === writer.plugin`); C3 same-priority (positive); C4 runtime-error (positive); `reads === null` and `writes === null` handlers do not produce C1/C2; `mergeFrontendDeclarations` joins by `(plugin, stage)` with proper handling of unknown stages.

## 10. Frontend — Types

- [x] 10.1 Create `reader-src/src/types/hook-inspector.ts` exporting `HookInspectorReport`, `HandlerInfo`, `ConflictReport`, and `PipelineFieldRef`. Re-export from the `@/types` barrel.
- [x] 10.2 Update `@/types/index.ts` to extend the `FrontendHookContextMap` (or equivalent dispatched-context registry) with `"hook-inspector:report": HookInspectorReport`.

## 11. Frontend — Inspector UI

- [x] 11.1 Create `reader-src/src/components/HookInspectorPage.vue` per `design.md §D6` and the `hook-inspector` capability requirements. Fetch via `useAuth().getAuthHeaders()`; surface fetch errors; expose a Refresh button.
- [x] 11.2 Create `reader-src/src/components/hook-inspector/StageBlock.vue` (collapsible per-stage section) and `HandlerRow.vue` (per-handler row with priority, plugin name, declared reads/writes badges, errorCount badge labelled "自上次重啟以來").
- [x] 11.3 After detection completes, call `frontendHooks.dispatch("hook-inspector:report", payload)` with the typed payload conforming to `HookInspectorReport`.
- [x] 11.4 Add component tests in `reader-src/src/components/__tests__/HookInspectorPage.spec.ts`: renders backend stage blocks; assert request carries `X-Passphrase` (mock `useAuth`); 401 surfaces a passphrase error message; Refresh re-fetches and re-emits the event; errorCount badge includes the "自上次重啟以來" text.

## 12. Frontend — Router and sidebar grouping

- [x] 12.1 Add `{ path: "hook-inspector", name: "settings-hook-inspector", component: () => import("@/components/HookInspectorPage.vue"), meta: { title: "Hook 檢視", category: "developer-tools" } }` to `settingsChildren` in `reader-src/src/router/index.ts`.
- [x] 12.2 Update `SettingsLayout.vue` to bucket sibling routes by `meta.category`, rendering a "一般 / General" group for the default category and a "開發者工具 / Developer Tools" group for `developer-tools`. Within each group, preserve the route-children definition order.
- [x] 12.3 Add a test asserting the sidebar renders the two groups in the correct order and that the Hook Inspector link is placed inside the developer-tools group.

## 13. Documentation

- [x] 13.1 Add a "Hook Inspector" section to `HeartReverie/docs/plugin-system/plugin-system.md` describing the `hooks[]` manifest field, declare/register strictness, the developer-tools sidebar group, the `deno task introspect:hooks` CLI, and the `hook-inspector:report` typed event.
- [x] 13.2 Document the breaking changes in the change's `proposal.md` (already done) AND add a one-page migration appendix to `HeartReverie/docs/plugin-system/migration-hook-inspector.md` enumerating affected built-in plugins and the manifest snippet each one needs.
- [x] 13.3 Update `HeartReverie/.agents/skills/heartreverie-create-plugin/SKILL.md` to make `hooks[]` declaration mandatory (was "recommended") and add the async-handler wrapping example to the SKILL's "common pitfalls" section.

## 14. Companion plugin (cross-repo)

- [x] 14.1 In a separate OpenSpec change under `HeartReverie_Plugins/openspec/changes/hook-inspector-logger`, scaffold the `hook-inspector-logger` plugin: manifest with `hooks: [{stage: "hook-inspector:report"}]`, frontend module that subscribes to the event and writes one notification per dispatch. This is tracked separately so the engine change can ship independently if the plugins repo is not yet ready.
- [x] 14.2 Note in the engine change's release notes that the companion change exists and is the canonical e2e verification of the typed event.

## 15. Mandatory integration verification

- [x] 15.1 Run `cd HeartReverie/ && scripts/podman-build-run.sh` and confirm the build succeeds.
- [x] 15.2 `podman logs heartreverie 2>&1 | grep -i "error\|warn"` SHALL show no new errors and no `Plugin ... hook declarations do not match registration` messages.
- [x] 15.3 `curl -H "X-Passphrase: $PASSPHRASE" http://localhost:8080/api/plugin-introspection/hooks` SHALL return HTTP 200 with the JSON keys `backend`, `manifestDeclarations`, `stripTags`, `pipelineFields`, `generatedAt`.
- [x] 15.4 `podman exec heartreverie deno task introspect:hooks | jq '.backend | keys'` SHALL list the backend stage names and the structure SHALL deep-equal a section of the HTTP route's response when run against the same plugin set.
- [x] 15.5 Use `functions.skill(agent-browser)` to visit `http://localhost:8080/settings/hook-inspector` after entering the passphrase, confirm the page lists stages and handlers, and confirm a registered consumer of `hook-inspector:report` (if `hook-inspector-logger` is loaded) emits a notification within a Refresh cycle.
- [x] 15.6 Negative-path verification: temporarily edit a built-in plugin manifest to declare a stage the plugin doesn't register, rebuild, observe the load-error log message with `declaredOnly` text, then revert.
