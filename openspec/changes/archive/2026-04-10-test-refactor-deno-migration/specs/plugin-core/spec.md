## MODIFIED Requirements

### Requirement: Plugin discovery and loading

The server SHALL scan the built-in plugins directory (`plugins/`) at startup to discover and load plugins. The server SHALL also scan an external plugin path specified by the `PLUGIN_DIR` environment variable if set. File system operations SHALL use Deno native APIs (`Deno.readDir()`, `Deno.readTextFile()`). Path operations SHALL use `@std/path`. Dynamic module loading SHALL use `import()` which is compatible in both Node.js and Deno.

#### Scenario: Built-in plugin discovery at startup
- **WHEN** the server starts and the `plugins/` directory contains subdirectories with valid `plugin.json` manifests
- **THEN** the server SHALL load each valid plugin using Deno file system APIs and register it in the plugin registry

#### Scenario: External plugin path discovery
- **WHEN** the `PLUGIN_DIR` environment variable is set to a directory path containing plugin subdirectories
- **THEN** the server SHALL scan that directory using `Deno.readDir()` and load plugins from it in addition to built-in plugins

#### Scenario: Path containment check
- **WHEN** a plugin's `backendModule`, `promptFragments`, or `frontendModule` path is resolved
- **THEN** the system SHALL verify the resolved path is within the plugin directory using `@std/path` utilities
