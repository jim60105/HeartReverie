## Why

> **CONTINGENT CHANGE — investigate-first.** This change is conditional on first **reproducing the race**: a failing (red) test that demonstrates a chapter write proceeding while a generation lock is held mid-flight (i.e. a write under an active generation lock). If that reproduction fails — no interleaving where the write proceeds under an active lock can be demonstrated — this change is to be **abandoned/closed and NOT archived**, and the atomic-locking requirement below must **not** be adopted speculatively. The MODIFIED requirement describes the behavior *under the demonstrated race*; it is normative only once the race is shown.

The PUT-chapter and rewind routes check `isGenerationActive(series, name)` **early**, then perform multiple awaits (body read, `Deno.stat`) before writing. A chat request only acquires the generation lock late in `executeChat` (after its own prompt-building awaits). Between the edit route's check and its write, a `chat:send` can legitimately acquire the lock and start streaming into the same chapter file — and when the last chapter is empty the chat path reuses its number. The interleaving then silently loses either the edit or the streamed content (the stream holds a handle to the renamed-away inode). The window is narrow (sub-second, same user, two tabs/devices), but the failure mode is silent data loss. This change first **demonstrates the race in a test**, then closes it by holding the same atomic lock across the mutation.

## What Changes

- Add a red test that demonstrates the TOCTOU window: a PUT whose body read is artificially slow passes its early guard, then a lock is acquired mid-flight (simulating the chat path winning the race), and the PUT currently writes anyway. If the interleaving cannot be demonstrated, the change is marked **not reproducible** and no speculative fix is applied.
- Make the guard atomic with the mutation in the PUT-chapter route: after body validation, acquire the lock with `tryMarkGenerationActive(series, name)` (returning HTTP 409 on failure) and release it in a `finally` wrapping the `Deno.stat` + `atomicWriteChapter` + state-file cleanup. Keep the early `isGenerationActive` check as a cheap pre-body fast-fail (now an optimization, not the guard).
- Apply the same acquire/`finally` structure to the rewind route (acquire before the first `Deno.remove`, release after `pruneUsage`).
- **BREAKING (semantics)**: two concurrent edits to the same story now serialize — the second receives HTTP 409 while the first holds the lock (previously both could proceed). This is asserted and documented.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `chapter-editing`: Modify the chapter-mutation protection requirement so the PUT-chapter and rewind handlers acquire the generation lock atomically with their mutation (via `tryMarkGenerationActive`/`clearGenerationActive` in a `finally`), closing the check-then-write window and serializing concurrent edits.
- `streaming-cancellation`: Add a requirement documenting that the generation lock now also guards chapter-edit and rewind mutations (not only LLM generations), so an edit cannot interleave with a streaming generation against the same story.

## Impact

- Backend: `writer/routes/chapters.ts` (PUT and rewind routes).
- Tests: `tests/writer/routes/chapters_test.ts` — the race test (red → green), a concurrent-edit (PUT-while-PUT) 409 test, and the existing 409 + success tests (must pass unchanged).
- Depends on the `consolidate-delete-last-chapter` change (which adds the DELETE-last guard); this change makes all such guards atomic. The DELETE-last atomicity upgrade is applied here only if that change already landed, otherwise noted.
- Out of scope: moving the chat-side lock earlier (would block edits for seconds) and `routes/branch.ts` (audit-and-report only). No on-disk or wire-shape migration concerns (pre-release).
