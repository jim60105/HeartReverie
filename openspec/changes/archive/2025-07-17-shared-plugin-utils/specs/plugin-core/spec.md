## MODIFIED Requirements

### Requirement: Frontend module serving

The plugin routes SHALL serve frontend modules for registered plugins at `/plugins/${name}/${path}`. Additionally, the plugin routes SHALL serve shared utility modules from the `_shared` directory at `/plugins/_shared/*`, restricted to `.js` files with path containment enforcement. The shared module route SHALL be registered alongside plugin frontend module routes in `registerPluginRoutes()`.

#### Scenario: Serve plugin frontend module
- **WHEN** a registered plugin declares a `frontendModule` in its manifest
- **THEN** the server SHALL create a route at `/plugins/${plugin.name}/${routePath}` serving the module file with `Content-Type: application/javascript`

#### Scenario: Serve shared utility module
- **WHEN** the `_shared` directory exists under the built-in plugins directory
- **THEN** the server SHALL register a wildcard route at `/plugins/_shared/:filename{.+\\.js$}` serving `.js` files from that directory

#### Scenario: Containment check for shared modules
- **WHEN** a request to `/plugins/_shared/*` resolves to a path outside the `_shared` directory
- **THEN** the server SHALL respond with 404 and NOT serve the file
