# Plugin Core

## Purpose

Plugin manifest format, loader, registry, and lifecycle management for extending the story system with modular capabilities.
## Requirements
### Requirement: Plugin manifest format

Each plugin SHALL have a `plugin.json` (or `plugin.yaml`) manifest file in its root directory. The manifest SHALL contain the following fields: `name` (string, unique identifier), `version` (semver string), `description` (string), `type` (one of `full-stack`, `prompt-only`, `frontend-only`, `hook-only`), `prompts` (array of relative paths to prompt files to contribute), `frontend` (array of relative paths to frontend ES module scripts), `frontendStyles` (array of relative paths to CSS files to inject into the frontend), `hooks` (object mapping hook stage names to handler file paths), and `dependencies` (array of plugin names this plugin depends on). The `name` and `version` fields SHALL be required; all other fields SHALL be optional with sensible defaults (empty arrays/objects).

#### Scenario: Valid full-stack plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with `name`, `version`, `type` set to `full-stack`, `prompts`, `frontend`, and `hooks` fields
- **THEN** the loader SHALL parse the manifest and register the plugin with all declared capabilities

#### Scenario: Minimal prompt-only plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with only `name`, `version`, and `prompts` fields
- **THEN** the loader SHALL parse the manifest successfully, defaulting `type` to `prompt-only`, `frontend` to `[]`, `frontendStyles` to `[]`, `hooks` to `{}`, and `dependencies` to `[]`

#### Scenario: Invalid manifest missing required fields
- **WHEN** a plugin directory contains a `plugin.json` without a `name` or `version` field
- **THEN** the loader SHALL log an error identifying the plugin directory and the missing field(s), and SHALL skip loading that plugin

#### Scenario: YAML manifest format
- **WHEN** a plugin directory contains a `plugin.yaml` instead of `plugin.json`
- **THEN** the loader SHALL parse the YAML manifest identically to JSON and register the plugin

#### Scenario: Manifest declares frontendStyles
- **WHEN** a plugin directory contains a `plugin.json` with `"frontendStyles": ["styles.css"]` and the file exists within the plugin directory
- **THEN** the loader SHALL parse the manifest, record the CSS asset, and register the plugin with its declared stylesheets available for frontend injection

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

