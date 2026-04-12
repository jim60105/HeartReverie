# Shared Plugin Utils

## Purpose

Shared utility module infrastructure for frontend plugin code, providing common functions (e.g., `escapeHtml`) via a served ES module at `plugins/_shared/utils.js` so plugins avoid duplicating utility logic.

## Requirements

### Requirement: Shared plugin utility module

The plugin infrastructure SHALL provide a shared utility module at `plugins/_shared/utils.js` containing common functions used by multiple plugins. The module SHALL export functions as named ES module exports. The `_shared` directory SHALL NOT be treated as a plugin (no `plugin.json`).

#### Scenario: escapeHtml available from shared module
- **WHEN** a plugin `frontend.js` imports `escapeHtml` from `../_shared/utils.js`
- **THEN** the function SHALL be available and SHALL escape `&`, `<`, `>`, `"`, and `'` characters to their HTML entity equivalents

#### Scenario: _shared directory not loaded as plugin
- **WHEN** the `PluginManager` scans the `plugins/` directory for plugins
- **THEN** it SHALL skip `_shared` because it contains no `plugin.json` manifest

### Requirement: Shared module serving route

The backend SHALL serve files from the `plugins/_shared/` directory at the URL path `/plugins/_shared/*`. Only files with `.js` extension SHALL be served. The route SHALL apply path containment checks to prevent directory traversal, reject dotfiles, and canonicalize paths to defeat symlink escapes.

#### Scenario: Serve shared utility module
- **WHEN** a browser requests `GET /plugins/_shared/utils.js`
- **THEN** the server SHALL respond with the file content and `Content-Type: application/javascript`

#### Scenario: Reject non-JS file requests
- **WHEN** a browser requests `GET /plugins/_shared/secret.env`
- **THEN** the server SHALL respond with 404

#### Scenario: Reject path traversal attempts
- **WHEN** a browser requests `GET /plugins/_shared/../../.env`
- **THEN** the resolved path SHALL escape the `_shared` directory and the server SHALL respond with 404

#### Scenario: Reject dotfiles
- **WHEN** a browser requests `GET /plugins/_shared/.secret.js`
- **THEN** the server SHALL respond with 404 because path segments starting with `.` are rejected

#### Scenario: Reject symlink escapes
- **WHEN** a file in `_shared/` is a symlink pointing outside the `_shared` directory
- **THEN** the server SHALL canonicalize paths via `realPath` and reject the request with 404

#### Scenario: Authenticated access required
- **WHEN** an unauthenticated request is made to `GET /plugins/_shared/utils.js`
- **THEN** the server SHALL respond with 401, consistent with other plugin routes
