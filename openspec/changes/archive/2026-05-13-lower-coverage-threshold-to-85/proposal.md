## Why

The current 90% combined-line-coverage gate has become an obstacle to proportionate engineering rather than a quality signal. Routine, low-risk changes — refactors, docs, plugin manifest tweaks, even spec-only edits — are blocked because they marginally drop the percentage on largely unrelated paths. Authors are pushed into writing low-value tests purely to defend the number, which dilutes the signal of the suites we already maintain.

Lowering the gate to **85%** preserves a strong floor (well above the unspoken industry baseline of ~70%) while restoring headroom for the kind of additive, well-tested work this project actually ships. Reviewers and the rubber-duck loop already catch logic gaps; the gate exists to prevent collapse, not to mandate exhaustive coverage of code that does not warrant it.

## What Changes

- Lower the combined backend + frontend line-coverage gate from **>90%** to **>85%** and keep all threshold references (deno.json task, both spec files) aligned at the new value.
- Update `deno.json` task `coverage:threshold` to invoke `scripts/coverage.ts gate coverage.lcov 85` (currently `90`).
- Update both spec files that encode the number (`coverage-quality-gate`, `ci-coverage-codecov-upload`) so the local gate, the CI gate, and the spec all agree.
- Strict-greater-than semantics are preserved: pass when combined coverage is **> 85%**, fail when **≤ 85%** (matches the existing `scripts/coverage.ts gate` comparison).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `coverage-quality-gate`: The "Combined line coverage SHALL be greater than 90 percent" requirement is restated with a 85% threshold (requirement title, body, and both pass/fail scenarios all updated).
- `ci-coverage-codecov-upload`: The CI threshold-enforcement scenario under "CI SHALL evaluate combined backend and frontend coverage" is updated from `≤ 90%` to `≤ 85%` so CI and local gating remain identical.

## Impact

- **Code**: `deno.json` (one task definition).
- **Specs**: `openspec/specs/coverage-quality-gate/spec.md`, `openspec/specs/ci-coverage-codecov-upload/spec.md` (synced from this change's deltas during archive).
- **CI**: `.github/workflows/ci.yaml` is unaffected — it shells out to `deno task test:coverage`, which transitively calls the updated `coverage:threshold` task.
- **Tests**: No new tests required; the change is a single numeric threshold relaxation. Existing coverage suites continue to run unchanged.
- **Documentation**: Nothing ships in `docs/` mentioning the explicit number; no doc update needed.
- **Backward compatibility / migration**: Not applicable — pre-release project, zero users in the wild.
