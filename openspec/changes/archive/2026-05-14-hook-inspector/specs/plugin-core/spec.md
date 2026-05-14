## ADDED Requirements

### Requirement: Hook declaration consistency check at plugin load

When a plugin manifest contains a non-empty `hooks` array, the `PluginManager` SHALL compare the **backend-stage subset** of the manifest's `hooks[]` entries against the set of stages on which the plugin actually registers backend handlers during its `register(ctx)` execution. The comparison rules:

1. `declaredBackend = manifest.hooks.map(h => h.stage).filter(s => s ∈ KNOWN_BACKEND_STAGES \ {"strip-tags"})`
2. `registeredBackend = stages on which ctx.hooks.register(stage, …) was called during register(ctx)`
3. Mismatch if `symmetricDifference(declaredBackend, registeredBackend)` is non-empty.

Stages outside `KNOWN_BACKEND_STAGES` (frontend stages enforced by `FrontendHookDispatcher.finalizeBoot()`, declarative `strip-tags`, unknown future stages) SHALL be ignored by this check. The declarative `strip-tags` stage SHALL NOT be declared in `manifest.hooks[]` — strip-tag intent is conveyed via the existing `promptStripTags` / `displayStripTags` fields. Unknown stage values pass through manifest validation with a `log.warn` (forward-compatible with future stages) and SHALL be omitted from both `declaredBackend` and the strict comparison so that adding a new stage to a manifest does not require simultaneous engine support.

On mismatch, plugin loading SHALL fail with a thrown error whose message:

1. Names the plugin.
2. Lists every backend stage declared in the manifest but not registered (`declaredOnly`).
3. Lists every backend stage registered but not declared (`registeredOnly`).
4. Includes a one-line remediation hint suggesting the user add the registered stage(s) to `manifest.hooks[]` or remove the declared-only entries.

To make the load transactional, `PluginManager` SHALL collect `ctx.hooks.register(stage, …)` calls into a per-plugin staging buffer during the plugin's `register(ctx)` execution. Only after the consistency check passes SHALL the buffered registrations be committed to the live `HookDispatcher`. If the check fails (or any other error is thrown by `register(ctx)`), the staging buffer SHALL be discarded so that **no** backend handlers from the failing plugin appear in `HookDispatcher.introspect()`, AND the plugin SHALL NOT appear in the central plugin registry exposed by `GET /api/plugins`.

Plugins whose manifest omits the `hooks` field entirely (or supplies `hooks: []`) SHALL be exempt from this check — they are treated as "undeclared" and load without cross-checking. Frontend `register()` cross-checking is performed at SPA boot by `FrontendHookDispatcher.finalizeBoot()` and is specified in the `plugin-hooks` capability.

This is a **breaking change**: any built-in or community plugin that declares `hooks[]` but registers a different set of backend stages SHALL be repaired before its image is deployed against the new engine. Built-in plugins shipped in the engine repository (`HeartReverie/plugins/context-compaction`, `dialogue-colorize`, `polish`, `response-notify`, `start-hints`, `thinking`, `user-message`) SHALL be updated in the same change that introduces this rule.

#### Scenario: Manifest declares hooks matching registrations
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "post-response"}]` and its backend `register(ctx)` calls `ctx.hooks.register("prompt-assembly", ...)` and `ctx.hooks.register("post-response", ...)`
- **THEN** plugin loading SHALL succeed and both handlers SHALL appear in `HookDispatcher.introspect()`

#### Scenario: Manifest declares stage not registered
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "post-response"}]` but its backend only calls `ctx.hooks.register("prompt-assembly", ...)`
- **THEN** plugin loading SHALL throw an `Error` naming the plugin and listing `declaredOnly: ["post-response"]`, the plugin SHALL NOT appear in the plugin registry, and `HookDispatcher.introspect()["prompt-assembly"]` SHALL NOT contain any handler from this plugin (the staged `prompt-assembly` registration is discarded)

#### Scenario: Plugin registers stage not declared
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}]` but its backend calls `ctx.hooks.register("prompt-assembly", ...)` AND `ctx.hooks.register("response-stream", ...)`
- **THEN** plugin loading SHALL throw an `Error` naming the plugin and listing `registeredOnly: ["response-stream"]`, the plugin SHALL NOT appear in the plugin registry, and no handlers from this plugin SHALL appear in `HookDispatcher.introspect()`

#### Scenario: Plugin omits hooks entirely is exempt
- **WHEN** a plugin's manifest has no `hooks` field and its backend `register(ctx)` calls `ctx.hooks.register("post-response", ...)`
- **THEN** plugin loading SHALL succeed without cross-checking and the handler SHALL be committed

#### Scenario: Full-stack plugin declares mix of backend and frontend stages
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}, {stage: "frontend-render"}]` and its backend `register(ctx)` only calls `ctx.hooks.register("prompt-assembly", ...)` (the `frontend-render` subscription is in `frontend.js`)
- **THEN** the backend consistency check SHALL pass because `frontend-render` is not in `KNOWN_BACKEND_STAGES` and is therefore excluded from the backend comparison; frontend enforcement is performed separately by `FrontendHookDispatcher.finalizeBoot()`

#### Scenario: strip-tags declared in hooks[] is rejected at manifest validation
- **WHEN** a plugin's manifest declares `hooks: [{stage: "strip-tags"}]`
- **THEN** the manifest validator SHALL reject the manifest with an error stating that `strip-tags` is a declarative-only stage and SHALL direct the author to use `promptStripTags` / `displayStripTags` instead

#### Scenario: Unknown-stage declaration ignored by strict check
- **WHEN** a plugin's manifest declares `hooks: [{stage: "future-experimental-stage"}, {stage: "prompt-assembly"}]` and its backend `register(ctx)` calls `ctx.hooks.register("prompt-assembly", ...)`
- **THEN** the manifest validator SHALL `log.warn` for `future-experimental-stage` but plugin loading SHALL succeed because the unknown stage is excluded from `declaredBackend` and the symmetric difference with `registeredBackend = {"prompt-assembly"}` is empty

## MODIFIED Requirements

### Requirement: Plugin manifest format

Each plugin SHALL have a `plugin.json` (or `plugin.yaml`) manifest file in its root directory. The manifest SHALL contain the following fields: `name` (string, unique identifier), `version` (semver string), `description` (string), `type` (one of `full-stack`, `prompt-only`, `frontend-only`, `hook-only`), `prompts` (array of relative paths to prompt files to contribute), `frontend` (array of relative paths to frontend ES module scripts), `frontendStyles` (array of relative paths to CSS files to inject into the frontend), `hooks` (array of declarative hook entries — see below), and `dependencies` (array of plugin names this plugin depends on). The `name` and `version` fields SHALL be required; all other fields SHALL be optional with sensible defaults (empty arrays/objects).

The `hooks` field, when present, SHALL be an array of declarative entries with the following shape:

```ts
interface PluginHookDeclaration {
  readonly stage: string;          // hook stage name (backend or frontend)
  readonly priority?: number;       // suggested priority; runtime priority is set in register()
  readonly reads?: readonly string[];   // fields the handler reads (for stale-read detection)
  readonly writes?: readonly string[];  // fields the handler writes (for multi-write detection)
  readonly note?: string;          // free-form note shown in the hook inspector tooltip
}
```

The `hooks` field MAY be omitted (the plugin is treated as "undeclared" for conflict analysis) OR supplied as `[]`. When present and non-empty, the plugin's manifest declaration set MUST match its actual `register()` call set (see the "Hook declaration consistency check at plugin load" requirement). The previous schema describing `hooks` as `object mapping hook stage names to handler file paths` is removed; that shape was never implemented and is replaced by the imperative `register()` + declarative-metadata pattern described here.

The manifest validator SHALL reject `hooks[]` entries that:
- Lack a `stage` field, OR
- Specify a `note` longer than 200 characters, OR
- Specify a `reads` / `writes` entry that is not a non-empty string, OR
- Declare the `strip-tags` stage (declarative-only; use `promptStripTags` / `displayStripTags`).

The manifest validator SHALL also reject any `hooks[]` array that contains two or more entries with the same `stage` value (one declaration per `(plugin, stage)` pair). This keeps the one-handler-per-`(plugin, stage)` invariant the conflict-detector relies on.

Entries with a `stage` value that does not match a known backend or frontend stage SHALL produce a `log.warn` (forward-compatible with new stages added in later versions) but SHALL NOT prevent plugin loading.

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

#### Scenario: hooks entry with unknown stage warned but accepted
- **WHEN** a plugin manifest contains `"hooks": [{"stage": "future-experimental-stage"}]`
- **THEN** the manifest validator SHALL `log.warn` identifying the unknown stage and SHALL continue loading the plugin

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
- **THEN** that plugin's entry in the response SHALL include the `hooks` array verbatim so the frontend can correlate manifest declarations with `frontendHooks.introspect()` results
