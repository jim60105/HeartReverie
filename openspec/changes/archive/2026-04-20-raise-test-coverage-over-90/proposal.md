## Why

Current test execution is split between backend and frontend, but coverage workflows are backend-centric and do not define a unified quality target. To prevent regression while the project is still fast-moving, we need explicit coverage tasks and spec-level expectations that drive total line coverage above 90%.

## What Changes

- Extend the existing backend-only coverage flow with an explicit frontend coverage task and a single aggregate task that both local developers and CI can run.
- Standardize backend and frontend coverage outputs so they can be merged into the canonical root `coverage.lcov` report and evaluated against a repository-wide line coverage target greater than 90%.
- Expand backend and frontend testing requirements so new and missing scenarios are covered with additional test files where needed, using existing test-file conventions.
- Require test-case design to trace to existing OpenSpec capability requirements (behavioral scenarios and edge cases), not ad-hoc assertions.
- Treat backward compatibility and migration as out of scope because the project is pre-release with no production users.

## Capabilities

### New Capabilities
- `coverage-quality-gate`: Unified coverage orchestration and quality gating across backend + frontend test suites.

### Modified Capabilities
- `test-infrastructure`: Add coverage-task conventions, stable artifact paths, and combined coverage execution/reporting requirements.
- `backend-tests`: Expand required scenario coverage and file-level expectations to support >90% overall line coverage.
- `frontend-tests`: Expand required scenario coverage and file-level expectations to support >90% overall line coverage.
- `ci-coverage-codecov-upload`: Extend CI coverage behavior from backend-only reporting to overall coverage tracking with threshold enforcement.

## Impact

- Affected code: `deno.json`, backend tests under `tests/writer/`, frontend tests under `reader-src/src/**/__tests__/`, and Vitest coverage configuration needed for frontend LCOV output.
- Affected automation: `.github/workflows/ci.yaml` coverage job and Codecov upload inputs.
- Affected specs: `test-infrastructure`, `backend-tests`, `frontend-tests`, `ci-coverage-codecov-upload`, and new `coverage-quality-gate`.
