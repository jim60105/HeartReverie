## Why

The current CI workflow only builds and runs tests, so coverage trends are invisible in pull requests and regressions are harder to catch early. Adding automated coverage upload to Codecov gives maintainers immediate feedback while the project is still pre-release.

## What Changes

- Update `.github/workflows/ci.yaml` to include a dedicated coverage job, following the Deno coverage structure used in `/var/home/jim60105/repos/air-friends/.github/workflows/ci.yaml`.
- Run backend tests with Deno coverage instrumentation and generate an LCOV file (`coverage.lcov`) in CI.
- Upload the LCOV report to Codecov via `codecov/codecov-action@v5` using `CODECOV_TOKEN`.
- Keep existing test/build validation behavior intact while adding coverage reporting as an additional CI outcome.
- Explicitly treat backward compatibility and migration as out of scope for this change because the project is pre-release with no production users.

## Capabilities

### New Capabilities
- `ci-coverage-codecov-upload`: CI generates test coverage output and uploads it to Codecov on supported workflow triggers.

### Modified Capabilities
- None.

## Impact

- Affected code: `.github/workflows/ci.yaml` and any supporting task/documentation files for coverage commands.
- External dependency: GitHub Action `codecov/codecov-action@v5`.
- Repository configuration: requires `CODECOV_TOKEN` secret for upload.
