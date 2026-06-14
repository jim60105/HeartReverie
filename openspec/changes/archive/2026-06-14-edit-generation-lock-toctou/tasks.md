## 1. Investigate and demonstrate the race

- [x] 1.1 CONFIRMED same lock domain: `runUnderGenerationLock` (`writer/lib/chat-shared.ts:145`) calls `tryMarkGenerationActive`/`clearGenerationActive` from `./generation-registry.ts`, which operate on the single module-level `activeGenerations` Map. Same registry as the chapter routes. No STOP.
- [x] 1.2 AUDIT (branch.ts): `routes/branch.ts` has NO generation guard at all, but it is a read-only-on-source operation that copies chapters from `srcDir` into a brand-new `destDir` (`copyChapterFile`, `Deno.writeTextFile` to the new story). It never mutates the source story's chapter files, so it is not a check-then-write data-loss site like PUT/rewind. Left unchanged per non-goals; reported here.
- [x] 1.3 Write a test in `tests/writer/routes/chapters_test.ts` that seeds a story with one EMPTY last chapter (number-reuse precondition per `resolveTargetChapterNumber`), starts a PUT whose JSON body read is artificially slow so it parks after the early guard, acquires the lock via `tryMarkGenerationActive` while parked, then lets the PUT proceed and asserts the current write-under-lock behavior (proving the window)
- [x] 1.4 N/A — the Hono harness parked the PUT deterministically via a streaming `ReadableStream` request body (`duplex: "half"`) whose `pull()` awaits a test-controlled promise, so the handler parks on `await c.req.json()` after clearing its early guard. No fallback to direct sequencing needed.
- [x] 1.5 RACE REPRODUCED (NOT rejected): against the unfixed code the red test showed the PUT returned HTTP 200 and wrote "EDITED" to disk while `tryMarkGenerationActive` was held mid-flight (log: `Chapter edited … bytes:6` under an active lock). The concurrent-edit test likewise showed both PUTs writing. The atomic-locking fix (group 2) therefore proceeds.

## 2. Make the guard atomic with the mutation

- [x] 2.1 In the PUT route, after content/body validation and `safePath`, replace the sole early guard with `if (!tryMarkGenerationActive(series, name)) return 409;` and wrap `Deno.stat` + `atomicWriteChapter` + state-file cleanup in `try { … } finally { clearGenerationActive(series, name); }`
- [x] 2.2 Keep the early `isGenerationActive` check as a cheap pre-body fast-fail (now an optimization, not the guard)
- [x] 2.3 Apply the same acquire/`finally` structure to the rewind route: acquire before the first `Deno.remove`, release in `finally` after `pruneUsage`
- [x] 2.4 Update imports to include `tryMarkGenerationActive` and `clearGenerationActive`
- [x] 2.5 `consolidate-delete-last-chapter` HAS landed (its early `isGenerationActive` guard is in `DELETE .../chapters/last`). Upgraded DELETE-last to the same `tryMarkGenerationActive` + `finally clearGenerationActive` atomic pattern.
- [x] 2.6 Verify Step 1's red test now passes (PUT returns 409 when the lock is taken mid-flight) and existing 409 tests still pass

## 3. Tests

- [x] 3.1 Confirm the race test is green after group 2
- [x] 3.2 Add a PUT-while-PUT concurrent-edit test: the second edit returns 409 while the first holds the lock; assert and document this semantics change
- [x] 3.3 Confirm existing PUT/rewind 409 + success tests pass unchanged (the acquire/release is invisible to sequential callers)
- [x] 3.4 Run `deno task test:backend`; all pass including the race test and the concurrent-edit test

## 4. Gates

- [x] 4.1 PUT and rewind both use `tryMarkGenerationActive`/`clearGenerationActive` with `finally` (verify by reading the diff)
- [x] 4.2 `deno task fmt && deno task lint` exit 0
- [x] 4.3 No files outside the in-scope list modified (`git status`)

## 5. Mandatory container integration verification (BLOCKING — only if the change proceeds past investigation)

> Per the workspace's mandatory integration-verification protocol, this section is BLOCKING for runtime-affecting changes. It applies ONLY IF group 1 reproduced the race and group 2 was applied. If the change was marked "not reproducible" and abandoned in group 1, SKIP this section entirely (there is no runtime change to verify).

- [x] 5.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh`
- [x] 5.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean
- [x] 5.3 Exercise a `PUT .../chapters/:number` edit via `curl -H "X-Passphrase: ..." localhost:8080/...` and confirm a normal edit succeeds (200) when no generation is active
- [x] 5.4 Container exercised the happy paths (PUT 200, rewind 200, single + batch chapter reads 200, clean startup with the `state` plugin loaded). The 409-under-active-lock behavior is deterministically proven by the backend test suite — the TOCTOU race test (lock acquired mid-flight → PUT 409, file unchanged) and the PUT-while-PUT concurrent-edit test (second → 409) both pass; runtime 409 reproduction additionally requires a live LLM generation to hold the lock, which the harness simulates exactly via `tryMarkGenerationActive`.
- [x] 5.5 Only after 5.1–5.4 pass, mark the change complete and commit
