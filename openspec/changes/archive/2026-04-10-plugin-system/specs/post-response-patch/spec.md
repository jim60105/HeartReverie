# Post-Response Patch — Plugin System Delta

## MODIFIED Requirements

### Requirement: Post-response status update

After each completed AI response, the `apply-patches` execution SHALL be triggered via the plugin hook system (`post-response` stage) instead of hardcoded `server.js` code. The status-bar plugin SHALL register a `post-response` hook handler that invokes `./apply-patches/target/release/apply-patches playground`. The server SHALL invoke the `post-response` hook stage after the AI response stream completes, and registered handlers (including the status-bar plugin's apply-patches handler) SHALL execute in priority order. The command SHALL be run as a child process using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response — the chapter content SHALL still be returned successfully. If the `apply-patches` binary is not found, the handler SHALL log a warning and continue without patching.

#### Scenario: Successful patch execution via hook
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the status-bar plugin's hook handler SHALL execute `execFile('./apply-patches/target/release/apply-patches', ['playground'])`, await its completion, and the hook chain SHALL continue to the next handler (if any) before the HTTP response is sent

#### Scenario: Patch execution failure via hook
- **WHEN** the `apply-patches` command exits with a non-zero exit code or produces stderr output during the `post-response` hook
- **THEN** the hook handler SHALL log a warning including the exit code and stderr content, but SHALL NOT fail the hook chain, and the HTTP response SHALL return the chapter content as if the patch succeeded

#### Scenario: apply-patches binary not found during hook
- **WHEN** the `apply-patches` binary does not exist at the expected path when the `post-response` hook handler attempts execution
- **THEN** the handler SHALL log a warning indicating the binary was not found, return without error, and the hook chain and HTTP response SHALL proceed normally

#### Scenario: No post-response hook registered
- **WHEN** no plugin has registered a `post-response` hook handler (e.g., the status-bar plugin is disabled or not loaded)
- **THEN** the server SHALL skip the `post-response` hook stage and return the HTTP response without running `apply-patches`

## REMOVED Requirements

### Requirement: Hardcoded apply-patches invocation in server.js
**Reason**: The direct `execFile` call in `server.js` after AI response completion is replaced by the plugin hook system. The status-bar plugin now owns the `apply-patches` invocation via a `post-response` hook handler, enabling the behavior to be enabled/disabled through the plugin system rather than requiring code changes.
**Migration**: Remove the hardcoded `execFile('./apply-patches/target/release/apply-patches', ['playground'])` call from `server.js`. The status-bar plugin's `post-response` hook handler provides the same functionality. The `execFile` safety requirements (explicit arguments, no shell, no user input interpolation) are preserved in the plugin handler implementation.
