## ADDED Requirements

### Requirement: CI SHALL evaluate combined backend and frontend coverage
CI coverage execution SHALL run both backend and frontend coverage tasks, merge their artifacts, and evaluate a combined repository line-coverage gate.

#### Scenario: CI runs aggregate coverage command
- **WHEN** the CI workflow reaches the coverage stage
- **THEN** it SHALL execute the aggregate coverage command that includes backend and frontend coverage generation
- **AND** it SHALL use the canonical root `coverage.lcov` merged artifact produced by that command for gating and upload

#### Scenario: CI enforces repository threshold
- **WHEN** combined line coverage is less than or equal to 90%
- **THEN** the CI workflow SHALL fail before reporting success

### Requirement: CI SHALL upload aggregated coverage artifacts to Codecov
CI SHALL upload the canonical root `coverage.lcov` aggregated coverage report produced by the shared coverage workflow to Codecov using repository secret token configuration.

#### Scenario: Codecov upload uses aggregated report
- **WHEN** coverage artifacts are generated successfully
- **THEN** CI SHALL upload the root `coverage.lcov` aggregated coverage report file via `codecov/codecov-action@v5`
- **AND** the upload SHALL use `CODECOV_TOKEN` from repository secrets
