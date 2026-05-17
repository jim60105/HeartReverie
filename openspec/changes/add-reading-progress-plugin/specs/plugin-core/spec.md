## ADDED Requirements

### Requirement: Plugin data directory convention

Plugins MAY create persistent data directories under `${PLAYGROUND_DIR}/_plugins/<plugin-name>/` for storing runtime data (e.g., progress files, caches, user-generated content). The engine SHALL NOT manage or clean up these directories automatically. Plugin README documentation SHALL specify the data directory path and how to remove it for complete data cleanup.

#### Scenario: Plugin creates data directory at startup

- **WHEN** a plugin's `registerRoutes` function creates `${PLAYGROUND_DIR}/_plugins/<plugin-name>/`
- **THEN** the directory SHALL be created with `{ recursive: true }` and persist across restarts

#### Scenario: Data directory independent of plugin lifecycle

- **WHEN** a plugin is disabled or removed
- **THEN** its data directory under `_plugins/` SHALL remain until manually deleted by the user

## MODIFIED Requirements

### Requirement: Plugin route registration

Each plugin that provides backend routes SHALL register them via the `registerRoutes(ctx: PluginRouteContext)` function exported from its `backendModule`. Routes MUST be registered using `ctx.app.<method>(\`${ctx.basePath}/<path>\`, handler)` to ensure they fall under the `/api/plugins/<name>/` prefix and inherit the global passphrase middleware. Routes registered without the `${basePath}` prefix SHALL NOT be protected by the passphrase middleware.

#### Scenario: Route inherits passphrase middleware

- **WHEN** a plugin registers `app.put(\`${basePath}/data\`, handler)`
- **THEN** the route SHALL be accessible at `/api/plugins/<name>/data` and require valid `X-Passphrase` header

#### Scenario: Route without basePath prefix is unprotected

- **WHEN** a plugin registers `app.put("/custom-path", handler)` without using `basePath`
- **THEN** the route SHALL NOT require passphrase authentication (this is a plugin authoring error)
