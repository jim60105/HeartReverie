## ADDED Requirements

### Requirement: Backend test expansion SHALL target uncovered writer modules
Backend test work for this change SHALL add or extend `tests/writer/**` files to cover previously under-tested writer modules and route branches that materially impact line coverage.

#### Scenario: New backend test file added for uncovered module
- **WHEN** a writer module with behavior required by existing OpenSpec capabilities lacks adequate tests
- **THEN** a new `_test.ts` file SHALL be added under `tests/writer/` for that module

#### Scenario: Existing backend test adds error-path assertions
- **WHEN** route or library logic has untested validation or failure branches
- **THEN** tests SHALL include those error-path assertions with explicit expected status/output

### Requirement: Backend coverage tests SHALL be spec-scenario driven
New backend test cases SHALL be derived from scenario expectations in relevant OpenSpec specs (for example route validation, security rejection, and prompt/rendering behavior).

#### Scenario: Backend test references OpenSpec behavior
- **WHEN** a backend test case is added to close a coverage gap
- **THEN** its assertions SHALL align with a concrete `WHEN/THEN` behavior from an existing backend-related spec
