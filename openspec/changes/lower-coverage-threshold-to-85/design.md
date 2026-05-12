## Context

The repository's combined backend + frontend line-coverage gate is currently set to **strictly greater than 90%**. The number is encoded in three places:

1. `deno.json` task `coverage:threshold` → `deno run --allow-read scripts/coverage.ts gate coverage.lcov 90`
2. `openspec/specs/coverage-quality-gate/spec.md` (the canonical normative requirement)
3. `openspec/specs/ci-coverage-codecov-upload/spec.md` (CI-side scenario referencing the same threshold)

`scripts/coverage.ts gate` already implements strict-greater-than: pass iff `percent > threshold`, fail iff `percent ≤ threshold`. Both CI (`.github/workflows/ci.yaml` `coverage` job → `deno task test:coverage`) and local development consume the same task, so a single change in `deno.json` plus matching spec deltas keeps everything coherent.

## Goals / Non-Goals

**Goals:**
- Reduce friction on routine, low-risk PRs that currently fail because they marginally drop coverage on unrelated paths.
- Keep one source of truth — the threshold number must be identical across the gate script invocation, the local task, the CI scenario, and the canonical spec.
- Preserve the existing strict-greater-than comparison semantics so the meaning of "85%" is unambiguous: 85.01% passes, 85.00% fails.

**Non-Goals:**
- Per-module / per-package thresholds (still global combined line coverage).
- Adding branch / function / statement coverage axes (still line coverage only).
- Touching the unrelated 75% Rust crate gate in `HeartReverie_Plugins/openspec/specs/state-tests/spec.md`.
- Removing or weakening the coverage gate altogether — 85% remains a strong floor.
- Migrating away from `scripts/coverage.ts` or changing the LCOV merge pipeline.

## Decisions

### Decision 1 — Lower to 85 rather than 80 or 88

Chose **85** as a deliberate compromise:
- Far enough below today's 90 to give meaningful breathing room for the routine work that keeps tripping the gate.
- High enough to remain a credible floor — well above the typical "warm" baseline of ~70% and clearly signalling that the project takes testing seriously.
- Round, easy to remember, and easy to roll back later (raise to 88 or 90) if the floor proves insufficient.

Alternatives considered:
- **80%**: Too permissive given the current actuals; would leave too much slack and risk silent erosion.
- **88%**: Only 2 points lower than today — barely changes the calculus and would likely need another reduction soon.
- **Keep 90% and add per-module exemptions**: Adds spec complexity, configuration burden in `scripts/coverage.ts`, and a maintenance backlog of exemption review. Rejected as out of scope.

### Decision 2 — Keep strict-greater-than (`>`) semantics

The existing `scripts/coverage.ts gate` implementation uses `percent <= threshold` for failure (equivalently, `percent > threshold` for pass). Both spec scenarios already mirror that wording. Preserve the semantics — change only the number — to avoid a second behavioural change sneaking in alongside the threshold relaxation.

Alternative considered: switch to `>=` (allow exactly 85.00% to pass). Rejected: introduces a second normative change, is not what the user asked for, and forces re-reading every consumer of the threshold to confirm intent.

### Decision 3 — Update both spec files (not just one)

The threshold number appears in two specs:
- `coverage-quality-gate` owns the *requirement*.
- `ci-coverage-codecov-upload` references the same number inside a CI-side *scenario*.

Both must stay in lockstep with the implementation; otherwise `openspec validate --strict` (and human readers) will see contradictory normative text. The change ships modified-capability deltas for both.

Alternative considered: update only `coverage-quality-gate` and rely on cross-reference. Rejected: each spec is independently authoritative for its own scenarios; leaving the CI scenario stating "≤ 90%" would create a real spec contradiction even though the runtime behaviour would happen to agree with `coverage-quality-gate`.

### Decision 4 — `deno.json` is the only code touch

`scripts/coverage.ts` accepts the threshold as a CLI argument. CI does not duplicate the number; it shells out to the deno task. So a one-line edit to the `coverage:threshold` task in `deno.json` is the entire implementation surface. No additional refactoring or constant extraction is warranted for a single integer that already lives in exactly one runtime location.

## Risks / Trade-offs

- **[Risk]** Lowering the gate could mask gradual coverage erosion that would otherwise surface as visible CI failures. → **Mitigation**: 85% is still high; significant erosion will breach it. Reviewers retain authority to ask for tests on PRs they consider under-tested regardless of the gate. Codecov upload (untouched by this change) continues to provide trend visibility per-PR for human review.
- **[Risk]** Number drift between the three locations (`deno.json`, two specs) on future bumps. → **Mitigation**: Implementation tasks include a single sweep that touches all three in one commit; archive step syncs the modified deltas into the canonical specs, so the spec text stays automatically aligned with the gate behaviour. Future changes to the threshold will follow the same propose → spec deltas → apply pattern.
- **[Trade-off]** Authors lose a small amount of pressure to write tests they otherwise might not. → **Accepted**: We prefer a smaller number of well-aimed tests over coverage-padding tests, and the rubber-duck + review loop is the appropriate place to catch genuinely under-tested logic.

## Migration Plan

No migration required (pre-release, zero in-the-wild users). The deploy steps are:

1. Land the deno.json + spec delta edits in a single commit.
2. Push to `master`; CI's `coverage` job re-runs `deno task test:coverage` with the new threshold.
3. If the run passes, the change is effectively live — no cache invalidation, no follow-up steps.

Rollback strategy: revert the commit. No data, schema, or external state is touched.

## Open Questions

_None._ The change is a single numeric relaxation with no ambiguity about scope, semantics, or affected files.
