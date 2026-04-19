## ADDED Requirements

### Requirement: Test task catalog SHALL include coverage-specific commands
The root `deno.json` task catalog SHALL define separate coverage commands for backend and frontend test suites, plus an aggregate coverage check command that contributors can run without custom shell scripting.

#### Scenario: Coverage commands are discoverable in deno task list
- **WHEN** contributors inspect `deno.json` tasks
- **THEN** they SHALL find named coverage commands for backend, frontend, and aggregate checks

#### Scenario: Aggregate command executes both layers
- **WHEN** contributors run the aggregate coverage command
- **THEN** it SHALL execute backend and frontend coverage commands in a deterministic sequence

### Requirement: Coverage command outputs SHALL support CI reuse
Coverage task outputs SHALL use stable file paths and machine-readable formats so CI can reuse the same artifacts without duplicating logic, including a canonical merged `coverage.lcov` report at the repository root.

#### Scenario: CI consumes local coverage outputs
- **WHEN** CI invokes the same aggregate coverage command used locally
- **THEN** CI SHALL read backend and frontend coverage artifacts from the documented output paths
- **AND** CI SHALL consume the canonical root `coverage.lcov` merged report produced by the aggregate command
- **AND** CI SHALL evaluate the same threshold result as local execution
