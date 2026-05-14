## Why

Plugin authors and core engineers have no visibility into the actual hook subscriptions live in the running engine. When two plugins both write to `previousContext`, or a low-priority handler reads a field that a higher-priority handler will later overwrite, the only feedback is silently-wrong prompts at runtime. Manifest declarations of hook usage do not exist today — every contract between plugins is implicit and discovered by reading source. We need a writer-mode developer tool that surfaces the live hook graph, statically detects the most common conflict patterns, and counts runtime handler errors that today disappear into logs.

Now is the right moment because the plugin set is growing (sd-webui image generation, context compaction, options, prompt-debugger pipeline) and hook-stage fan-in fields (`previousContext`, `chunk`, `preContent`, `message`, `text`/`placeholderMap`) are being mutated by more than one plugin per stage in production.

## What Changes

- Add `HookDispatcher.introspect()` and `FrontendHookDispatcher.introspect()` returning per-stage handler lists with `{plugin, priority, errorCount}`.
- Count handler exceptions in-process (no persistence) on both dispatchers and expose via `introspect()`.
- Introduce optional `PluginManifest.hooks: Array<{stage, priority?, reads?, writes?, note?}>` for declarative hook metadata.
- **BREAKING**: When a plugin's manifest `hooks` declaration set disagrees with the stages actually registered via `hooks.register()` (backend or frontend), `PluginManager` rejects the plugin at load time with an error naming the mismatched stages. Manifests with no `hooks` field remain accepted (treated as "undeclared").
- **BREAKING**: `FrontendHookDispatcher.register()` throws synchronously when the handler is an `AsyncFunction` and the stage is not `action-button:click`. Replaces today's documented-only limitation.
- New `GET /api/plugin-introspection/hooks` route (passphrase-gated, isolated from `/api/plugins/*` namespace to prevent plugin name shadowing) returning backend-registered handlers, all manifest hook declarations, strip-tag declarations, and an engine-owned `pipelineFields` allowlist.
- New engine-owned module `writer/lib/hook-pipeline-fields.ts` exporting `PIPELINE_FIELDS` (the (stage, field) pairs where multi-write is intended pipeline semantics — `response-stream::chunk`, `chat:send:before::message`, `prompt-assembly::previousContext`). Plugin manifests cannot extend or override this list.
- New `deno task introspect:hooks` CLI script (`scripts/introspect-hooks.ts`) producing JSON equivalent to the HTTP response on stdout for CI usage.
- New writer-mode UI at `/settings/hook-inspector` showing every stage's handlers, computed conflicts (C1 multi-write, C2 stale-read, C3 same-priority, C4 runtime-error), and an in-memory error counter labelled "since last restart".
- Side-nav reorganisation: introduce a new "開發者工具 (Developer Tools)" category in `SettingsLayout.vue` for the inspector and future debug tools. No `?dev=1` flag — passphrase remains the sole auth boundary.
- New typed frontend event `hook-inspector:report` emitted after each conflict-detection pass, with payload type exported from `reader-src/src/types/hook-inspector.ts`.
- New companion plugin in `HeartReverie_Plugins/` (`hook-inspector-logger`) consuming `hook-inspector:report` as an e2e subscriber and reference example.
- Built-in plugins under `HeartReverie/plugins/` (`context-compaction`, `dialogue-colorize`, `polish`, `response-notify`, `start-hints`, `thinking`, `user-message`) gain `hooks` manifest entries matching their actual `register()` calls so they still load under the new strict mismatch rule. The shared `_shared/` directory is not a plugin and is unaffected.

## Capabilities

### New Capabilities
- `hook-inspector`: writer-mode introspection HTTP route, CLI task, conflict heuristics, and developer-tools settings page covering live hook graph visibility.

### Modified Capabilities
- `plugin-hooks`: add `HookDispatcher.introspect()`, `FrontendHookDispatcher.introspect()`, per-entry `errorCount` counting, **breaking** async-handler register-time rejection for non-`action-button:click` stages.
- `plugin-core`: add `PluginManifest.hooks` schema, **breaking** declare-vs-register mismatch as a load-time error (backend transactional registration with rollback on failure), and serialize the declarations in any existing plugin-listing responses.
- `settings-page`: add `/settings/hook-inspector` child route, a `meta.category` field on `settingsChildren` entries, and a "Developer Tools" sidebar grouping rendered in `SettingsLayout.vue`.
- `writer-backend`: clarify that `GET /api/plugins[].hooks` is the manifest declaration array (per the new `PluginHookDeclaration` shape) rather than runtime-registered hooks; runtime facts live exclusively under `/api/plugin-introspection/hooks`.

## Impact

- Affected code:
  - `HeartReverie/writer/lib/hooks.ts` (introspect + errorCount)
  - `HeartReverie/writer/lib/plugin-manager.ts` (manifest validation, mismatch error, strip-tag declarations getter)
  - `HeartReverie/writer/lib/hook-pipeline-fields.ts` (new, engine-owned constant)
  - `HeartReverie/writer/types.ts` (`PluginManifest.hooks`, `PluginHookDeclaration`)
  - `HeartReverie/writer/routes/plugin-introspect.ts` (new)
  - `HeartReverie/writer/app.ts` (route registration)
  - `HeartReverie/scripts/introspect-hooks.ts` (new), `deno.json` task entry
  - `HeartReverie/reader-src/src/lib/plugin-hooks.ts` (`introspect`, async-reject)
  - `HeartReverie/reader-src/src/lib/hook-inspector.ts` (new, pure conflict detection)
  - `HeartReverie/reader-src/src/types/hook-inspector.ts` (new typed event)
  - `HeartReverie/reader-src/src/components/HookInspectorPage.vue` + `hook-inspector/StageBlock.vue` + `hook-inspector/HandlerRow.vue` (new)
  - `HeartReverie/reader-src/src/components/SettingsLayout.vue` (sidebar grouping by `meta.category`)
  - `HeartReverie/reader-src/src/router/index.ts` (new `settingsChildren` entry)
  - Built-in plugin manifests under `HeartReverie/plugins/*/manifest.json` (add `hooks` declarations to satisfy strict validation)
- New companion plugin: `HeartReverie_Plugins/hook-inspector-logger/` (separate repo, tracked under `HeartReverie_Plugins/openspec/changes/`).
- No new dependencies (no `vis-network` — v1 stays table-based).
- BREAKING for plugin authors: any plugin (built-in or community) that registers hooks without declaring them in the manifest must add `hooks: [...]` entries; any plugin that subscribes to a non-`action-button:click` frontend stage with `async (ctx) => …` must rewrite to `(ctx) => { void doAsync(ctx).catch(...) }`. Release notes (this proposal) list every affected built-in plugin and its required manifest patch.
- Performance: in-memory `errorCount++` adds a single integer write per caught exception. No persistence, no file I/O on the dispatch hot path. CLI script is on-demand.
- Security: introspect route reuses `verifyPassphrase` middleware; namespace `/api/plugin-introspection/*` cannot be shadowed by a plugin named `_introspect` because plugin routes mount under `/api/plugins/<name>` only.
