## ADDED Requirements

### Requirement: Plugin asset allowlist enforcement on the wildcard `.js` route

The server SHALL expose `GET /plugins/:plugin/:path{.+\.js}` to serve plugin-provided `.js` assets to the SPA. A request SHALL be served **only if** the requested path appears in the per-plugin allowlist returned by `PluginManager.getPluginAllowedJsFiles(name)`, which is the normalized union of `manifest.frontendModule` and each entry validated from `manifest.frontendImports`. Any other request SHALL return `404 Not Found`. The allowlist comparison SHALL be performed before any filesystem access (no `Deno.stat` / `Deno.realPath` call on rejected requests).

The wildcard `.js` route SHALL be registered **after** the existing `/plugins/_shared/*` shared-utility route so that the more-specific shared route is matched first. A request to `/plugins/_shared/<file>` SHALL be handled by the shared route under its own containment + `.js` checks and SHALL NOT be subjected to a per-plugin manifest allowlist (no plugin named `_shared` exists).

The route SHALL reject — before normalization — any request path containing a literal backslash (`\`). This prevents a normalization-mismatch bypass where an allowlist entry stored in slash form (`dir/helper.js`) appears to match a request that resolves to a literal `dir\helper.js` filename on POSIX.

After the allowlist gate passes, the route SHALL continue to enforce: dotfile segment rejection, plugin-directory containment via raw `String.startsWith(pluginDir + SEP)`, and symlink-safe containment via `Deno.realPath()`. The response Content-Type SHALL be `application/javascript`.

#### Scenario: Declared frontendModule is served

- **GIVEN** a plugin `acme` whose manifest has `frontendModule: "ui.js"` and the file exists on disk
- **WHEN** the SPA requests `GET /plugins/acme/ui.js` with a valid passphrase
- **THEN** the server SHALL respond `200` with `Content-Type: application/javascript`

#### Scenario: Declared frontendImports sibling is served

- **GIVEN** a plugin `acme` whose manifest has `frontendModule: "ui.js"` and `frontendImports: ["./lightbox.js"]`, and both files exist on disk
- **WHEN** the SPA requests `GET /plugins/acme/lightbox.js`
- **THEN** the server SHALL respond `200` with the file contents

#### Scenario: Undeclared on-disk `.js` is rejected

- **GIVEN** a plugin `acme` whose manifest declares only `frontendModule: "ui.js"`, **and** an additional file `dropped.js` physically exists inside the plugin directory
- **WHEN** any client requests `GET /plugins/acme/dropped.js`
- **THEN** the server SHALL respond `404` and SHALL NOT read the file from disk

#### Scenario: Request with backslash is rejected outright

- **WHEN** a client requests `GET /plugins/acme/dir%5Chelper.js` (decoded path contains `\`)
- **THEN** the server SHALL respond `404` regardless of the allowlist contents or filesystem state

#### Scenario: Dotfile segments are rejected

- **WHEN** a client requests `GET /plugins/acme/.env.js`
- **THEN** the server SHALL respond `404` even if a file with that name exists on disk

#### Scenario: Path that escapes the plugin directory is rejected

- **WHEN** a client requests `GET /plugins/acme/../../etc/passwd.js`
- **THEN** the server SHALL respond `404` and SHALL NOT read any file outside the plugin directory

#### Scenario: Unknown plugin name is rejected

- **WHEN** a client requests `GET /plugins/does-not-exist/anything.js`
- **THEN** the server SHALL respond `404` because `getPluginDir("does-not-exist")` returns `null`

#### Scenario: Shared plugin utility route takes precedence

- **GIVEN** the built-in `_shared` plugin utility directory contains `utils.js`
- **WHEN** the SPA requests `GET /plugins/_shared/utils.js`
- **THEN** the request SHALL be handled by the `_shared` route, not by the per-plugin wildcard allowlist route
- **AND** the response SHALL preserve the existing shared-module containment and `.js` checks

#### Scenario: URL-encoded traversal is rejected before disk access

- **WHEN** a client requests `GET /plugins/acme/%2e%2e/%2e%2e/etc/passwd.js`
- **THEN** the server SHALL respond `404`
- **AND** the server SHALL NOT read any file outside the plugin directory

### Requirement: `frontendImports` entry validation

The `PluginManager.init()` flow SHALL invoke a dedicated `validateFrontendImports(manifest, pluginDir)` validator that ingests `manifest.frontendImports` and returns the validated, normalized, deduplicated list of relative paths (forward slashes, no leading `./`). Each entry SHALL be subjected to syntactic and filesystem checks; failed entries SHALL be logged with `log.warn` and dropped without aborting the plugin load.

Entries SHALL be rejected when any of the following hold:
- The entry is not a non-empty string.
- The entry does not end (case-insensitively) in `.js`.
- The entry is an absolute path (`isAbsolute(entry)`).
- The entry contains a `..` segment under either `/` or `\` separators.
- The entry contains any of `\`, `#`, `?`, `%`.
- After normalization, any segment begins with `.` (dotfile / traversal artefact).
- After resolution, the path is not contained within the plugin directory (`isPathContained` returns `false`).
- The file does not exist on disk, is not a regular file, or its `realPath` lies outside the plugin directory's `realPath`.

Duplicate entries (those that resolve to the same absolute path) SHALL be silently collapsed.

#### Scenario: Non-.js entry rejected

- **GIVEN** a manifest with `frontendImports: ["helper.txt"]`
- **WHEN** `validateFrontendImports` runs
- **THEN** the validator SHALL emit `log.warn` and the returned list SHALL NOT contain `helper.txt`

#### Scenario: Traversal entry rejected

- **GIVEN** a manifest with `frontendImports: ["../escape.js"]`
- **WHEN** `validateFrontendImports` runs
- **THEN** the returned list SHALL be empty

#### Scenario: Symlink to outside the plugin directory rejected

- **GIVEN** an on-disk symlink `acme/link.js` pointing to `/tmp/outside/evil.js`, and `frontendImports: ["link.js"]`
- **WHEN** `validateFrontendImports` runs
- **THEN** the validator SHALL drop `link.js` and emit `log.warn`

#### Scenario: Valid entry is normalized

- **GIVEN** a manifest with `frontendImports: ["./sub/helper.js"]` and the file exists on disk inside the plugin directory
- **WHEN** `validateFrontendImports` runs
- **THEN** the returned list SHALL contain exactly `"sub/helper.js"` (forward slashes, no leading `./`)

### Requirement: `getPluginAllowedJsFiles` composition

`PluginManager.getPluginAllowedJsFiles(name): Set<string>` SHALL return the normalized union of (a) `manifest.frontendModule` if present and (b) every entry in the plugin's `validatedImports`. Normalization for both sources SHALL replace `\` with `/` and strip any leading `./` segments. For unknown plugin names, the method SHALL return an empty `Set`.

#### Scenario: Union of frontendModule and frontendImports

- **GIVEN** a plugin whose manifest has `frontendModule: "./ui.js"` and validated `frontendImports: ["sub/helper.js"]`
- **WHEN** `getPluginAllowedJsFiles("acme")` is invoked
- **THEN** the returned set SHALL equal `new Set(["ui.js", "sub/helper.js"])`

#### Scenario: Unknown plugin yields empty set

- **GIVEN** no plugin with name `ghost` is registered
- **WHEN** `getPluginAllowedJsFiles("ghost")` is invoked
- **THEN** the returned set SHALL be empty
