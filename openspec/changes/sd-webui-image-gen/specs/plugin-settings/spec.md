# plugin-settings

> New capability added by change `sd-webui-image-gen`

## ADDED Requirements

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

Both endpoints SHALL be protected by the passphrase authentication middleware. The server SHALL return 404 if the plugin does not declare a `settingsSchema`. The server SHALL return 400 with validation error details if the `PUT` body fails schema validation.

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
