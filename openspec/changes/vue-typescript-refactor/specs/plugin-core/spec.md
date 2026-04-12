# Plugin Core — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Plugin frontend.js path compatibility

Built-in plugin `frontend.js` modules currently import from absolute paths such as `/js/utils.js` and `/js/chat-input.js`. After the Vite migration, raw source files will no longer be served at `/js/*` paths — the build output goes to `reader-dist/` with hashed filenames.

The server SHALL continue serving plugin `frontend.js` files at `/plugins/{name}/frontend.js` in both dev and production modes. Built-in plugin `frontend.js` modules SHALL be updated to remove `/js/*` imports and instead receive needed utilities (e.g., `escapeHtml`) through alternative means (inline implementation, shared module re-export, or hook context injection). This is a **BREAKING** change for any third-party plugins that import from `/js/*` paths.

The Vite dev server proxy SHALL forward `/plugins/*` requests to the Deno backend (already specified). No additional `/js/*` proxy route is required because built-in plugins will be updated to remove those imports.

#### Scenario: Built-in plugin `/js/*` imports removed
- **WHEN** the Vue/TypeScript migration is complete
- **THEN** all built-in plugin `frontend.js` modules (currently `status`, `options`, `state-patches`, `thinking`) SHALL NOT import from `/js/utils.js`, `/js/chat-input.js`, or any other `/js/*` path

#### Scenario: Plugin frontend.js served at existing URL
- **WHEN** the frontend requests `import('/plugins/{name}/frontend.js')` in production (serving from `reader-dist/`)
- **THEN** the backend SHALL serve the plugin module from the `plugins/` directory at the same URL path as before

#### Scenario: Third-party plugin breakage documented
- **WHEN** a third-party plugin's `frontend.js` imports from `/js/utils.js` or other `/js/*` paths
- **THEN** the import SHALL fail with a 404 error; this is documented as a known breaking change in the migration

### Requirement: Plugin name identity preservation

Plugin manifest `name` fields and directory names SHALL remain unchanged during this refactor. The actual plugin names are: `status`, `options`, `state-patches`, `thinking`, `context-compaction`, `de-robotization`, `imgthink`, `threshold-lord`, `t-task`, `user-message`, `writestyle`. Delta specs and Vue components MAY use descriptive names (e.g., `StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue`) for component file names, but plugin manifests, directory names, and any code referencing plugin names (e.g., `/plugins/{name}/frontend.js`) SHALL use the original names.

#### Scenario: Plugin directory names unchanged
- **WHEN** the Vue refactor is complete
- **THEN** plugin directories SHALL remain `plugins/status/`, `plugins/options/`, `plugins/state-patches/`, etc. — not renamed to `status-bar/`, `options-panel/`, or `variable-display/`

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
