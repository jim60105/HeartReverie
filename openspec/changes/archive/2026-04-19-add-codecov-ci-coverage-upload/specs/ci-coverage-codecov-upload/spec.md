## ADDED Requirements

### Requirement: CI SHALL generate an LCOV coverage report for backend tests
The CI workflow SHALL execute backend Deno tests with coverage instrumentation and produce an LCOV report file at `coverage.lcov`.

#### Scenario: Coverage report is generated during CI
- **WHEN** the CI workflow runs on push, pull request, or workflow_dispatch
- **THEN** backend tests are executed with Deno coverage enabled
- **AND** an LCOV file is generated at `coverage.lcov` for subsequent upload

### Requirement: CI SHALL upload coverage results to Codecov
The CI workflow SHALL upload the generated LCOV report to Codecov by using the Codecov GitHub Action and repository secret token configuration.

#### Scenario: Coverage upload step runs after LCOV generation
- **WHEN** the LCOV file exists after the coverage generation step
- **THEN** the workflow invokes `codecov/codecov-action@v5` with that file
- **AND** the upload uses `CODECOV_TOKEN` from repository secrets
