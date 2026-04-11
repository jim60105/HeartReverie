# test-infrastructure

## MODIFIED Requirements

### Requirement: Test file convention

Test files SHALL be co-located alongside their source files. Writer backend test files SHALL use the `_test.ts` suffix (TypeScript). Reader frontend test files SHALL continue to use the `_test.js` suffix (JavaScript).

#### Scenario: Test file discovery
- **WHEN** the test runner scans the project
- **THEN** it discovers all files matching `_test.ts` in the `writer/` directory and all files matching `_test.js` in the `reader/js/` directory

#### Scenario: Writer tests are TypeScript
- **WHEN** a developer creates a new test file for a writer backend module
- **THEN** the test file SHALL use the `_test.ts` suffix and be written in TypeScript with proper type annotations
