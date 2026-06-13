## Investigate-first / conditional adoption

This change follows plan 008 Step 1: it is **investigate-then-fix**, and adoption of the atomic-locking fix is **conditional on first reproducing the race**. Step 1 writes a red test that demonstrates a chapter write proceeding while a generation lock is held mid-flight (a write under an active generation lock). The atomic-locking requirement in `specs/chapter-editing/spec.md` is normative **only under that demonstrated race** — it must not be treated as an unconditional implementation mandate.

**STOP condition (mirrors plan 008 Step 1):** if neither the Hono test harness nor direct sequencing can demonstrate an interleaving where the write proceeds under an active lock, **STOP** — mark this change **not reproducible**, abandon/close it, and do **NOT** archive it or apply Step 2 (the atomic acquire/`finally`) speculatively. In that branch the existing early-check behavior stays as-is and no behavior change is required.

## Context

The chapter-mutation routes guard against an active generation **early**, then await before writing:

- `writer/routes/chapters.ts:191-196` (PUT) — early `if (isGenerationActive(series, name)) return 409;`, then `await c.req.json()` (:200), `await Deno.stat(filePath)` (:222), `await atomicWriteChapter(dirPath, chapterFile, content)` (:233), then a state-file cleanup loop (:242-251).
- The rewind route (:277-282) has the same shape with its own deletions afterward.

Meanwhile `writer/lib/chat-shared.ts:229` acquires the generation lock LATE, via `runUnderGenerationLock(series, name, async () => { ...stream... })`, after prompt building. So between an edit route's check and its write, a `chat:send` can acquire the lock and start streaming into the same chapter file. When the last chapter is empty, the chat path reuses its number (`resolveTargetChapterNumber`, `writer/lib/story-chapter-io.ts:193-197`), and the interleaving silently loses either the edit or the stream (the stream holds a handle to the renamed-away inode).

The lock API (`writer/lib/generation-registry.ts`):
- `tryMarkGenerationActive(series, name): boolean` — atomic check-and-acquire (single-threaded JS guarantees atomicity; JSDoc at :60-72).
- `clearGenerationActive(series, name)` — refcount decrement.
- `isGenerationActive(series, name)` — read-only check.

Existing 409 tests: `tests/writer/routes/chapters_test.ts:484` (PUT) and `:620` (rewind) call `markGenerationActive` then expect 409.

Constraints: TS strict. Pre-release, 0 users. Confidence is MED — the code paths are verified but the practical race depends on event-loop interleaving not reproduced during the audit, hence the investigate-first step.

## Goals / Non-Goals

**Goals:**
- First demonstrate (or refute) the race with a test that proves a PUT can write while a lock is held mid-flight.
- If reproducible, hold the generation lock atomically across the mutation in both the PUT and rewind routes so a concurrent generation (or concurrent edit) cannot interleave.
- Preserve the existing early-fast-fail and existing 409/success behavior for sequential callers (the new acquire/release must be invisible to them).

**Non-Goals:**
- Moving the chat-side lock earlier — that would hold the lock during prompt building and block edits for seconds; rejected.
- Modifying `routes/branch.ts` — audit it for the same pattern during the investigation and REPORT, but do not change it here.
- Modifying DELETE-last here unless the `consolidate-delete-last-chapter` change already landed (it adds the DELETE-last guard); the same atomicity upgrade applies but is conditional.

## Decisions

- **Investigate-then-fix**: Step 1 writes a test that parks a PUT on its slow body read after the early guard, acquires the lock via `tryMarkGenerationActive` mid-flight, then lets the PUT proceed and asserts the current (buggy) write-under-lock behavior to prove the window exists. If the Hono test harness cannot park the PUT deterministically, fall back to direct sequencing of the guard logic and the write logic with an interleaved lock acquisition. If no interleaving where the write proceeds under an active lock can be demonstrated, STOP and mark the change **not reproducible** — do not apply a speculative fix.
- **Atomic acquire around the mutation only**: replace the early check pattern with `if (!tryMarkGenerationActive(series, name)) return 409;` placed **after** content/body validation (so malformed requests don't churn the lock), wrapping `Deno.stat` + `atomicWriteChapter` + state-file cleanup in a `try { … } finally { clearGenerationActive(series, name); }`. Same structure for rewind (acquire before the first `Deno.remove`, release after `pruneUsage`).
- **Keep the early `isGenerationActive` check** as a cheap fast-fail before body parsing; it becomes an optimization, not the guard.
- **Use the same registry as the chat path**: confirm `runUnderGenerationLock` uses the same registry as `tryMarkGenerationActive`. If they were two separate lock domains, the fix would be ineffective — that is a STOP condition.
- **`finally` correctness**: any early return inside the mutation block must still release the lock; the reviewer focus is `finally` placement.

## Risks / Trade-offs

- [Race not reproducible] → Mark the change REJECTED / not-reproducible with a status note from Step 1; do not apply Step 2 speculatively.
- [Two lock domains] → If `runUnderGenerationLock` uses a different registry than `tryMarkGenerationActive`, STOP and report the discrepancy.
- [Reentrancy / deadlock] → If holding the lock across the mutation deadlocks any existing test, that indicates reentrancy somewhere — STOP and report.
- [Semantics change: concurrent edits now serialize] → This is intended and asserted by a new PUT-while-PUT 409 test; document it explicitly. Previously two concurrent edits could both proceed.

## Migration Plan

Not applicable — pre-release, 0 users. The only observable change is the new 409 for concurrent edits and the closed data-loss window. Rollback is reverting the acquire/finally to the early check.

## Dependencies / Coordination

- **Depends on `consolidate-delete-last-chapter`**: that change adds the (early, non-atomic) generation guard to DELETE-last. This change makes all chapter-mutation guards atomic. Apply the same acquire/`finally` upgrade to DELETE-last here only if the consolidation change already landed; otherwise note it as a follow-up. Anyone adding a new chapter-file mutation route must use the same acquire/`finally` pattern.

## Open Questions

- Whether the race is reproducible through the Hono test harness vs direct sequencing — resolved in Step 1. If neither demonstrates it, the change ends as not-reproducible.
- Whether `routes/branch.ts` shares the pattern — investigated and reported, not fixed here.
