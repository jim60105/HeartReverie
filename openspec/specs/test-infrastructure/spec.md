# Test Infrastructure

## Purpose

Test runner configuration, file conventions, and isolation guarantees for both backend and frontend test execution.

## Requirements

### Requirement: Test runner configuration
The project SHALL include a test runner configuration that supports both backend (server-side) and frontend (pure-logic) test execution from a single command.

#### Scenario: Run all tests
- **WHEN** the developer executes the test command
- **THEN** all backend and frontend tests execute from the `tests/` directory and report pass/fail results with exit code 0 on success, non-zero on failure

### Requirement: Test file convention

Test files SHALL reside in a dedicated `tests/` directory at the project root, mirroring the source directory structure. Backend tests use the `_test.ts` suffix under `tests/writer/`. Frontend tests use the `_test.js` suffix under `tests/reader/js/`.

#### Scenario: Test file discovery
- **WHEN** the test runner scans the project
- **THEN** it discovers all files matching the test suffix pattern in `tests/writer/` and `tests/reader/js/` directories

#### Scenario: Writer tests are TypeScript
- **WHEN** a developer creates a new test file for a writer backend module
- **THEN** the test file SHALL use the `_test.ts` suffix and be written in TypeScript with proper type annotations

### Requirement: Test isolation
Each test case SHALL be independent and not rely on shared mutable state or execution order.

#### Scenario: Tests run in any order
- **WHEN** tests are executed in a different order
- **THEN** all tests still pass without side effects from other tests

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
