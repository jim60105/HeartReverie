## MODIFIED Requirements

### Requirement: Plugin API endpoints

The writer backend SHALL expose `GET /api/plugins` that returns a JSON array of loaded plugins. Each entry SHALL include the plugin `name`, `type` (full-stack, prompt-only, frontend-only, hook-only), `enabled` status, and the verbatim `hooks` declaration array from the plugin's manifest (an array of `PluginHookDeclaration` objects as defined in the `plugin-core` capability). When the plugin's manifest omits the `hooks` field entirely, the entry SHALL include `hooks: []`. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

The `hooks` field in this response SHALL represent the plugin's manifest declarations, NOT the runtime-registered handler set. Runtime registration facts (per-handler priority, `errorCount`, the actual set of stages on which the plugin called `register(...)`) are exposed only via `GET /api/plugin-introspection/hooks` in the `hook-inspector` capability. Consumers comparing manifest declarations against runtime facts SHALL fetch both endpoints.

#### Scenario: List all loaded plugins
- **WHEN** a client sends `GET /api/plugins` with a valid passphrase
- **THEN** the server SHALL return a JSON array containing an entry for each loaded plugin with its `name`, `type`, `enabled` status, and `hooks` declaration array

#### Scenario: hooks reflects manifest declarations verbatim
- **WHEN** a plugin's manifest contains `"hooks": [{"stage": "prompt-assembly", "priority": 50, "writes": ["previousContext"]}]`
- **THEN** that plugin's entry in the response SHALL include `"hooks": [{"stage": "prompt-assembly", "priority": 50, "writes": ["previousContext"]}]` (the same array verbatim, modulo schema-permitted normalization such as defaulting absent `reads`/`writes` to empty arrays)

#### Scenario: Plugin without manifest hooks field reports empty array
- **WHEN** a plugin's manifest omits the `hooks` field
- **THEN** that plugin's entry in the response SHALL include `"hooks": []`

#### Scenario: hooks field is NOT runtime registration data
- **WHEN** a plugin's manifest declares `hooks: [{stage: "prompt-assembly"}]` and the plugin's `register(ctx)` registers a `prompt-assembly` handler at runtime priority 75
- **THEN** the `/api/plugins` entry for this plugin SHALL show only the manifest declaration; runtime priority and `errorCount` SHALL only be discoverable via `GET /api/plugin-introspection/hooks`

#### Scenario: No plugins loaded
- **WHEN** no plugins are loaded (empty `plugins/` directory and no `PLUGIN_DIR`)
- **THEN** the server SHALL return an empty JSON array `[]`
