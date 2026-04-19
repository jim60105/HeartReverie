## Context

HeartReverie currently has a single CI workflow (`.github/workflows/ci.yaml`) that checks out code, sets up Deno, builds the frontend, and runs tests. It does not produce or publish coverage data. A reference workflow in `/var/home/jim60105/repos/air-friends/.github/workflows/ci.yaml` already demonstrates a Deno-based coverage pipeline with LCOV generation and Codecov upload.

The project is in an early, unreleased stage, so this design does not need migration or backward-compatibility safeguards.

## Goals / Non-Goals

**Goals:**
- Implement the `ci-coverage-codecov-upload` capability end to end in CI.
- Add deterministic CI coverage generation for backend Deno tests.
- Publish CI coverage to Codecov on push, pull request, and manual workflow runs.
- Reuse existing CI conventions (checkout, Deno setup, cache strategy) to keep maintenance low.

**Non-Goals:**
- Introducing breaking-change mitigation or migration paths.
- Enforcing a minimum coverage threshold in this change.
- Implementing frontend (Vitest) coverage aggregation in the same upload.

## Decisions

1. **Add a dedicated `coverage` job in `.github/workflows/ci.yaml`**
   - **Rationale:** Keeps current test job behavior stable and isolates coverage-specific logic and failures.
   - **Alternative considered:** Append coverage steps directly to the existing `test` job. Rejected because it couples pass/fail semantics and makes troubleshooting slower.

2. **Generate LCOV from Deno backend test coverage**
   - **Rationale:** Existing backend tests already run with Deno; Deno-native coverage tooling is straightforward and aligns with the reference workflow.
   - **Alternative considered:** Combined backend + frontend coverage in one upload. Rejected for now because frontend coverage tooling is separate and would add setup complexity.

3. **Upload with `codecov/codecov-action@v5` using `CODECOV_TOKEN`**
   - **Rationale:** Standard GitHub integration with minimal custom scripting.
   - **Alternative considered:** Upload via Codecov CLI script. Rejected due to extra maintenance and less transparent workflow configuration.

4. **Mirror core CI setup from the reference workflow**
   - **Rationale:** Reusing known-good job structure (checkout, `setup-deno`, cache, coverage, upload) reduces trial-and-error and keeps patterns consistent across projects.

## Risks / Trade-offs

- **[Risk] Missing or invalid `CODECOV_TOKEN` causes upload failure** -> **Mitigation:** Document secret requirement and keep failure visible in workflow logs.
- **[Risk] Coverage command drift if test paths change** -> **Mitigation:** Use shared Deno tasks where possible and keep coverage commands localized in CI/script tasks.
- **[Trade-off] Backend-only coverage initially** -> **Mitigation:** Leave extension path for frontend coverage in a follow-up change.

## Migration Plan

1. Add/update CI workflow and any supporting Deno coverage task commands.
2. Configure `CODECOV_TOKEN` in repository secrets.
3. Validate coverage upload on a pull request run.
4. Roll back by reverting workflow changes if upload failures block CI unexpectedly.

No data migration or user-facing compatibility steps are required.

## Open Questions

- Should coverage upload be required for CI pass, or non-blocking in early iterations?
- Should a minimum threshold gate be introduced in a follow-up change after baseline stabilization?
