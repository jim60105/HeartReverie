# Plugin Core

## Purpose

Plugin manifest format, loader, registry, and lifecycle management for extending the story system with modular capabilities.
## Requirements
### Requirement: Plugin manifest format

Each plugin SHALL have a `plugin.json` (or `plugin.yaml`) manifest file in its root directory. The manifest SHALL contain the following fields: `name` (string, unique identifier), `version` (semver string), `description` (string), `type` (one of `full-stack`, `prompt-only`, `frontend-only`, `hook-only`), `prompts` (array of relative paths to prompt files to contribute), `frontend` (array of relative paths to frontend ES module scripts), `frontendStyles` (array of relative paths to CSS files to inject into the frontend), `hooks` (array of declarative hook entries — see below), and `dependencies` (array of plugin names this plugin depends on). The `name` and `version` fields SHALL be required; all other fields SHALL be optional with sensible defaults (empty arrays/objects).

The `hooks` field, when present, SHALL be an array of declarative entries with the following shape. **The `hooks[]` array serves dual purposes**: (1) for ALL stages, it declares `reads`/`writes`/`note` annotations for the hook-inspector's conflict detection (C1 multi-write, C2 stale-read); (2) for stages in `PARALLEL_ALLOWED = {"prompt-assembly", "post-response", "response-stream"}`, it additionally declares `parallel`/`readOnly`/`concurrency`/`dependsOn` for the backend parallel-dispatch system. Any valid hook stage name MAY appear in `hooks[]`. Frontend hook subscriptions are enforced at SPA boot by `FrontendHookDispatcher.finalizeBoot()` (see the `plugin-hooks` capability).

```ts
interface PluginHookDeclaration {
  // stage can be any valid hook stage name.
  // Parallel-dispatch fields (parallel, readOnly, concurrency, dependsOn) are only meaningful
  // for stages in PARALLEL_ALLOWED; on other stages parallel:true is coerced to false.
  readonly stage: string;
  readonly priority?: number;              // suggested priority; runtime priority is set in register()
  readonly reads?: readonly string[];      // fields the handler reads (for stale-read detection)
  readonly writes?: readonly string[];     // fields the handler writes (for multi-write detection)
  readonly note?: string;                  // free-form note shown in the hook inspector tooltip

  // v1 additions — backend parallel dispatch declarations (only effective on PARALLEL_ALLOWED stages).
  readonly parallel?: boolean;             // opt in to parallel dispatch (default false)
  readonly readOnly?: boolean;             // self-declared read-only-by-contract for parallel
  readonly concurrency?: number;           // integer >= 1; min across stage's entries caps fan-out
  readonly dependsOn?: readonly string[];  // plugin names (cross-plugin within same stage)
}
```

The `hooks` field MAY be omitted (the plugin is treated as "undeclared" for conflict analysis and for parallel dispatch — see the `plugin-hooks` capability's "Parallel hook dispatch" requirement) OR supplied as `[]`. When present and non-empty, entries MAY target any valid hook stage; the plugin's manifest declaration set for PARALLEL_ALLOWED stages MUST match the subset of its actual `register()` calls that target PARALLEL_ALLOWED stages (see the "Hook declaration consistency check at plugin load" requirement). Non-PARALLEL_ALLOWED entries in `hooks[]` are informational (for hook-inspector annotations) and are not subject to the consistency cross-check. The previous schema describing `hooks` as `object mapping hook stage names to handler file paths` is removed; that shape was never implemented and is replaced by the imperative `register()` + declarative-metadata pattern described here.

The manifest validator SHALL reject `hooks[]` entries that:

- Lack a `stage` field, OR
- Specify a `note` longer than 200 characters, OR
- Specify a `reads` / `writes` entry that is not a non-empty string.

The manifest validator SHALL also reject any `hooks[]` array that contains two or more entries with the same `stage` value (one declaration per `(plugin, stage)` pair). This keeps the one-handler-per-`(plugin, stage)` invariant the conflict-detector relies on.

**Parallel-dispatch field constraints (v1)**: full normative semantics live in the `hook-parallel-dispatch` capability. Parallel-dispatch fields (`parallel`, `readOnly`, `concurrency`, `dependsOn`) are only meaningful for entries whose `stage` is in `PARALLEL_ALLOWED`. On entries with a non-PARALLEL_ALLOWED stage, `parallel: true` SHALL be coerced to `false` with `log.warn` containing `parallel:true is only allowed for stages in PARALLEL_ALLOWED`. Track B auto-promotion (`readOnly:true` without `parallel` → `parallel:true`) SHALL only apply to PARALLEL_ALLOWED stages. The v1 constraints for PARALLEL_ALLOWED entries:

- `parallel: true` SHALL require `readOnly: true` on the same entry. For `prompt-assembly` and `post-response`, missing `readOnly` with `parallel: true` SHALL coerce `parallel` to `false` with `log.warn`. For `response-stream`, missing `readOnly` with `parallel: true` SHALL be **rejected** (`log.error`) and the entry's `parallel` SHALL be set to `false` (the plugin SHALL still load).
- `readOnly: true` with `parallel` undefined SHALL be treated as `parallel: true` (Track B default-on; `log.debug`, not warn).
- `parallel: true` with `priority < 100` SHALL trigger a `log.warn` reminding the author that parallel handlers run after all serial handlers regardless of priority.
- `concurrency` SHALL be an integer `>= 1`; non-integer or `<1` values SHALL be coerced to `undefined` with `log.warn`.
- `dependsOn` SHALL be an array of plugin names. After all plugins have completed loading, the manager SHALL build a per-stage `(stage, plugin)` DAG; cycles or any unknown plugin name on a given stage SHALL cause **every** `dependsOn` declaration on that stage to be ignored (`log.error`), with that stage's parallel bucket falling back to priority-only ordering (stage-wide conservative fallback).

The JSON schema fragment used by the plugin manager for the `hooks[]` array SHALL enforce the field shape (the `stage` field accepts any string, not an enum):

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["stage"],
    "properties": {
      "stage": {
        "type": "string",
        "minLength": 1
      },
      "priority": { "type": "integer", "minimum": 0, "maximum": 1000 },
      "reads": { "type": "array", "items": { "type": "string", "minLength": 1 } },
      "writes": { "type": "array", "items": { "type": "string", "minLength": 1 } },
      "note": { "type": "string", "maxLength": 200 },
      "parallel": { "type": "boolean" },
      "readOnly": { "type": "boolean" },
      "concurrency": { "type": "integer", "minimum": 1 },
      "dependsOn": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true }
    }
  }
}
```

A manifest carrying any `hooks[]` entry whose `stage` is empty or missing SHALL be reported via `log.error` and that entry SHALL be dropped; remaining well-formed entries SHALL still be processed (a single malformed entry SHALL NOT abort the plugin load by itself, but failing the consistency check downstream still can).

#### Scenario: Valid full-stack plugin manifest

- **WHEN** a plugin directory contains a `plugin.json` with `name`, `version`, `type` set to `full-stack`, `prompts`, `frontend`, and `hooks` (as an array of declaration objects with valid `stage` values)
- **THEN** the loader SHALL parse the manifest and register the plugin with all declared capabilities

#### Scenario: Minimal prompt-only plugin manifest

- **WHEN** a plugin directory contains a `plugin.json` with only `name`, `version`, and `prompts` fields
- **THEN** the loader SHALL parse the manifest successfully, defaulting `type` to `prompt-only`, `frontend` to `[]`, `frontendStyles` to `[]`, `hooks` to `[]`, and `dependencies` to `[]`

#### Scenario: Invalid manifest missing required fields

- **WHEN** a plugin directory contains a `plugin.json` without a `name` or `version` field
- **THEN** the loader SHALL log an error identifying the plugin directory and the missing field(s), and SHALL skip loading that plugin

#### Scenario: YAML manifest format

- **WHEN** a plugin directory contains a `plugin.yaml` instead of `plugin.json`
- **THEN** the loader SHALL parse the YAML manifest identically to JSON and register the plugin

#### Scenario: Manifest declares frontendStyles

- **WHEN** a plugin directory contains a `plugin.json` with `"frontendStyles": ["styles.css"]` and the file exists within the plugin directory
- **THEN** the loader SHALL parse the manifest, record the CSS asset, and register the plugin with its declared stylesheets available for frontend injection

#### Scenario: hooks array carries reads and writes

- **WHEN** a plugin manifest contains `"hooks": [{"stage": "prompt-assembly", "priority": 50, "reads": [], "writes": ["previousContext"], "note": "Compacts older chapters"}]`
- **THEN** the manifest validator SHALL accept the field and the entry SHALL be returned by `GET /api/plugin-introspection/hooks` in the `manifestDeclarations` array

#### Scenario: hooks entry with duplicate stage is rejected

- **WHEN** a plugin manifest contains `"hooks": [{"stage": "prompt-assembly", "writes": ["foo"]}, {"stage": "prompt-assembly", "writes": ["bar"]}]`
- **THEN** the manifest validator SHALL reject the manifest and log an error identifying the duplicate `stage` value, because the one-handler-per-`(plugin, stage)` invariant is required for unambiguous conflict detection

#### Scenario: hooks entry missing stage rejected

- **WHEN** a plugin manifest contains `"hooks": [{"priority": 50, "writes": ["foo"]}]`
- **THEN** the manifest validator SHALL reject the manifest and log an error identifying the missing `stage` field

#### Scenario: hooks entry with non-PARALLEL_ALLOWED stage and parallel:true is coerced

- **WHEN** a plugin manifest contains `"hooks": [{"stage": "pre-write", "parallel": true, "readOnly": true}]` or `"hooks": [{"stage": "chapter:dom:ready", "parallel": true}]`
- **THEN** the manifest validator SHALL accept the entry (it is valid for introspection annotations)
- **AND** the validator SHALL coerce `parallel` to `false` with `log.warn` containing `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the entry SHALL appear in `GET /api/plugins`'s `hooks` array and in the hook-inspector's `manifestDeclarations`
- **AND** the plugin SHALL proceed to load normally

#### Scenario: Plugin with settingsSchema is discovered

- **WHEN** the plugin manager loads a plugin whose manifest contains a valid `settingsSchema` object
- **THEN** the plugin SHALL be flagged as having settings, and `GET /api/plugins` SHALL include `hasSettings: true` in that plugin's metadata

#### Scenario: Plugin without settingsSchema has no settings endpoints

- **WHEN** a client requests `GET /api/plugins/no-settings-plugin/settings`
- **THEN** the server SHALL respond with 404

#### Scenario: Plugin backend module registers custom routes

- **WHEN** a plugin's backend module exports a `registerRoutes(app, basePath)` function
- **THEN** the plugin manager SHALL call it during plugin loading, mounting routes at `/api/plugins/<pluginName>/`

#### Scenario: GET /api/plugins exposes hooks declarations

- **WHEN** a client requests `GET /api/plugins` and a plugin's manifest contains a non-empty `hooks` array
- **THEN** that plugin's entry in the response SHALL include the `hooks` array verbatim (including the v1-added `parallel`, `readOnly`, `concurrency`, and `dependsOn` fields when present) so the frontend can correlate manifest declarations with `frontendHooks.introspect()` results

#### Scenario: `HandlerIntrospection` includes `parallel` field

- **WHEN** a client calls `HookDispatcher.introspect()` on a stage with registered handlers
- **THEN** each `HandlerIntrospection` entry SHALL include a `parallel: boolean` field indicating whether the handler runs in the parallel bucket (`true`) or the serial bucket (`false`)

#### Scenario: parallel:true on a non-allowed stage is coerced

- **WHEN** a manifest declares `hooks: [{ stage: "pre-write", parallel: true, readOnly: true }]`
- **THEN** the validator SHALL coerce `parallel` to `false` with `log.warn` containing `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the entry SHALL be accepted for introspection annotations (reads/writes/note are preserved)
- **AND** no parallel dispatch SHALL occur for that stage

#### Scenario: parallel:true without readOnly:true is coerced on prompt-assembly and post-response

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", parallel: true }]` (no `readOnly`)
- **THEN** the validator SHALL coerce the entry to `parallel: false` and emit `log.warn` containing the phrase `parallel:true requires readOnly:true`

#### Scenario: parallel:true without readOnly:true on response-stream is rejected

- **WHEN** a manifest declares `hooks: [{ stage: "response-stream", parallel: true }]` (no `readOnly`)
- **THEN** the validator SHALL emit `log.error` containing the phrase `response-stream + parallel:true requires readOnly:true` and SHALL drop the parallel flag (the entry registers as `parallel: false`)
- **AND** the plugin SHALL still load successfully

#### Scenario: readOnly:true without parallel is auto-promoted (Track B)

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", readOnly: true }]`
- **THEN** the validator SHALL record the entry with effective `parallel: true` (Track B default-on)
- **AND** the validator SHALL NOT emit a `log.warn` for this auto-promotion (a `log.debug` is sufficient)

#### Scenario: parallel:true with priority < 100 triggers a warn

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true, priority: 50 }]`
- **THEN** the validator SHALL emit `log.warn` containing the phrase `parallel handlers run after all serial handlers regardless of priority`
- **AND** the entry SHALL still be registered with `parallel: true` (the warn is advisory)

#### Scenario: concurrency:0 is coerced to undefined

- **WHEN** a manifest declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true, concurrency: 0 }]`
- **THEN** the validator SHALL coerce `concurrency` to `undefined` and emit `log.warn` naming the plugin, stage, and rejected value
- **AND** the entry SHALL still register with `parallel: true`

#### Scenario: dependsOn cycle across plugins triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true, dependsOn: ["b"] }]`, plugin `b` declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true, dependsOn: ["a"] }]`, and plugin `c` declares `hooks: [{ stage: "post-response", parallel: true, readOnly: true, dependsOn: ["a"] }]` (well-formed edge)
- **WHEN** all plugins have finished loading and the manager finalises the dependency graph
- **THEN** the manager SHALL emit `log.error` identifying the cycle between `a` and `b`
- **AND** **every** `dependsOn` declaration on `post-response` (including `c`'s well-formed `c → a` edge) SHALL be ignored
- **AND** all three entries SHALL continue to register with `parallel: true` (the parallel flag is retained; only the dependency edges are dropped)
- **AND** dispatch ordering for `post-response`'s parallel bucket SHALL fall back to priority-asc only

#### Scenario: dependsOn referencing an unknown plugin triggers stage-wide priority-only fallback

- **GIVEN** plugin `a` declares `dependsOn: ["ghost"]` (no plugin `ghost` exists), and plugin `c` on the same stage declares a well-formed `dependsOn: ["b"]`
- **WHEN** the manager finalises the dependency graph
- **THEN** the manager SHALL emit `log.error` identifying plugin `a` and the unknown name `ghost`
- **AND** **every** `dependsOn` declaration for that stage (including `c → b`) SHALL be ignored
- **AND** all affected entries SHALL retain `parallel` / `readOnly`; the stage's parallel bucket SHALL run in priority-asc order only

#### Scenario: Frontend stage name in hooks[] is accepted for introspection

- **WHEN** a manifest declares `hooks: [{ stage: "chapter:dom:ready", reads: ["container"], note: "Annotates DOM nodes" }]` or `hooks: [{ stage: "chapter:dom:ready", parallel: true, readOnly: true }]`
- **THEN** the manifest validator SHALL accept the entry for introspection annotations (reads/writes/note are available to the hook-inspector)
- **AND** if `parallel: true` is present, it SHALL be coerced to `false` with `log.warn` (since `chapter:dom:ready` is not in PARALLEL_ALLOWED)
- **AND** the plugin's frontend hook subscription (if any) continues to be enforced at SPA boot by `FrontendHookDispatcher.finalizeBoot()`

The plugin manifest (`plugin.json`) SHALL support the following additional optional fields:

- `settingsSchema` — a JSON Schema object defining the plugin's configurable settings. When present, the plugin system SHALL expose settings API endpoints and the frontend SHALL render a settings page for this plugin.
- The backend module MAY export a `registerRoutes` function accepting `(app: Hono, basePath: string)` that registers custom HTTP routes under the plugin's namespace.

#### Scenario: Plugin with settingsSchema is discovered

- **WHEN** the plugin manager loads a plugin whose manifest contains a valid `settingsSchema` object
- **THEN** the plugin SHALL be flagged as having settings, and `GET /api/plugins` SHALL include `hasSettings: true` in that plugin's metadata

#### Scenario: Plugin without settingsSchema has no settings endpoints

- **WHEN** a client requests `GET /api/plugins/no-settings-plugin/settings`
- **THEN** the server SHALL respond with 404

#### Scenario: Plugin backend module registers custom routes

- **WHEN** a plugin's backend module exports a `registerRoutes(app, basePath)` function
- **THEN** the plugin manager SHALL call it during plugin loading, mounting routes at `/api/plugins/<pluginName>/`

#### Scenario: GET /api/plugins exposes hooks declarations

- **WHEN** a client requests `GET /api/plugins` and a plugin's manifest contains a non-empty `hooks` array
- **THEN** that plugin's entry in the response SHALL include the `hooks` array verbatim (including the v1-added `parallel`, `readOnly`, `concurrency`, and `dependsOn` fields when present) so the frontend can correlate manifest declarations with `frontendHooks.introspect()` results

### Requirement: Hook declaration consistency check at plugin load

When a plugin manifest contains a non-empty `hooks` array, the `PluginManager` SHALL compare the manifest's `hooks[]` entries against the subset of stages on which the plugin actually registers backend handlers during its `register(ctx)` execution that lie in `PARALLEL_ALLOWED = {"prompt-assembly", "post-response", "response-stream"}`. The comparison rules:

1. `declaredParallelAllowed = manifest.hooks.filter(h => PARALLEL_ALLOWED.has(h.stage)).map(h => h.stage)` — only PARALLEL_ALLOWED entries participate in this check. Non-PARALLEL_ALLOWED entries in `hooks[]` are informational (for hook-inspector annotations) and are excluded.
2. `registeredParallelAllowed = stages in PARALLEL_ALLOWED on which ctx.hooks.register(stage, …) was called during register(ctx)`
3. Mismatch if `symmetricDifference(declaredParallelAllowed, registeredParallelAllowed)` is non-empty.

Backend stages outside `PARALLEL_ALLOWED` (e.g. `pre-write`, the declarative `strip-tags` channel) and ALL frontend stages MAY appear in `hooks[]` for introspection annotations but SHALL be excluded from this consistency check entirely. The declarative `strip-tags` stage SHALL NOT be declared in `manifest.hooks[]` — strip-tag intent is conveyed via the existing `promptStripTags` / `displayStripTags` fields. Frontend `register()` cross-checking continues to be performed at SPA boot by `FrontendHookDispatcher.finalizeBoot()` and is specified in the `plugin-hooks` capability. Frontend `finalizeBoot` SHALL only flag `registeredOnly` mismatches when the plugin declares at least one frontend stage in `hooks[]` (no false alarms when `hooks[]` has only backend stages).

On mismatch, plugin loading SHALL fail with a thrown error whose message:

1. Names the plugin.
2. Lists every PARALLEL_ALLOWED stage declared in the manifest but not registered (`declaredOnly`).
3. Lists every PARALLEL_ALLOWED stage registered but not declared (`registeredOnly`).
4. Includes a one-line remediation hint suggesting the user add the registered stage(s) to `manifest.hooks[]` or remove the declared-only entries.

To make the load transactional, `PluginManager` SHALL collect `ctx.hooks.register(stage, …)` calls into a per-plugin staging buffer during the plugin's `register(ctx)` execution. Only after the consistency check passes SHALL the buffered registrations be committed to the live `HookDispatcher`. If the check fails (or any other error is thrown by `register(ctx)`), the staging buffer SHALL be discarded so that **no** backend handlers from the failing plugin appear in `HookDispatcher.introspect()`, AND the plugin SHALL NOT appear in the central plugin registry exposed by `GET /api/plugins`.

Plugins whose manifest omits the `hooks` field entirely (or supplies `hooks: []`) SHALL be exempt from this check — they are treated as "undeclared" and load without cross-checking.

This is a **breaking change**: parallel handlers now run after all serial handlers regardless of priority — any plugin relying on a low-priority parallel handler preempting a high-priority serial handler SHALL be updated. The `hooks[]` stage restriction is NOT a breaking change because all stages are now accepted. Built-in plugins shipped in the engine repository (`HeartReverie/plugins/context-compaction`, `dialogue-colorize`, `polish`, `response-notify`, `start-hints`, `thinking`, `user-message`) SHALL be updated in the same change that introduces this rule.

#### Scenario: Manifest declares hooks matching registrations
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "post-response"}]` and its backend `register(ctx)` calls `ctx.hooks.register("prompt-assembly", ...)` and `ctx.hooks.register("post-response", ...)`
- **THEN** plugin loading SHALL succeed and both handlers SHALL appear in `HookDispatcher.introspect()`

#### Scenario: Manifest declares stage not registered
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "post-response"}]` but its backend only calls `ctx.hooks.register("prompt-assembly", ...)`
- **THEN** plugin loading SHALL throw an `Error` naming the plugin and listing `declaredOnly: ["post-response"]`, the plugin SHALL NOT appear in the plugin registry, and `HookDispatcher.introspect()["prompt-assembly"]` SHALL NOT contain any handler from this plugin (the staged `prompt-assembly` registration is discarded)

#### Scenario: Plugin registers PARALLEL_ALLOWED stage not declared
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}]` but its backend calls `ctx.hooks.register("prompt-assembly", ...)` AND `ctx.hooks.register("response-stream", ...)`
- **THEN** plugin loading SHALL throw an `Error` naming the plugin and listing `registeredOnly: ["response-stream"]`, the plugin SHALL NOT appear in the plugin registry, and no handlers from this plugin SHALL appear in `HookDispatcher.introspect()`

#### Scenario: Plugin omits hooks entirely is exempt
- **WHEN** a plugin's manifest has no `hooks` field and its backend `register(ctx)` calls `ctx.hooks.register("post-response", ...)`
- **THEN** plugin loading SHALL succeed without cross-checking and the handler SHALL be committed

#### Scenario: Full-stack plugin registering non-PARALLEL_ALLOWED backend stage is unaffected
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}]` and its backend `register(ctx)` calls `ctx.hooks.register("prompt-assembly", ...)` AND `ctx.hooks.register("pre-write", ...)` (where `pre-write` is a known backend stage NOT in PARALLEL_ALLOWED)
- **THEN** the consistency check SHALL ignore the `pre-write` registration (it is outside PARALLEL_ALLOWED)
- **AND** the check SHALL pass because `declaredParallelAllowed = ["prompt-assembly"]` matches `registeredParallelAllowed = ["prompt-assembly"]`
- **AND** the plugin SHALL load successfully with both handlers committed to `HookDispatcher.introspect()`

#### Scenario: Manifest declares frontend stage in hooks[] — excluded from consistency check
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "chapter:dom:ready", reads: ["container"]}]` and its frontend ES module subscribes to `chapter:dom:ready`
- **THEN** the consistency check SHALL exclude the `chapter:dom:ready` entry (it is not in PARALLEL_ALLOWED) and operate only on `declaredParallelAllowed = ["prompt-assembly"]`; if the backend `register(ctx)` registers `prompt-assembly`, plugin loading SHALL succeed
- **AND** the `chapter:dom:ready` entry SHALL remain in the manifest's `hooks` array for hook-inspector introspection
- **AND** the frontend `chapter:dom:ready` subscription SHALL be enforced separately by `FrontendHookDispatcher.finalizeBoot()` (the consistency check at backend plugin load has no opinion on frontend handlers)

#### Scenario: strip-tags declared in hooks[] is accepted but excluded from consistency check
- **WHEN** a plugin's manifest declares `hooks: [{stage: "strip-tags", note: "Strips custom tags"}]`
- **THEN** the manifest validator SHALL accept the entry for introspection purposes
- **AND** the consistency check SHALL exclude it (not in PARALLEL_ALLOWED)
- **AND** the plugin author SHOULD still convey strip-tag intent via `promptStripTags` / `displayStripTags` fields for actual stripping behaviour

#### Scenario: Unknown stage declared in hooks[] is accepted for introspection
- **WHEN** a plugin's manifest declares `hooks: [{stage: "future-experimental-stage", writes: ["foo"]}, {stage: "prompt-assembly"}]`
- **THEN** the manifest validator SHALL accept both entries
- **AND** the `future-experimental-stage` entry SHALL be available for hook-inspector introspection but excluded from the consistency check (not in PARALLEL_ALLOWED)
- **AND** the consistency check SHALL operate only on `declaredParallelAllowed = ["prompt-assembly"]`

### Requirement: `hooks.register()` options-object overload

The plugin context's `hooks.register()` function SHALL accept the following signature:

```ts
type RegisterOptions = {
  priority?: number;                  // default 100
  parallel?: boolean;                 // overrides the manifest `hooks[]` entry's value for THIS handler
  readOnly?: boolean;                 // overrides the manifest entry's value for THIS handler
  dependsOn?: readonly string[];      // unioned with the manifest entry's `dependsOn` (never replaces)
};

function register(
  stage: HookStage,
  handler: HookHandler,
  priorityOrOptions?: number | RegisterOptions,
): void;
```

The dispatcher SHALL treat the third argument as follows:

- `undefined` → equivalent to `{ priority: 100 }`.
- `number` → equivalent to `{ priority: number }` (a thin shim; zero behaviour change from today's API).
- `RegisterOptions` object → per-handler override of the corresponding manifest `hooks[]` entry's defaults. The override SHALL be applied entry-by-entry: any field present on the options object SHALL replace the manifest-supplied value; any field absent SHALL fall back to the manifest value. `dependsOn` is the only field combined via union (manifest ∪ options); all other fields use replacement semantics.

The same allowlist + readOnly contract that gates manifest declarations SHALL apply to the options object at register time. Violations SHALL be coerced (or for `response-stream`, rejected) with the same log messages as the manifest validator emits.

#### Scenario: number form is equivalent to today's register API

- **GIVEN** a plugin calls `ctx.hooks.register("post-response", handler, 50)`
- **WHEN** the plugin manager wraps the registration
- **THEN** the resulting `HandlerEntry` SHALL have `priority: 50` and SHALL otherwise inherit `parallel` / `readOnly` / `dependsOn` from the manifest `hooks[]` entry (if any)
- **AND** dispatch behaviour SHALL be byte-identical to the legacy implementation when no manifest `hooks[]` entry exists

#### Scenario: Options object overrides manifest parallel default

- **GIVEN** the manifest declares `hooks: [{ stage: "post-response", readOnly: true }]` (Track B → effective `parallel: true`)
- **AND** the plugin calls `ctx.hooks.register("post-response", handler, { parallel: false })`
- **WHEN** the handler is dispatched
- **THEN** the handler SHALL run in the serial bucket (the options object's `parallel: false` overrides the manifest's implied `parallel: true`)

#### Scenario: Options object dependsOn is unioned with manifest dependsOn

- **GIVEN** the manifest entry declares `dependsOn: ["b"]` for stage `post-response`
- **AND** the plugin calls `ctx.hooks.register("post-response", handler, { parallel: true, readOnly: true, dependsOn: ["c"] })`
- **WHEN** the dependency graph is built
- **THEN** the resulting `HandlerEntry.dependsOn` SHALL be the set `{"b", "c"}`

#### Scenario: Options-object violation of allowlist coerces parallel:false

- **GIVEN** the plugin calls `ctx.hooks.register("pre-write", handler, { parallel: true, readOnly: true })`
- **WHEN** `register()` processes the options
- **THEN** the dispatcher SHALL emit `log.warn` containing `parallel:true is only allowed for stages in PARALLEL_ALLOWED`
- **AND** the resulting `HandlerEntry` SHALL have `parallel: false`

#### Scenario: Options-object violation on response-stream rejects (not coerces)

- **GIVEN** the plugin calls `ctx.hooks.register("response-stream", handler, { parallel: true })` (no `readOnly`)
- **WHEN** `register()` processes the options
- **THEN** the dispatcher SHALL emit `log.error` containing `response-stream + parallel:true requires readOnly:true`
- **AND** the resulting `HandlerEntry` SHALL have `parallel: false`

### Requirement: Plugin discovery and loading

The server SHALL scan the built-in plugins directory (`plugins/`) at startup to discover and load plugins. The server SHALL also scan an external plugin path specified by the `PLUGIN_DIR` environment variable if set. File system operations SHALL use Deno native APIs (`Deno.readDir()`, `Deno.readTextFile()`). Path operations SHALL use `@std/path`. Dynamic module loading SHALL use `import()` which is compatible in both Node.js and Deno. The frontend SHALL discover available plugins via a `GET /api/plugins` endpoint that returns the list of loaded plugins with their manifest metadata and enabled status. Frontend plugin loading SHALL be managed by a `usePlugins()` composable that handles discovery, dynamic import of `frontend.js` modules, and hook registration. The plugin contract (`export function register(hooks)` in `frontend.js`) SHALL remain unchanged for backward compatibility with existing plugin modules. The `initPlugins()` initialization logic SHALL move into the `usePlugins()` composable's initialization. The existing backend plugin directory structure SHALL remain unchanged — this refactor only affects frontend module loading.

#### Scenario: Built-in plugin discovery at startup
- **WHEN** the server starts and the `plugins/` directory contains subdirectories with valid `plugin.json` manifests
- **THEN** the server SHALL load each valid plugin using Deno file system APIs and register it in the plugin registry

#### Scenario: External plugin path discovery
- **WHEN** the `PLUGIN_DIR` environment variable is set to a directory path containing plugin subdirectories
- **THEN** the server SHALL scan that directory using `Deno.readDir()` and load plugins from it in addition to built-in plugins

#### Scenario: Frontend plugin loading via composable
- **WHEN** the Vue application initializes and calls `usePlugins()`
- **THEN** the composable SHALL fetch the plugin list from `GET /api/plugins`, dynamically import each enabled plugin's `frontend.js` module, and call `register(frontendHooks)` for each module, preserving the existing plugin contract

#### Scenario: Plugin contract preserved
- **WHEN** an existing plugin's `frontend.js` module exports `function register(hooks)` and the `usePlugins()` composable loads it
- **THEN** the composable SHALL call `register(frontendHooks)` with the `FrontendHookDispatcher` instance, maintaining full backward compatibility

#### Scenario: PLUGIN_DIR not set
- **WHEN** the `PLUGIN_DIR` environment variable is not set
- **THEN** the server SHALL load only built-in plugins from `plugins/` without error

#### Scenario: Frontend plugin discovery via API
- **WHEN** the frontend sends `GET /api/plugins`
- **THEN** the server SHALL return a JSON array of objects, each containing the plugin's `name`, `version`, `description`, `type`, and `enabled` status

#### Scenario: Plugin directory with no valid manifest
- **WHEN** a subdirectory in `plugins/` contains no `plugin.json` or `plugin.yaml`
- **THEN** the loader SHALL log a warning for that subdirectory and skip it without affecting other plugins

### Requirement: Plugin registry

The server SHALL maintain a central plugin registry object that tracks all loaded plugins, their manifest metadata, their enabled/disabled status, and provides lookup by plugin name. The registry SHALL prevent duplicate plugin names — if two plugins declare the same `name`, the second one encountered SHALL be rejected with a logged error.

#### Scenario: Lookup plugin by name
- **WHEN** a component requests a plugin by name from the registry
- **THEN** the registry SHALL return the plugin's manifest metadata and current status, or `null` if not found

#### Scenario: List all registered plugins
- **WHEN** a component requests the full plugin list from the registry
- **THEN** the registry SHALL return an array of all registered plugins with their metadata and status

#### Scenario: Duplicate plugin name rejection
- **WHEN** two plugin directories declare `"name": "my-plugin"` in their manifests
- **THEN** the registry SHALL load the first one encountered and reject the second with a logged error indicating the duplicate name and both directory paths

### Requirement: Plugin lifecycle

Each plugin SHALL follow an `init → enabled → disabled` lifecycle. Plugins SHALL be initialized (manifest parsed, handlers registered) during server startup. Plugins SHALL default to enabled after initialization. Plugins SHALL support being enabled or disabled at runtime. When a plugin is disabled, its hook handlers SHALL NOT be invoked and its frontend scripts SHALL NOT be served to clients. When re-enabled, its handlers SHALL resume being invoked.

#### Scenario: Plugin initialization at startup
- **WHEN** the server starts and loads a plugin with a valid manifest
- **THEN** the plugin SHALL transition to `enabled` state after successful initialization

#### Scenario: Disable a plugin at runtime
- **WHEN** a plugin is disabled via the registry API
- **THEN** the plugin's hook handlers SHALL NOT be invoked for any subsequent hook stage execution, and `GET /api/plugins` SHALL report its status as `disabled`

#### Scenario: Re-enable a disabled plugin
- **WHEN** a previously disabled plugin is re-enabled via the registry API
- **THEN** the plugin's hook handlers SHALL resume being invoked, and `GET /api/plugins` SHALL report its status as `enabled`

#### Scenario: Plugin initialization failure
- **WHEN** a plugin's initialization throws an error (e.g., missing dependency file)
- **THEN** the server SHALL log the error, mark the plugin as `disabled` in the registry, and continue loading other plugins

### Requirement: Plugin types

The plugin system SHALL support four plugin types that determine which capabilities a plugin provides: `full-stack` (contributes prompt fragments, frontend scripts, and optionally hooks), `prompt-only` (contributes only prompt fragments for the LLM), `frontend-only` (provides only frontend tag handlers and renderers), and `hook-only` (provides only lifecycle hook handlers without prompt or frontend contributions).

#### Scenario: Full-stack plugin provides all capabilities
- **WHEN** a plugin with `type: "full-stack"` is loaded
- **THEN** the system SHALL register its prompt fragments for prompt assembly, serve its frontend scripts via the plugin API, and register its hook handlers

#### Scenario: Prompt-only plugin contributes prompts
- **WHEN** a plugin with `type: "prompt-only"` is loaded
- **THEN** the system SHALL register its prompt fragments for prompt assembly and SHALL NOT expect or register frontend scripts or hook handlers beyond prompt-assembly

#### Scenario: Frontend-only plugin provides tag handlers
- **WHEN** a plugin with `type: "frontend-only"` is loaded
- **THEN** the system SHALL serve its frontend scripts and SHALL NOT expect prompt fragments

#### Scenario: Hook-only plugin provides lifecycle hooks
- **WHEN** a plugin with `type: "hook-only"` is loaded
- **THEN** the system SHALL register its hook handlers and SHALL NOT expect prompt fragments or frontend scripts

### Requirement: Built-in vs external plugins

Built-in plugins SHALL ship with the project in the `plugins/` directory. External plugins SHALL be loaded from the path specified by the `PLUGIN_DIR` environment variable. Both built-in and external plugins SHALL use an identical manifest format and registration process. Built-in plugins SHALL be loaded before external plugins to establish baseline functionality.

#### Scenario: Built-in plugins load first
- **WHEN** both built-in and external plugins are present
- **THEN** built-in plugins from `plugins/` SHALL be loaded and registered before external plugins from `PLUGIN_DIR`

#### Scenario: External plugin extends functionality
- **WHEN** an external plugin at `PLUGIN_DIR` has a valid manifest
- **THEN** it SHALL be loaded and registered using the same process as built-in plugins

#### Scenario: External plugin depends on built-in plugin
- **WHEN** an external plugin declares a dependency on a built-in plugin name
- **THEN** the dependency SHALL be resolved because built-in plugins are loaded first

### Requirement: Plugin isolation

Plugins SHALL NOT modify global state directly. Plugins SHALL interact with the system exclusively through the hook system and registry API. Plugin frontend scripts SHALL be loaded as ES modules with their own scope. Plugin prompt fragments SHALL be assembled by the hook system rather than directly modifying the system prompt template. In the Vue architecture, plugin frontend modules SHALL continue to be loaded as standard ES modules (not Vue components) to preserve the existing `register(hooks)` contract.

#### Scenario: Plugin uses hook system for interaction
- **WHEN** a plugin needs to contribute to prompt assembly
- **THEN** it SHALL register a `prompt-assembly` hook handler rather than directly modifying template files

#### Scenario: Plugin frontend scripts are scoped
- **WHEN** a plugin's frontend scripts are loaded by the `usePlugins()` composable
- **THEN** they SHALL be loaded as ES modules via dynamic `import()` and SHALL NOT pollute the global `window` namespace with unexported variables

#### Scenario: Plugin cannot directly modify registry internals
- **WHEN** a plugin attempts to modify another plugin's state
- **THEN** it SHALL only be able to do so through the registry's public API methods, not by direct object mutation

### Requirement: Strip tag pattern support

The system SHALL support both plain tag names and regex pattern strings in the `promptStripTags` and `displayStripTags` manifest fields. The `applyDisplayStrip()` function SHALL be implemented as a typed TypeScript function with explicit parameter and return types. ReDoS protection SHALL be preserved — all compiled regex patterns SHALL be validated for catastrophic backtracking potential.

#### Scenario: Plain tag name (existing behavior)
- **WHEN** a `promptStripTags` entry is a plain string (no leading `/`)
- **THEN** the system generates a regex pattern `<tagName>[\s\S]*?</tagName>` as before

#### Scenario: Regex pattern string
- **WHEN** a `promptStripTags` entry starts with `/` (e.g., `"/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"`)
- **THEN** the system extracts the inner pattern (stripping leading `/` and trailing `/flags`) and uses it directly in the combined regex

#### Scenario: Invalid regex pattern
- **WHEN** a `promptStripTags` entry starts with `/` but contains an invalid regex
- **THEN** the system logs a warning and skips the entry without crashing

#### Scenario: applyDisplayStrip typed function
- **WHEN** `applyDisplayStrip()` is called from a Vue component or composable
- **THEN** the function SHALL accept `(content: string, patterns: StripPattern[])` and return `string`, with full TypeScript type safety

### Requirement: Plugin frontend.js path compatibility

Plugin `frontend.js` modules SHALL be served at `/plugins/{name}/frontend.js` after the Vite migration. Built-in plugin `frontend.js` modules currently import from absolute paths such as `/js/utils.js` and `/js/chat-input.js`. After the Vite migration, raw source files will no longer be served at `/js/*` paths — the build output goes to `reader-dist/` with hashed filenames.

The server SHALL continue serving plugin `frontend.js` files at `/plugins/{name}/frontend.js` in both dev and production modes. Built-in plugin `frontend.js` modules SHALL be updated to remove `/js/*` imports and instead receive needed utilities (e.g., `escapeHtml`) through alternative means (inline implementation, shared module re-export, or hook context injection). This is a **BREAKING** change for any third-party plugins that import from `/js/*` paths.

The Vite dev server proxy SHALL forward `/plugins/*` requests to the Deno backend (already specified). No additional `/js/*` proxy route is required because built-in plugins will be updated to remove those imports.

#### Scenario: Built-in plugin `/js/*` imports removed
- **WHEN** the Vue/TypeScript migration is complete
- **THEN** all built-in plugin `frontend.js` modules (currently `status`, `options`, `state`, `thinking`) SHALL NOT import from `/js/utils.js`, `/js/chat-input.js`, or any other `/js/*` path

#### Scenario: Plugin frontend.js served at existing URL
- **WHEN** the frontend requests `import('/plugins/{name}/frontend.js')` in production (serving from `reader-dist/`)
- **THEN** the backend SHALL serve the plugin module from the `plugins/` directory at the same URL path as before

#### Scenario: Third-party plugin breakage documented
- **WHEN** a third-party plugin's `frontend.js` imports from `/js/utils.js` or other `/js/*` paths
- **THEN** the import SHALL fail with a 404 error; this is documented as a known breaking change in the migration

### Requirement: Plugin name identity preservation

Plugin manifest `name` fields and directory names SHALL remain unchanged during this refactor. The actual plugin names are: `status`, `options`, `state`, `thinking`, `context-compaction`, `de-robotization`, `imgthink`, `threshold-lord`, `t-task`, `user-message`, `writestyle`, `start-hints`. Delta specs and Vue components MAY use descriptive names (e.g., `StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue`) for component file names, but plugin manifests, directory names, and any code referencing plugin names (e.g., `/plugins/{name}/frontend.js`) SHALL use the original names.

#### Scenario: Plugin directory names unchanged
- **WHEN** the Vue refactor is complete
- **THEN** plugin directories SHALL remain `plugins/status/`, `plugins/options/`, `plugins/state/`, etc. — not renamed to `status-bar/`, `options-panel/`, or `variable-display/`

#### Scenario: New plugin directory names
- **WHEN** the prompt extraction is complete
- **THEN** one new plugin directory SHALL exist: `plugins/start-hints/`
- **AND** it SHALL contain a valid `plugin.json` with `name` matching the directory name

### Requirement: usePlugins composable

The `usePlugins()` composable SHALL manage frontend plugin lifecycle using Vue's Composition API. It SHALL expose: a reactive `plugins` ref containing the list of loaded plugin manifests, an `isLoaded` computed indicating whether plugin initialization is complete, and the `FrontendHookDispatcher` instance for use by rendering components. The composable SHALL use a shared singleton pattern so all components share the same plugin state. The composable SHALL encapsulate the full `initPlugins()` flow: fetching `GET /api/plugins`, dynamically importing each enabled plugin's `frontend.js`, and calling `register(frontendHooks)`.

#### Scenario: Composable initializes plugins on first use
- **WHEN** `usePlugins()` is called for the first time during Vue app initialization
- **THEN** it SHALL fetch the plugin list, dynamically import frontend modules, call `register(frontendHooks)` for each, and set `isLoaded` to `true`

#### Scenario: Subsequent calls return shared state
- **WHEN** `usePlugins()` is called from multiple components
- **THEN** all components SHALL receive the same reactive `plugins` ref and `FrontendHookDispatcher` instance without re-initializing

#### Scenario: Plugin loading error does not crash app
- **WHEN** a plugin's `frontend.js` module fails to import or its `register()` throws
- **THEN** the composable SHALL log the error and continue loading remaining plugins

### Requirement: Frontend module serving

The plugin routes SHALL serve frontend modules for registered plugins at `/plugins/${name}/${path}`. Additionally, the plugin routes SHALL serve shared utility modules from the `_shared` directory at `/plugins/_shared/*`, restricted to `.js` files with path containment enforcement. The shared module route SHALL be registered alongside plugin frontend module routes in `registerPluginRoutes()`.

#### Scenario: Serve plugin frontend module
- **WHEN** a registered plugin declares a `frontendModule` in its manifest
- **THEN** the server SHALL create a route at `/plugins/${plugin.name}/${routePath}` serving the module file with `Content-Type: application/javascript`

#### Scenario: Serve shared utility module
- **WHEN** the `_shared` directory exists under the built-in plugins directory
- **THEN** the server SHALL register a wildcard route at `/plugins/_shared/:path{.+}` serving `.js` files from that directory

#### Scenario: Containment check for shared modules
- **WHEN** a request to `/plugins/_shared/*` resolves to a path outside the `_shared` directory
- **THEN** the server SHALL respond with 404 and NOT serve the file

### Requirement: Plugin manifest action buttons field

Plugin manifests SHALL accept an optional `actionButtons` field at the top level of `plugin.json` / `plugin.yaml`. The value SHALL be an array of `ActionButtonDescriptor` objects, defaulting to `[]` when absent. Each descriptor SHALL have the required fields `id` (kebab-case identifier matching `^[a-z0-9-]+$`, unique within the plugin) and `label` (non-empty string of 1..40 characters after trim), and the optional fields `icon` (short emoji or symbol prefix), `tooltip` (string of up to 200 characters), `priority` (finite number, defaulting to 100, lower renders first), and `visibleWhen` (one of the literal strings `"last-chapter-backend"` or `"backend-only"`, defaulting to `"last-chapter-backend"`). Invalid descriptor entries SHALL be dropped individually with a logged warning while the rest of the plugin continues to load. Duplicate `id` values within a single plugin's `actionButtons` array SHALL keep the first occurrence and drop subsequent duplicates with a warning.

#### Scenario: Manifest declares actionButtons
- **WHEN** a plugin directory contains a `plugin.json` with `"actionButtons": [{ "id": "recompute-state", "label": "🧮 重算狀態" }]`
- **THEN** the loader SHALL parse the manifest, record the descriptor with defaults filled (`priority: 100`, `visibleWhen: "last-chapter-backend"`), and surface the descriptor on the plugin record so the `GET /api/plugins` payload includes it

#### Scenario: Manifest omits actionButtons
- **WHEN** a plugin directory contains a `plugin.json` without an `actionButtons` field
- **THEN** the loader SHALL default `actionButtons` to `[]` on the parsed plugin record and `GET /api/plugins` SHALL serialise `"actionButtons": []` for that plugin

#### Scenario: Invalid actionButtons entry is dropped per-entry
- **WHEN** a plugin's `actionButtons` array contains one valid entry and one entry whose `id` violates the kebab-case regex
- **THEN** the loader SHALL register the valid entry, drop the invalid one with a logged warning, and continue loading the rest of the plugin

#### Scenario: Duplicate id within actionButtons
- **WHEN** a plugin's `actionButtons` array declares two entries with the same `id`
- **THEN** the loader SHALL register only the first occurrence, drop subsequent duplicates, and log a warning

#### Scenario: Unknown visibleWhen value rejected
- **WHEN** an `actionButtons` entry sets `"visibleWhen": "always"` or any other value outside the v1 enum
- **THEN** the loader SHALL drop that entry with a warning and SHALL NOT default it silently to a different value

### Requirement: Plugin route registration

The plugin system SHALL allow backend modules to register custom HTTP routes by exporting a `registerRoutes(app, basePath)` function. The core SHALL mount these routes at `/api/plugins/:pluginName/` and SHALL apply passphrase authentication middleware to all plugin routes. Plugin routes SHALL NOT be able to escape their namespace prefix.

#### Scenario: Plugin route responds to request

- **WHEN** a plugin named `sd-webui-image-gen` registers a route handler for `GET /proxy/sd-models`
- **THEN** the route SHALL be accessible at `GET /api/plugins/sd-webui-image-gen/proxy/sd-models` with passphrase protection

#### Scenario: Plugin route isolated to namespace

- **WHEN** a plugin attempts to register a route at a path outside its namespace
- **THEN** the plugin manager SHALL prevent the route from being accessible outside `/api/plugins/<pluginName>/`

### Requirement: SPA fallback does not shadow async plugin routes

The SPA fallback (`app.get("*")` serving `index.html`) SHALL be registered only AFTER all async plugin routes are initialized via `initPluginRoutes()`. This ensures plugin GET routes registered during async `registerRoutes()` (which may use dynamic imports) take precedence over the catch-all fallback.

#### Scenario: Async plugin GET route takes precedence

- **GIVEN** a plugin whose `registerRoutes()` awaits a dynamic import before registering `GET /api/plugins/example/data`
- **WHEN** `initPluginRoutes(app)` completes and `registerSpaFallback(app, config)` is called afterward
- **THEN** `GET /api/plugins/example/data` returns the plugin's response (not 404 or index.html)

#### Scenario: Plugin POST routes unaffected (no regression)

- **GIVEN** plugin POST routes (which were never shadowed by GET catch-all)
- **WHEN** the SPA fallback is registered
- **THEN** POST routes continue to work as before

#### Scenario: Non-API paths still serve SPA

- **WHEN** a GET request is made to a non-API, non-asset path (e.g., `/settings/plugins/foo`)
- **THEN** the SPA fallback serves `index.html`

#### Scenario: Missing API routes return proper errors

- **WHEN** a GET request is made to an API-prefixed path that no route handles
- **THEN** the response is determined by Hono's notFound handler (not the SPA fallback serving index.html for API paths)

### Requirement: registerSpaFallback is a separate exported function

The SPA fallback registration SHALL be extracted from `createApp()` into an independently-callable `registerSpaFallback(app, config)` function exported from `writer/app.ts`.

#### Scenario: Called after initPluginRoutes in server.ts

- **GIVEN** the server startup sequence in `server.ts`
- **THEN** `registerSpaFallback(app, config)` is called after `await initPluginRoutes(app)` completes

### Requirement: Plugin promptFragments validate against SSTI whitelist at load time

During plugin discovery/initialization, the engine SHALL read each `promptFragments[].file` source and invoke `validateTemplate(fragmentSource)`. If the result is non-empty (any forbidden tokens detected), the plugin SHALL fail to load: the manager SHALL log an `error`-level message naming the plugin, the offending fragment file, and the offending expressions, and SHALL NOT register the plugin's hooks, settings, or fragments. Other plugins SHALL remain unaffected. Validation SHALL occur before any hook is registered so that a failed plugin leaves no observable side effects (no orphaned hooks, no settings entries, no introspection records).

#### Scenario: Plugin with unsafe fragment fails to load

- **GIVEN** a plugin manifest with `promptFragments[0].file` containing `{{> jsExpression }}`
- **WHEN** the plugin manager initializes
- **THEN** that plugin is not present in the active list
- **AND** an `error`-level log entry is emitted naming the plugin, file, and the unsafe fragment
- **AND** the plugin's hooks, settings, and fragment variables are NOT registered

#### Scenario: Sibling plugins remain active

- **GIVEN** plugin A has an unsafe fragment and plugin B is clean
- **WHEN** the plugin manager initializes
- **THEN** plugin B is loaded and functions normally
- **AND** plugin B's hooks register and dispatch as usual

### Requirement: Plugin promptFragments revalidate before each render

The engine SHALL invoke `validateTemplate(fragmentSource)` again immediately before composing each `promptFragments[]` source into the system prompt at render time. This catches the case where a fragment file on disk has been edited between plugin load and the current render (e.g. plugin author saving from their own editor, or a deployment hot-swap). If the validator detects forbidden tokens, the render SHALL skip that fragment, log a warning naming the plugin and file, and continue with remaining fragments.

#### Scenario: Fragment edited on disk after load is caught

- **GIVEN** a plugin loaded successfully with a clean fragment
- **AND** the fragment file is subsequently modified on disk to contain `{{ include "./x.md" }}`
- **WHEN** `renderSystemPrompt()` is invoked
- **THEN** the render skips that fragment
- **AND** a warning log entry names the plugin and the offending fragment
- **AND** the rest of the prompt renders without error

### Requirement: Plugin promptFragments are not writable from the template editor

The `PUT /api/templates` endpoint SHALL refuse any `templatePath` beginning with `plugin:` with status `403`. The plugin manifest contract SHALL state that plugin promptFragments are owned by the plugin author and MUST be edited in the plugin's source repository. The engine SHALL NOT provide any UI affordance for saving plugin-fragment overrides.

#### Scenario: PUT to plugin: path returns 403

- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "plugin:any-plugin:any-file.md"`
- **THEN** the response status is `403`
- **AND** no plugin file is modified

#### Scenario: Template editor UI hides save button for plugin entries

- **WHEN** the user selects a plugin-fragment entry in the template editor's left pane
- **THEN** the entry shows a "唯讀" (read-only) badge
- **AND** the save button is not rendered for that entry

