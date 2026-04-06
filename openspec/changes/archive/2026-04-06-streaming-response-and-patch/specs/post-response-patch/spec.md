# Spec: post-response-patch

> Automatically execute the `apply-patches` CLI tool after each completed AI response to update story status variables in `current-status.yml`.

## ADDED Requirements

### Requirement: Post-response status update

After each completed AI response, the server SHALL execute `./apply-patches/target/release/apply-patches playground` to update story status variables. The command SHALL be run as a child process using `execFile` (not `exec`). The server SHALL await completion before sending the HTTP response to the client. If the command exits with a non-zero status code or writes to stderr, the server SHALL log a warning but SHALL NOT fail the HTTP response — the chapter content SHALL still be returned successfully. If the `apply-patches` binary is not found, the server SHALL log a warning and continue without patching.

#### Scenario: Successful patch execution
- **WHEN** the AI response stream completes and `./apply-patches/target/release/apply-patches` exists and is executable
- **THEN** the server SHALL execute `execFile('./apply-patches/target/release/apply-patches', ['playground'])`, await its completion, and then return the HTTP response with the chapter content

#### Scenario: Patch execution failure
- **WHEN** the `apply-patches` command exits with a non-zero exit code or produces stderr output
- **THEN** the server SHALL log a warning including the exit code and stderr content, but SHALL return the HTTP response with the chapter content as if the patch succeeded

#### Scenario: apply-patches binary not found
- **WHEN** the `apply-patches` binary does not exist at the expected path
- **THEN** the server SHALL log a warning indicating the binary was not found and SHALL return the HTTP response with the chapter content without attempting to patch

### Requirement: Patch command safety

The `apply-patches` command SHALL be invoked via `execFile` with explicit arguments (not shell string) to prevent command injection. The working directory SHALL be the project root. No user-supplied input SHALL be interpolated into the command or its arguments.

#### Scenario: Command invocation uses execFile
- **WHEN** the server invokes the `apply-patches` command
- **THEN** it SHALL use `child_process.execFile` with the binary path as the first argument and `['playground']` as the arguments array, without spawning a shell

#### Scenario: No user input in command arguments
- **WHEN** the `apply-patches` command is constructed
- **THEN** the command path and arguments SHALL be hardcoded constants, with no interpolation of request parameters, user messages, or any other client-supplied data
