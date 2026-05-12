## 1. Lower the gate

- [ ] 1.1 Update `deno.json` task `coverage:threshold` to invoke `scripts/coverage.ts gate coverage.lcov 85` (replace the `90`).
- [ ] 1.2 Run `deno task test:coverage` locally and confirm the run reports the new threshold (`> 85.00%`) and exits successfully.

## 2. Verify CI parity

- [ ] 2.1 Confirm `.github/workflows/ci.yaml` still simply invokes `deno task test:coverage` (no hard-coded numeric duplicate to update).
- [ ] 2.2 After landing the commit, watch the next CI run on master to confirm the coverage job evaluates against 85 and reports the new pass-threshold log line.

## 3. Validate the change

- [ ] 3.1 Run `openspec validate lower-coverage-threshold-to-85 --strict` and confirm it reports the change as valid.
- [ ] 3.2 Dry-run the spec sync to surface delta-application errors that `validate --strict` does not catch (the `coverage-quality-gate` requirement title changes, so RENAMED + MODIFIED must apply cleanly): run `openspec sync --change lower-coverage-threshold-to-85 --dry-run` (or the equivalent `openspec apply --dry-run` available in this project), and confirm both the RENAMED and MODIFIED operations succeed against the canonical spec text before archiving.
- [ ] 3.3 Manual check: `grep -rn "90" openspec/specs/coverage-quality-gate/ openspec/specs/ci-coverage-codecov-upload/` — after archive, no stale `90` should remain in the coverage spec text (other historical mentions in `archive/` are immutable and out of scope).
