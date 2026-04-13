# Status Bar — Plugin System Delta

## ADDED Requirements

### Requirement: Plugin manifest and registration

The status-bar SHALL register itself as a full-stack plugin with the plugin system. The plugin manifest SHALL declare:
- **name**: `status-bar`
- **type**: `full-stack`
- **prompt fragment**: `status.md` — the plugin SHALL contribute its prompt fragment file via the `prompt-assembly` hook, returning `{ name: 'status-bar', content: <contents of status.md> }`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<status>` tag name, with the existing status bar renderer as the handler function
- **post-response hook**: The plugin SHALL register a `post-response` hook handler that invokes the `apply-patches` binary after each completed AI response (replacing the hardcoded invocation in `server.js`)

During plugin initialization, the status-bar plugin SHALL:
1. Register its `<status>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `status.md` prompt fragment
3. Register a `post-response` hook handler that executes `./apply-patches/target/release/apply-patches playground` via `execFile`

The existing detection, parsing, rendering, collapsible sections, and partial data handling requirements remain unchanged — they are now invoked through the plugin system's `frontend-render` hook rather than hardcoded pipeline calls.

#### Scenario: Status-bar registers as a full-stack plugin
- **WHEN** the plugin system initializes the status-bar plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<status>` tag handler with the md-renderer, register a `prompt-assembly` handler for `status.md`, and register a `post-response` hook handler for apply-patches execution

#### Scenario: Status-bar prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the status-bar plugin SHALL return `{ name: 'status-bar', content: <status.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Status tag rendered via plugin system
- **WHEN** the md-renderer encounters a `<status>` block during XML extraction
- **THEN** the block SHALL be passed to the status-bar plugin's registered renderer, producing the same styled status panel output as before

### Requirement: Post-response hook for apply-patches

The status-bar plugin SHALL register a `post-response` hook handler that replaces the hardcoded `apply-patches` invocation previously in `server.js`. After each completed AI response, the hook system SHALL invoke registered `post-response` handlers in priority order. The status-bar plugin's handler SHALL execute `./apply-patches/target/release/apply-patches playground` using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response. If the `apply-patches` binary is not found, the handler SHALL log a warning and return without error.

The same `execFile` safety requirements from the `post-response-patch` spec apply: the command SHALL be invoked with explicit arguments (not shell string) to prevent command injection, and no user-supplied input SHALL be interpolated into the command or its arguments.

#### Scenario: Post-response hook triggers apply-patches
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the status-bar plugin's hook handler SHALL execute `execFile('./apply-patches/target/release/apply-patches', ['playground'])` and await its completion

#### Scenario: Apply-patches failure in hook does not fail response
- **WHEN** the `apply-patches` command exits with a non-zero exit code during the post-response hook
- **THEN** the handler SHALL log a warning but SHALL NOT prevent the HTTP response from being returned with the chapter content

#### Scenario: Apply-patches binary not found in hook
- **WHEN** the `apply-patches` binary does not exist at the expected path during the post-response hook
- **THEN** the handler SHALL log a warning and return without error, allowing the hook chain and HTTP response to proceed normally
