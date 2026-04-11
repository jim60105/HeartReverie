# Post-Response Patch — Delta Spec (plugin-consolidation)

## MODIFIED Requirements

### Requirement: Post-response status update

After each completed AI response, the `apply-patches` execution SHALL be triggered via the plugin hook system (`post-response` stage) by the consolidated `state-patches` plugin (formerly `apply-patches`). The `state-patches` plugin SHALL register a `post-response` hook handler that invokes the Rust `apply-patches` binary located at `./plugins/state-patches/rust/target/release/apply-patches`. The binary path SHALL reflect the new plugin directory structure after consolidation. The command SHALL be run as a child process using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response. If the binary is not found, the handler SHALL log a warning and continue without patching.

#### Scenario: Successful patch execution via hook
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the `state-patches` plugin's hook handler SHALL execute `execFile('./plugins/state-patches/rust/target/release/apply-patches', ['playground'])`, await its completion, and the hook chain SHALL continue

#### Scenario: Patch execution failure via hook
- **WHEN** the `apply-patches` command exits with a non-zero exit code or produces stderr output during the `post-response` hook
- **THEN** the hook handler SHALL log a warning including the exit code and stderr content, but SHALL NOT fail the hook chain, and the HTTP response SHALL return the chapter content

#### Scenario: apply-patches binary not found during hook
- **WHEN** the `apply-patches` binary does not exist at the expected path `./plugins/state-patches/rust/target/release/apply-patches`
- **THEN** the handler SHALL log a warning indicating the binary was not found, return without error, and the hook chain and HTTP response SHALL proceed normally

#### Scenario: No post-response hook registered
- **WHEN** no plugin has registered a `post-response` hook handler (e.g., the state-patches plugin is disabled or not loaded)
- **THEN** the server SHALL skip the `post-response` hook stage and return the HTTP response without running `apply-patches`
