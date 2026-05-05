# plugin-core

> Modified capability in change `sd-webui-image-gen`

## MODIFIED Requirements

### Requirement: Plugin manifest format

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

## ADDED Requirements

### Requirement: Plugin route registration

The plugin system SHALL allow backend modules to register custom HTTP routes by exporting a `registerRoutes(app, basePath)` function. The core SHALL mount these routes at `/api/plugins/:pluginName/` and SHALL apply passphrase authentication middleware to all plugin routes. Plugin routes SHALL NOT be able to escape their namespace prefix.

#### Scenario: Plugin route responds to request

- **WHEN** a plugin named `sd-webui-image-gen` registers a route handler for `GET /proxy/sd-models`
- **THEN** the route SHALL be accessible at `GET /api/plugins/sd-webui-image-gen/proxy/sd-models` with passphrase protection

#### Scenario: Plugin route isolated to namespace

- **WHEN** a plugin attempts to register a route at a path outside its namespace
- **THEN** the plugin manager SHALL prevent the route from being accessible outside `/api/plugins/<pluginName>/`
