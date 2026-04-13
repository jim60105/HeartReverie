## ADDED Requirements

### Requirement: Test runner configuration
The project SHALL include a test runner configuration that supports both backend (server-side) and frontend (pure-logic) test execution from a single command.

#### Scenario: Run all tests
- **WHEN** the developer executes the test command
- **THEN** all backend and frontend tests execute and report pass/fail results with exit code 0 on success, non-zero on failure

### Requirement: Test file convention
Test files SHALL be co-located alongside their source files using the `.test.js` suffix (Node.js phase) or `_test.js` suffix (Deno phase).

#### Scenario: Test file discovery
- **WHEN** the test runner scans the project
- **THEN** it discovers all files matching the test suffix pattern in `writer/` and `reader/js/` directories

### Requirement: Test isolation
Each test case SHALL be independent and not rely on shared mutable state or execution order.

#### Scenario: Tests run in any order
- **WHEN** tests are executed in a different order
- **THEN** all tests still pass without side effects from other tests
