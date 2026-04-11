# Plugin Core — Delta Spec (plugin-consolidation)

## MODIFIED Requirements

### Requirement: Plugin discovery and loading

The server SHALL scan the built-in plugins directory (`plugins/`) at startup to discover and load plugins. The server SHALL also scan an external plugin path specified by the `PLUGIN_DIR` environment variable if set. File system operations SHALL use Deno native APIs (`Deno.readDir()`, `Deno.readTextFile()`). Path operations SHALL use `@std/path`. Dynamic module loading SHALL use `import()` which is compatible in both Node.js and Deno. The frontend SHALL discover available plugins via a `GET /api/plugins` endpoint that returns the list of loaded plugins with their manifest metadata and enabled status.

The built-in plugin set SHALL include the following consolidated plugins:
- `state-patches` (full-stack): merged from former `apply-patches` and `variable-display` plugins — owns the complete `<UpdateVariable><JSONPatch>…</JSONPatch></UpdateVariable>` lifecycle including backend state mutation, frontend rendering, and tag stripping
- `threshold-lord` (prompt-only): merged from former `threshold-lord` and `disclaimer` plugins — owns both prompt injection and `<disclaimer>` tag cleanup
- `user-message` (prompt-only): expanded to own the full `<user_message>` lifecycle including block construction via `pre-write` hook, tag stripping from previousContext, and frontend display stripping

The former standalone plugin directories `apply-patches`, `variable-display`, and `disclaimer` SHALL no longer exist.

#### Scenario: Built-in plugin discovery at startup
- **WHEN** the server starts and the `plugins/` directory contains subdirectories with valid `plugin.json` manifests
- **THEN** the server SHALL load each valid plugin using Deno file system APIs and register it in the plugin registry

#### Scenario: External plugin path discovery
- **WHEN** the `PLUGIN_DIR` environment variable is set to a directory path containing plugin subdirectories
- **THEN** the server SHALL scan that directory using `Deno.readDir()` and load plugins from it in addition to built-in plugins

#### Scenario: Path containment check
- **WHEN** a plugin's `backendModule`, `promptFragments`, or `frontendModule` path is resolved
- **THEN** the system SHALL verify the resolved path is within the plugin directory using `@std/path` utilities

#### Scenario: PLUGIN_DIR not set
- **WHEN** the `PLUGIN_DIR` environment variable is not set
- **THEN** the server SHALL load only built-in plugins from `plugins/` without error

#### Scenario: Frontend plugin discovery via API
- **WHEN** the frontend sends `GET /api/plugins`
- **THEN** the server SHALL return a JSON array of objects, each containing the plugin's `name`, `version`, `description`, `type`, and `enabled` status

#### Scenario: Plugin directory with no valid manifest
- **WHEN** a subdirectory in `plugins/` contains no `plugin.json` or `plugin.yaml`
- **THEN** the loader SHALL log a warning for that subdirectory and skip it without affecting other plugins

#### Scenario: Consolidated state-patches plugin loaded
- **WHEN** the server discovers the `state-patches` plugin directory
- **THEN** it SHALL load a `full-stack` plugin with backend module (post-response hook for Rust binary), frontend module (UpdateVariable renderer), and stripTags for `UpdateVariable`

#### Scenario: Consolidated threshold-lord plugin loaded
- **WHEN** the server discovers the `threshold-lord` plugin directory
- **THEN** it SHALL load a `prompt-only` plugin with promptFragments (`threshold_lord_start`, `threshold_lord_end`), frontend module (disclaimer strip), and stripTags for `disclaimer`

#### Scenario: Expanded user-message plugin loaded
- **WHEN** the server discovers the `user-message` plugin directory
- **THEN** it SHALL load a plugin with backend module (pre-write hook for user message block injection), frontend module (user_message strip), and stripTags for `user_message`
