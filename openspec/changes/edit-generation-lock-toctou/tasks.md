## 1. Investigate and demonstrate the race

- [ ] 1.1 Read `runUnderGenerationLock` (`grep -n "runUnderGenerationLock" writer/lib/*.ts`) and confirm it uses the same registry as `tryMarkGenerationActive`; if they are separate lock domains, STOP and report
- [ ] 1.2 Audit `routes/branch.ts` for the same early-check-then-write pattern and REPORT findings (do not modify it)
- [ ] 1.3 Write a test in `tests/writer/routes/chapters_test.ts` that seeds a story with one EMPTY last chapter (number-reuse precondition per `resolveTargetChapterNumber`), starts a PUT whose JSON body read is artificially slow so it parks after the early guard, acquires the lock via `tryMarkGenerationActive` while parked, then lets the PUT proceed and asserts the current write-under-lock behavior (proving the window)
- [ ] 1.4 If the Hono harness cannot park the PUT deterministically, fall back to direct sequencing of the guard logic and write logic with an interleaved lock acquisition
- [ ] 1.5 If no interleaving where the write proceeds under an active lock can be demonstrated (the red test cannot be made to show a write-under-lock), STOP: mark the plan/change **REJECTED ("not reproducible")**, abandon/close the change WITHOUT archiving it, and do NOT apply group 2 (the atomic acquire/`finally`) speculatively — the atomic-locking requirement is contingent on this reproduction

## 2. Make the guard atomic with the mutation

- [ ] 2.1 In the PUT route, after content/body validation and `safePath`, replace the sole early guard with `if (!tryMarkGenerationActive(series, name)) return 409;` and wrap `Deno.stat` + `atomicWriteChapter` + state-file cleanup in `try { … } finally { clearGenerationActive(series, name); }`
- [ ] 2.2 Keep the early `isGenerationActive` check as a cheap pre-body fast-fail (now an optimization, not the guard)
- [ ] 2.3 Apply the same acquire/`finally` structure to the rewind route: acquire before the first `Deno.remove`, release in `finally` after `pruneUsage`
- [ ] 2.4 Update imports to include `tryMarkGenerationActive` and `clearGenerationActive`
- [ ] 2.5 If the `consolidate-delete-last-chapter` change already landed, apply the same acquire/`finally` upgrade to DELETE-last; otherwise note it as follow-up
- [ ] 2.6 Verify Step 1's red test now passes (PUT returns 409 when the lock is taken mid-flight) and existing 409 tests still pass

## 3. Tests

- [ ] 3.1 Confirm the race test is green after group 2
- [ ] 3.2 Add a PUT-while-PUT concurrent-edit test: the second edit returns 409 while the first holds the lock; assert and document this semantics change
- [ ] 3.3 Confirm existing PUT/rewind 409 + success tests pass unchanged (the acquire/release is invisible to sequential callers)
- [ ] 3.4 Run `deno task test:backend`; all pass including the race test and the concurrent-edit test

## 4. Gates

- [ ] 4.1 PUT and rewind both use `tryMarkGenerationActive`/`clearGenerationActive` with `finally` (verify by reading the diff)
- [ ] 4.2 `deno task fmt && deno task lint` exit 0
- [ ] 4.3 No files outside the in-scope list modified (`git status`)

## 5. Mandatory container integration verification (BLOCKING — only if the change proceeds past investigation)

> Per the workspace's mandatory integration-verification protocol, this section is BLOCKING for runtime-affecting changes. It applies ONLY IF group 1 reproduced the race and group 2 was applied. If the change was marked "not reproducible" and abandoned in group 1, SKIP this section entirely (there is no runtime change to verify).

- [ ] 5.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh`
- [ ] 5.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean
- [ ] 5.3 Exercise a `PUT .../chapters/:number` edit via `curl -H "X-Passphrase: ..." localhost:8080/...` and confirm a normal edit succeeds (200) when no generation is active
- [ ] 5.4 With a generation active for the same story, confirm a concurrent `PUT` (and a `DELETE .../chapters/after/:number` rewind) returns HTTP 409 without writing the chapter file
- [ ] 5.5 Only after 5.1–5.4 pass, mark the change complete and commit
