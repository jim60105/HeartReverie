# plugin-settings

## Purpose

Defines the plugin settings storage, API endpoints, schema declaration, and frontend/backend integration contracts for per-plugin configurable settings.

## Requirements

### Requirement: Plugin settings storage

Plugin settings SHALL be stored at `playground/_plugins/<pluginName>/config.json`. The directory SHALL be created on first `PUT` request if it does not already exist. The file SHALL contain valid JSON.

#### Scenario: Settings GET returns defaults when no config exists

- **GIVEN** a plugin declares `settingsSchema` with default values
- **AND** no `config.json` file exists for that plugin
- **WHEN** a client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond with 200 and the default values derived from the schema

#### Scenario: Settings GET returns saved config when it exists

- **GIVEN** a plugin has a saved `config.json`
- **WHEN** a client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond with 200 and the saved configuration values

### Requirement: Plugin settings API endpoints

The server SHALL expose the following endpoints:

- `GET /api/plugins/:name/settings` — returns current settings (merged defaults from schema + saved values from `config.json`)
- `PUT /api/plugins/:name/settings` — validates the request body against the plugin's `settingsSchema`, then saves to `config.json`
- `GET /api/plugins/:name/settings-schema` — returns the plugin's declared JSON Schema for frontend form generation

All endpoints SHALL be protected by the passphrase authentication middleware. The server SHALL return 404 if the plugin does not declare a `settingsSchema`. The server SHALL return 400 with validation error details if the `PUT` body fails schema validation.

#### Scenario: Settings PUT saves valid config

- **GIVEN** a plugin declares `settingsSchema`
- **WHEN** a client sends `PUT /api/plugins/:name/settings` with a body that passes schema validation
- **THEN** the server SHALL save the body to `playground/_plugins/<pluginName>/config.json` and respond with 200

#### Scenario: Settings PUT rejects invalid config with 400

- **GIVEN** a plugin declares `settingsSchema`
- **WHEN** a client sends `PUT /api/plugins/:name/settings` with a body that fails schema validation
- **THEN** the server SHALL respond with 400 and include validation error messages in the response body

#### Scenario: Settings API returns 404 for plugins without settingsSchema

- **WHEN** a client sends `GET /api/plugins/:name/settings` for a plugin that does not declare `settingsSchema`
- **THEN** the server SHALL respond with 404

### Requirement: Plugin settings schema declaration

Plugins SHALL declare `settingsSchema` in `plugin.json` as a JSON Schema object defining the plugin's configurable settings. The plugin manager SHALL validate the schema at load time. The schema SHALL support standard JSON Schema types: `string`, `number`, `integer`, `boolean`, `array`, `object`. A custom extension `x-options-url` on string fields SHALL instruct the frontend to fetch dropdown options from the specified URL at render time.

#### Scenario: Plugin manager validates schema at load time

- **WHEN** the plugin manager loads a plugin with an invalid `settingsSchema`
- **THEN** the manager SHALL reject the plugin with a descriptive validation error

### Requirement: Plugin API routes

Backend modules MAY export a `registerRoutes(app, basePath)` function. The core SHALL mount these routes at `/api/plugins/:name/` with passphrase authentication middleware applied. This allows plugins to expose custom HTTP endpoints (e.g., proxy to external services).

#### Scenario: Plugin routes are accessible at `/api/plugins/:name/custom-path`

- **GIVEN** a plugin exports a `registerRoutes` function that registers a handler at `/proxy/sd-models`
- **WHEN** a client sends a request to `GET /api/plugins/:name/proxy/sd-models` with a valid passphrase
- **THEN** the server SHALL route the request to the plugin's handler and return its response

#### Scenario: Plugin routes are protected by passphrase

- **GIVEN** a plugin has registered custom routes
- **WHEN** a client sends a request to a plugin route without a valid passphrase
- **THEN** the server SHALL respond with 401

### Requirement: Settings-aware prompt-fragment rendering

`PluginManager.getPromptVariables()` SHALL consult each plugin's resolved settings before including any `manifest.promptFragments[].file` contribution. When the resolved `settings.enabled === false`, every fragment entry for that plugin SHALL resolve to the empty string, including unnamed fragments contributed to `plugin_fragments`.

The same gate SHALL apply inside `PluginManager.getDynamicVariables()`: when the owning plugin's resolved `enabled` is `false`, the engine MUST NOT invoke that plugin's dynamic-variable provider, and any name that provider would have set MUST resolve to its template default (typically empty string).

#### Scenario: Disabled plugin contributes nothing to assembled prompt

- **WHEN** a plugin's resolved `enabled` is `false`
- **AND** the engine assembles a system prompt
- **THEN** none of the plugin's `promptFragments[]` files appear in the rendered output
- **AND** none of the plugin's `getDynamicVariables()` output appears in the rendered output

### Requirement: Frontend `register` context exposes resolved plugin settings

The frontend hook-dispatcher SHALL pass a register context whose shape is `{ register, on, getSettings }` (in addition to any pre-existing fields). `getSettings(name?)` SHALL return a deep-frozen snapshot of the most recently resolved settings for the plugin (or, when called with another plugin's name, that plugin's settings).

The returned snapshot SHALL be synchronous. The dispatcher SHALL update the underlying store on every `plugin-settings:changed` event so subsequent calls within new hook invocations see the latest values.

#### Scenario: Plugin reads its own settings during a frontend-render hook

- **WHEN** a plugin's frontend `register()` runs and calls `context.getSettings()`
- **THEN** the return value is the resolved settings object for that plugin
- **AND** the object is frozen (mutation throws in strict mode / has no effect otherwise)

### Requirement: `plugin-settings:changed` broadcast

A successful `PUT /api/plugins/:name/settings` SHALL cause the reader to emit a `plugin-settings:changed` event with payload `{ name, settings }` on its event bus.

The settings store SHALL refresh its cached entry for `name` from the event payload (no follow-up fetch) and bump the reactive revision counter. The chapter renderer SHALL debounce 50 ms and re-dispatch `frontend-render` and `display-strip-tags` for the currently-mounted chapter when the changed plugin contributes to either hook. The action-button strip SHALL re-fetch `/api/plugins/action-buttons`.

The broadcast SHALL NOT fire for non-2xx PUT responses.

#### Scenario: Settings save triggers re-render

- **WHEN** the user saves new settings on the plugin-settings page
- **AND** the PUT returns 2xx
- **THEN** the chapter view updates within 100 ms without a page reload

### Requirement: Settings-aware action-button visibility

`GET /api/plugins/action-buttons` SHALL filter out every button whose owning plugin's resolved `enabled` is `false`.

The frontend hook dispatcher SHALL additionally no-op every `action-button:click` invocation when the originating plugin's `context.getSettings().enabled` is `false`, as a stale-cache safety net.

#### Scenario: Disabled plugin's button is hidden

- **WHEN** a plugin's `enabled` is `false` and the reader requests action buttons
- **THEN** none of that plugin's buttons appear in the response
