## 1. Lower the gate

- [x] 1.1 Update `deno.json` task `coverage:threshold` to invoke `scripts/coverage.ts gate coverage.lcov 85` (replace the `90`).
- [x] 1.2 Run `deno task test:coverage` locally and confirm the run reports the new threshold (`> 85.00%`) and exits successfully.
      → Verified: `Combined line coverage: 89.38% (threshold: > 85.00%)` → `Coverage gate passed.`

## 2. Verify CI parity

- [x] 2.1 Confirm `.github/workflows/ci.yaml` still simply invokes `deno task test:coverage` (no hard-coded numeric duplicate to update).
      → Verified: `ci.yaml` calls `deno task test:coverage`, no duplicate threshold.
- [ ] 2.2 After landing the commit, watch the next CI run on master to confirm the coverage job evaluates against 85 and reports the new pass-threshold log line.
      → Deferred until commit is pushed; not blocking apply.

## 3. Validate the change

- [x] 3.1 Run `openspec validate lower-coverage-threshold-to-85 --strict` and confirm it reports the change as valid.
- [x] 3.2 Verify the delta will merge cleanly (`openspec` has no dry-run apply/sync command — only `archive` performs the merge, so this is a pre-archive sanity check rather than a real dry-run).
      → Equivalent verification done by: (a) the prior rubber-duck (gpt-5.5) review of the proposal flagged that the requirement-title rename required a `RENAMED Requirements` block — added; (b) manual reading confirmed the `FROM` title in the RENAMED block matches the canonical spec exactly, and the MODIFIED block uses the `TO` title. Archive will perform the actual merge.
- [ ] 3.3 Manual check: `grep -rn "90" openspec/specs/coverage-quality-gate/ openspec/specs/ci-coverage-codecov-upload/` — after archive, no stale `90` should remain in the coverage spec text (other historical mentions in `archive/` are immutable and out of scope).
      → Deferred until archive step.
