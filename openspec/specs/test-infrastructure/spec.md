# Test Infrastructure

## Purpose

Test runner configuration, file conventions, and isolation guarantees for both backend and frontend test execution.

## Requirements

### Requirement: Test runner configuration
The project SHALL include a test runner configuration that supports both backend (server-side) and frontend (pure-logic) test execution from a single command.

#### Scenario: Run all tests
- **WHEN** the developer executes the test command
- **THEN** all backend and frontend tests execute and report pass/fail results with exit code 0 on success, non-zero on failure

### Requirement: Test file convention

Test files SHALL be co-located alongside their source files. Writer backend test files SHALL use the `_test.ts` suffix (TypeScript). Reader frontend test files SHALL continue to use the `_test.js` suffix (JavaScript).

#### Scenario: Test file discovery
- **WHEN** the test runner scans the project
- **THEN** it discovers all files matching `_test.ts` in the `writer/` directory and all files matching `_test.js` in the `reader/js/` directory

#### Scenario: Writer tests are TypeScript
- **WHEN** a developer creates a new test file for a writer backend module
- **THEN** the test file SHALL use the `_test.ts` suffix and be written in TypeScript with proper type annotations

### Requirement: Test isolation
Each test case SHALL be independent and not rely on shared mutable state or execution order.

#### Scenario: Tests run in any order
- **WHEN** tests are executed in a different order
- **THEN** all tests still pass without side effects from other tests
