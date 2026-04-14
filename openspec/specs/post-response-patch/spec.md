# Post-Response Patch

## Purpose

Automatically execute the `state-patches` CLI tool after each completed AI response to update story status variables in `current-status.yml`.

## Requirements

### Requirement: Post-response status update

After each completed AI response, the `state-patches` execution SHALL be triggered via the plugin hook system (`post-response` stage) by the `state` plugin. The `state` plugin SHALL register a `post-response` hook handler that invokes the Rust `state-patches` binary located at `./plugins/state/state-patches`. The binary path SHALL reflect the new plugin directory structure after consolidation. The command SHALL be run as a child process using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response. If the binary is not found, the handler SHALL log a warning and continue without patching.

#### Scenario: Successful patch execution via hook
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the `state` plugin's hook handler SHALL execute `execFile('./plugins/state/state-patches', ['playground'])`, await its completion, and the hook chain SHALL continue

#### Scenario: Patch execution failure via hook
- **WHEN** the `state-patches` command exits with a non-zero exit code or produces stderr output during the `post-response` hook
- **THEN** the hook handler SHALL log a warning including the exit code and stderr content, but SHALL NOT fail the hook chain, and the HTTP response SHALL return the chapter content

#### Scenario: state-patches binary not found during hook
- **WHEN** the `state-patches` binary does not exist at the expected path `./plugins/state/state-patches`
- **THEN** the handler SHALL log a warning indicating the binary was not found, return without error, and the hook chain and HTTP response SHALL proceed normally

#### Scenario: No post-response hook registered
- **WHEN** no plugin has registered a `post-response` hook handler (e.g., the state plugin is disabled or not loaded)
- **THEN** the server SHALL skip the `post-response` hook stage and return the HTTP response without running `state-patches`

### Requirement: Patch command safety

The `state-patches` command SHALL be invoked via `execFile` with explicit arguments (not shell string) to prevent command injection. The working directory SHALL be the project root. No user-supplied input SHALL be interpolated into the command or its arguments.

#### Scenario: Command invocation uses execFile
- **WHEN** the server invokes the `state-patches` command
- **THEN** it SHALL use `child_process.execFile` with the binary path as the first argument and `['playground']` as the arguments array, without spawning a shell

#### Scenario: No user input in command arguments
- **WHEN** the `state-patches` command is constructed
- **THEN** the command path and arguments SHALL be hardcoded constants, with no interpolation of request parameters, user messages, or any other client-supplied data

### ~~Requirement: Hardcoded state-patches invocation in server.js~~ (REMOVED)

**Removed**: The direct `execFile` call in `server.js` after AI response completion is replaced by the plugin hook system. The state plugin now owns the `state-patches` invocation via a `post-response` hook handler, enabling the behavior to be enabled/disabled through the plugin system rather than requiring code changes. The hardcoded `execFile('./plugins/state/state-patches', ['playground'])` call in `server.js` has been removed. The state plugin's `post-response` hook handler provides the same functionality. The `execFile` safety requirements (explicit arguments, no shell, no user input interpolation) are preserved in the plugin handler implementation.
