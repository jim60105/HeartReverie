# Plugin CSS Injection

## Purpose

Enable plugins to declare CSS stylesheets in their manifest that are automatically served by the backend and injected into the frontend as `<link>` elements, allowing plugins to contribute scoped styles without modifying core frontend code.

## Requirements

### Requirement: CSS file declaration in manifest

Plugins MAY declare a `frontendStyles` field in their `plugin.json` (or `plugin.yaml`) manifest. The field SHALL be an array of relative paths to `.css` files located within the plugin's root directory. The plugin loader SHALL validate each declared path and ensure it resolves to a file contained within the plugin directory (symlink-safe canonicalization). Invalid, missing, or out-of-bounds paths SHALL be logged with the offending plugin name and path, and SHALL be skipped without aborting plugin loading. Paths not ending in `.css` SHALL be rejected during validation.

#### Scenario: Plugin declares valid CSS files
- **WHEN** a plugin's `plugin.json` contains `"frontendStyles": ["styles.css", "themes/dark.css"]` and both files exist within the plugin directory
- **THEN** the loader SHALL record the canonicalized paths and expose them as loadable CSS assets for the plugin

#### Scenario: Plugin declares a path outside its directory
- **WHEN** a plugin's `plugin.json` contains `"frontendStyles": ["../other-plugin/leak.css"]`
- **THEN** the loader SHALL log an error identifying the plugin and the offending path, and SHALL skip that entry while continuing to load the rest of the plugin

#### Scenario: Plugin declares a non-CSS file
- **WHEN** a plugin's `plugin.json` contains `"frontendStyles": ["script.js"]`
- **THEN** the loader SHALL log an error and skip the entry because only `.css` extensions are permitted

#### Scenario: Plugin omits frontendStyles field
- **WHEN** a plugin's manifest does not declare `frontendStyles`
- **THEN** the loader SHALL default the field to an empty array and the plugin SHALL load without any CSS injection

#### Scenario: Duplicate entries deduplicated
- **WHEN** a plugin's `plugin.json` contains `"frontendStyles": ["styles.css", "styles.css"]` (same path listed twice)
- **THEN** the loader SHALL deduplicate by resolved path and include the entry only once in the validated array

#### Scenario: Leading `./` prefix normalization
- **WHEN** a plugin's `plugin.json` contains `"frontendStyles": ["./styles.css"]`
- **THEN** the loader SHALL normalize the entry to `"styles.css"` (strip the leading `./`) before storing it in the canonical array

#### Scenario: Deterministic ordering within a plugin
- **WHEN** a plugin declares `"frontendStyles": ["base.css", "theme.css", "overrides.css"]`
- **THEN** the loader SHALL preserve the declared array order, and the CSS files SHALL be loaded in that order, yielding a deterministic cascade within the plugin

### Requirement: CSS file serving

The backend SHALL expose plugin CSS files over HTTP at the route pattern `/plugins/<name>/<path>`, where `<name>` is the plugin's manifest name and `<path>` is a relative CSS path declared in `frontendStyles`. Responses SHALL set `Content-Type: text/css`. The handler SHALL re-validate containment on every request using the same symlink-safe canonicalization used at load time (via `Deno.realPath()`) to prevent symlink escape attacks, consistent with the `_shared` route's security pattern, and SHALL reject any path that escapes the plugin directory. Files with an extension other than `.css` SHALL NOT be served through this route. Unknown plugins, undeclared paths, and traversal attempts SHALL return HTTP 404.

#### Scenario: Request for a declared CSS file
- **WHEN** a client issues `GET /plugins/status-panel/styles.css` and the plugin `status-panel` declares `styles.css` in `frontendStyles`
- **THEN** the server SHALL respond with `200 OK`, `Content-Type: text/css`, and the file contents

#### Scenario: Path traversal attempt
- **WHEN** a client issues `GET /plugins/status-panel/../../secret.css`
- **THEN** the server SHALL respond with `404 Not Found` and SHALL NOT read any file outside the plugin directory

#### Scenario: Request for an undeclared file
- **WHEN** a client issues `GET /plugins/status-panel/extra.css` but the plugin manifest does not list `extra.css` in `frontendStyles`
- **THEN** the server SHALL respond with `404 Not Found`

#### Scenario: Request for a non-CSS file
- **WHEN** a client issues `GET /plugins/status-panel/script.js`
- **THEN** the server SHALL respond with `404 Not Found` because the route only serves `.css` assets

#### Scenario: Symlink escape attempt
- **WHEN** a CSS file path resolves via symlink to a location outside the plugin directory
- **THEN** the server SHALL respond with `404 Not Found`

### Requirement: Frontend CSS injection

The `usePlugins()` composable SHALL inject a `<link rel="stylesheet">` element into `document.head` for each CSS URL returned for a plugin, performed after the plugin list is fetched from `GET /api/plugins`. CSS loading SHALL occur in parallel with dynamic import of frontend JS modules and SHALL NOT block JS module registration; specifically, the `<link>` element SHALL be appended to the DOM before initiating the dynamic `import()` of the frontend module, but the composable SHALL NOT await the stylesheet to finish loading before proceeding with module imports. Each injected `<link>` element SHALL carry a `data-plugin="<name>"` attribute identifying the owning plugin for debugging. Failed CSS loads SHALL be silently ignored (graceful degradation) and SHALL NOT prevent other plugins or styles from loading.

#### Scenario: CSS link injection for a plugin with styles
- **WHEN** the composable processes a plugin whose `frontendStyles` response contains `/plugins/status-panel/styles.css`
- **THEN** the composable SHALL append a `<link rel="stylesheet" href="/plugins/status-panel/styles.css" data-plugin="status-panel">` element to `document.head`

#### Scenario: CSS loads in parallel with JS modules
- **WHEN** a plugin declares both a `frontend` JS module and one or more `frontendStyles` entries
- **THEN** the composable SHALL initiate the CSS `<link>` injection and the dynamic JS `import()` concurrently, without awaiting one before starting the other

#### Scenario: Failed CSS load does not break plugin system
- **WHEN** a plugin's CSS URL returns an error or fails to load in the browser
- **THEN** the composable SHALL silently ignore the failure, and other plugins' CSS and JS modules SHALL continue to load and register normally

#### Scenario: Plugin without frontendStyles
- **WHEN** a plugin's API response contains no `frontendStyles` entries
- **THEN** the composable SHALL NOT inject any `<link>` elements for that plugin

#### Scenario: CSS link appended before JS import initiation
- **WHEN** a plugin has both `frontendStyles` and a `frontendModule`
- **THEN** the composable SHALL append all `<link>` elements to `document.head` before calling `import()` for the frontend module, without awaiting stylesheet load completion

### Requirement: API response extension

The `GET /api/plugins` response SHALL include a `frontendStyles` field for each plugin entry. The field SHALL be an array of absolute URL paths (e.g., `/plugins/<name>/<path>`) corresponding to the validated CSS files declared in the manifest. Plugins that declare no CSS files SHALL return an empty array for this field.

#### Scenario: Plugin with declared CSS files
- **WHEN** a client issues `GET /api/plugins` and the plugin `status-panel` declares `frontendStyles: ["styles.css"]` in its manifest
- **THEN** the response SHALL include `"frontendStyles": ["/plugins/status-panel/styles.css"]` for that plugin entry

#### Scenario: Plugin without CSS files
- **WHEN** a client issues `GET /api/plugins` and a plugin does not declare any `frontendStyles`
- **THEN** the response SHALL include `"frontendStyles": []` for that plugin entry

#### Scenario: Invalid CSS entries are excluded from the response
- **WHEN** a plugin declares one valid CSS path and one path that fails validation (e.g., outside the plugin directory)
- **THEN** the response SHALL include only the validated URL path and SHALL omit the invalid entry

### Requirement: Unauthenticated static asset serving

The `/plugins/*` route namespace SHALL serve plugin assets (CSS, JS) without requiring authentication headers. This is consistent with the existing behavior for frontend JavaScript modules and shared utility scripts. Plugin assets are non-sensitive static resources that must be loadable by the browser without explicit auth tokens since `<link>` and dynamic `import()` cannot send custom headers.

#### Scenario: CSS file served without authentication
- **WHEN** a client issues `GET /plugins/status/styles.css` without an `X-Passphrase` header
- **THEN** the server SHALL respond with `200 OK` and the CSS file contents

#### Scenario: Plugin CSS accessible before authentication handshake
- **WHEN** the frontend loads and injects plugin CSS `<link>` elements before the user has completed passphrase authentication
- **THEN** the CSS files SHALL load successfully since the plugin asset route does not require authentication
