## 1. Coverage task orchestration

- [x] 1.1 Update `deno.json` to define explicit frontend and backend coverage tasks (`test:frontend:coverage`, `test:backend:coverage`) and an aggregate coverage task.
- [x] 1.2 Configure frontend coverage output so Vitest emits a machine-readable LCOV artifact that can be merged with backend coverage.
- [x] 1.3 Define stable coverage artifact output paths and formats so local and CI runs use the same files, including the canonical merged `coverage.lcov` report.
- [x] 1.4 Add a threshold-check task that fails when combined line coverage is less than or equal to 90%.

## 2. Backend coverage expansion

- [x] 2.1 Run backend coverage reports to identify under-tested writer modules and route branches.
- [x] 2.2 Add new `_test.ts` files under `tests/writer/` for uncovered high-impact modules where no direct tests exist.
- [x] 2.3 Extend existing backend tests with validation, error-path, and edge-case scenarios required by existing OpenSpec backend capabilities.
- [x] 2.4 Ensure backend new/updated tests are traceable to OpenSpec `WHEN/THEN` scenarios in relevant specs and describe the scenario in the test name or block title.

## 3. Frontend coverage expansion

- [x] 3.1 Run frontend coverage reports to identify under-tested reader components, composables, and parser branches.
- [x] 3.2 Add new `.test.ts` files in `reader-src/src/**/__tests__/` for uncovered behaviors required by existing frontend capabilities.
- [x] 3.3 Extend existing frontend tests for branch/fallback/empty-state flows and integration boundaries.
- [x] 3.4 Ensure frontend new/updated tests are traceable to OpenSpec `WHEN/THEN` scenarios in relevant specs and describe the scenario in the test name or block title.

## 4. CI and quality gate integration

- [x] 4.1 Update `.github/workflows/ci.yaml` coverage steps to run the aggregate coverage task used locally.
- [x] 4.2 Upload the aggregated coverage report to Codecov via `codecov/codecov-action@v5` and `CODECOV_TOKEN`.
- [x] 4.3 Enforce CI failure when combined line coverage does not exceed 90%.

## 5. Verification

- [x] 5.1 Run `deno task test:backend` and `deno task test:frontend` to confirm test suites remain green.
- [x] 5.2 Run coverage tasks and verify combined line coverage is greater than 90%.
- [x] 5.3 Validate that CI coverage job and local aggregate coverage command produce consistent pass/fail behavior.
