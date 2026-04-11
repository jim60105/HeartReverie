# Plugin Core

## Purpose

Plugin manifest format, loader, registry, and lifecycle management for extending the story system with modular capabilities.

## Requirements

### Requirement: Plugin manifest format

Each plugin SHALL have a `plugin.json` (or `plugin.yaml`) manifest file in its root directory. The manifest SHALL contain the following fields: `name` (string, unique identifier), `version` (semver string), `description` (string), `type` (one of `full-stack`, `prompt-only`, `frontend-only`, `hook-only`), `prompts` (array of relative paths to prompt files to contribute), `frontend` (array of relative paths to frontend ES module scripts), `hooks` (object mapping hook stage names to handler file paths), and `dependencies` (array of plugin names this plugin depends on). The `name` and `version` fields SHALL be required; all other fields SHALL be optional with sensible defaults (empty arrays/objects).

#### Scenario: Valid full-stack plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with `name`, `version`, `type` set to `full-stack`, `prompts`, `frontend`, and `hooks` fields
- **THEN** the loader SHALL parse the manifest and register the plugin with all declared capabilities

#### Scenario: Minimal prompt-only plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with only `name`, `version`, and `prompts` fields
- **THEN** the loader SHALL parse the manifest successfully, defaulting `type` to `prompt-only`, `frontend` to `[]`, `hooks` to `{}`, and `dependencies` to `[]`

#### Scenario: Invalid manifest missing required fields
- **WHEN** a plugin directory contains a `plugin.json` without a `name` or `version` field
- **THEN** the loader SHALL log an error identifying the plugin directory and the missing field(s), and SHALL skip loading that plugin

#### Scenario: YAML manifest format
- **WHEN** a plugin directory contains a `plugin.yaml` instead of `plugin.json`
- **THEN** the loader SHALL parse the YAML manifest identically to JSON and register the plugin

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

Plugins SHALL NOT modify global state directly. Plugins SHALL interact with the system exclusively through the hook system and registry API. Plugin frontend scripts SHALL be loaded as ES modules with their own scope. Plugin prompt fragments SHALL be assembled by the hook system rather than directly modifying the system prompt template.

#### Scenario: Plugin uses hook system for interaction
- **WHEN** a plugin needs to contribute to prompt assembly
- **THEN** it SHALL register a `prompt-assembly` hook handler rather than directly modifying template files

#### Scenario: Plugin frontend scripts are scoped
- **WHEN** a plugin's frontend scripts are loaded in the browser
- **THEN** they SHALL be loaded as ES modules and SHALL NOT pollute the global `window` namespace with unexported variables

#### Scenario: Plugin cannot directly modify registry internals
- **WHEN** a plugin attempts to modify another plugin's state
- **THEN** it SHALL only be able to do so through the registry's public API methods, not by direct object mutation

### Requirement: Strip tag pattern support

The system SHALL support both plain tag names and regex pattern strings in the `stripTags` manifest field.

#### Scenario: Plain tag name (existing behavior)
- **WHEN** a `stripTags` entry is a plain string (no leading `/`)
- **THEN** the system generates a regex pattern `<tagName>[\s\S]*?</tagName>` as before

#### Scenario: Regex pattern string
- **WHEN** a `stripTags` entry starts with `/` (e.g., `"/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"`)
- **THEN** the system extracts the inner pattern (stripping leading `/` and trailing `/flags`) and uses it directly in the combined regex

#### Scenario: Invalid regex pattern
- **WHEN** a `stripTags` entry starts with `/` but contains an invalid regex
- **THEN** the system logs a warning and skips the entry without crashing
