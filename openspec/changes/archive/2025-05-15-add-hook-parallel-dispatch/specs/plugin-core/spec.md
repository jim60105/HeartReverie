## MODIFIED Requirements

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

## ADDED Requirements

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
