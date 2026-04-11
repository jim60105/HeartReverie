## MODIFIED Requirements

### Requirement: Test file convention
Test files SHALL reside in a dedicated `tests/` directory at the project root, mirroring the source directory structure. Backend tests use the `_test.ts` suffix under `tests/writer/`. Frontend tests use the `_test.js` suffix under `tests/reader/js/`.

#### Scenario: Test file discovery
- **WHEN** the test runner scans the project
- **THEN** it discovers all files matching the test suffix pattern in `tests/writer/` and `tests/reader/js/` directories

### Requirement: Test runner configuration
The project SHALL include a test runner configuration that supports both backend (server-side) and frontend (pure-logic) test execution from a single command.

#### Scenario: Run all tests
- **WHEN** the developer executes the test command
- **THEN** all backend and frontend tests execute from the `tests/` directory and report pass/fail results with exit code 0 on success, non-zero on failure
