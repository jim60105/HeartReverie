## 1. CI workflow coverage pipeline (`ci-coverage-codecov-upload`)

- [x] 1.1 Update `.github/workflows/ci.yaml` to add a dedicated `coverage` job using the existing Deno setup/cache pattern and the `air-friends` CI workflow as reference.
- [x] 1.2 Implement backend coverage commands in CI to run Deno tests with coverage output and generate `coverage.lcov`.
- [x] 1.3 Add a Codecov upload step using `codecov/codecov-action@v5` wired to `CODECOV_TOKEN`.

## 2. Project task and configuration support

- [x] 2.1 Add or refine Deno task commands (if needed) so coverage generation used by CI is explicit and maintainable.
- [x] 2.2 Ensure workflow configuration explicitly references `coverage.lcov` and `CODECOV_TOKEN` in the Codecov upload step.

## 3. Verification and rollout

- [x] 3.1 Validate that the updated CI workflow syntax is correct and coverage steps execute in the expected order.
- [x] 3.2 Validate that CI logs show `coverage.lcov` generation before the Codecov action step is executed.
