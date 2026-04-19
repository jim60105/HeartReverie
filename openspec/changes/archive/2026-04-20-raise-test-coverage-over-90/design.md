## Context

HeartReverie already runs backend and frontend tests, but coverage workflows are fragmented: backend coverage is defined for Deno tests while frontend coverage and a repository-wide quality target are not consistently specified. Existing OpenSpec capabilities define broad test intent, but they do not yet require a traceable test-design process tied to capability scenarios or enforce a >90% overall line-coverage target.

Because the project is pre-release with no production users, we can prioritize strict quality gates without migration constraints.

## Goals / Non-Goals

**Goals:**
- Define deterministic `deno.json` coverage tasks for backend and frontend test suites.
- Introduce a unified coverage aggregation flow with an explicit overall line-coverage gate above 90%.
- Expand backend/frontend test planning expectations so new tests are driven by OpenSpec requirement scenarios.
- Make CI coverage reporting and threshold enforcement consistent with local developer workflows.

**Non-Goals:**
- Implementing production rollout safeguards, backward-compatibility shims, or data migrations.
- Refactoring unrelated runtime architecture.
- Replacing existing test frameworks (Deno test for backend, Vitest for frontend).

## Decisions

1. **Introduce explicit coverage tasks in `deno.json` for both layers plus aggregate commands.**
   - **Rationale:** Developers need one obvious path for backend-only, frontend-only, and combined coverage checks.
   - **Alternative considered:** Keep ad-hoc shell commands in CI only. Rejected because it hides workflow details from contributors and drifts from local usage.

2. **Use separate backend and frontend LCOV outputs, then evaluate one merged repository report.**
   - **Rationale:** Deno and Vitest emit coverage differently, so a merged LCOV artifact keeps CI, local validation, and Codecov aligned on the same inputs. The canonical merged report should remain `coverage.lcov` at the repository root so existing tooling can consume one stable file.
   - **Alternative considered:** Gate backend and frontend separately. Rejected because it fragments the definition of done and makes the repository-wide threshold harder to enforce consistently.

3. **Define a repository-level quality gate at >90% line coverage rather than per-file hard gates.**
   - **Rationale:** Supports rapid iteration while still enforcing strong quality.
   - **Alternative considered:** Per-module mandatory thresholds. Rejected for this change because threshold tuning across many modules is high friction for the first gate.

4. **Require scenario-traceable test design based on OpenSpec requirements.**
   - **Rationale:** Coverage percentage alone can miss behavior gaps; mapping tests to `WHEN/THEN` scenarios ensures meaningful assertions.
   - **Alternative considered:** Coverage-only policy without scenario mapping. Rejected because it encourages superficial tests.

5. **Extend CI coverage capability to aggregate and gate combined coverage uploads/results.**
   - **Rationale:** CI must enforce the same definition of done as local development.
   - **Alternative considered:** Local gate only with non-blocking CI reporting. Rejected because it permits regressions via inconsistent enforcement.

## Risks / Trade-offs

- **[Risk] Coverage gate becomes flaky due to tooling differences between backend and frontend outputs** → **Mitigation:** Specify deterministic task outputs/formats and a single aggregation command used in both local and CI paths.
- **[Risk] Pushing to >90% quickly can increase test implementation workload** → **Mitigation:** Prioritize high-impact modules and require targeted new test files tied to spec scenarios.
- **[Trade-off] Repository-level threshold may hide weak spots in specific files** → **Mitigation:** Require test-case design against OpenSpec scenarios and call out low-coverage hotspots in implementation tasks.

## Migration Plan

1. Add/adjust `deno.json` tasks for backend coverage, frontend coverage, and combined threshold checking.
2. Expand test suites with new backend/frontend test files that close scenario gaps from existing specs.
3. Update CI coverage workflow to run combined coverage gate and upload the aggregated report.
4. Validate locally and in CI, then merge.

Rollback strategy: revert the coverage-task/workflow and test additions in one change revert if gating causes unexpected disruption.

No data migration or backward compatibility steps are required.
