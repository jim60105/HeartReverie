## Context

"Delete the last chapter" exists in three places that have drifted:

1. `writer/routes/chapters.ts` — HTTP `DELETE /api/stories/:series/:name/chapters/last`. It lists chapters via `listChapterFiles`, removes the last file, best-effort removes `NNN-state.yaml` / `NNN-state-diff.yaml` / `current-status.yaml`, and returns `{ deleted: lastNum }`. It has **no** `isGenerationActive` check and **no** `pruneUsage` call — unlike the sibling PUT and rewind routes which both guard with `isGenerationActive(series, name)` (returning 409) and rewind which prunes with `pruneUsage(dir, num)`.
2. `writer/routes/ws-chat.ts` — `handleChatResend` re-implements the delete inline (`readDir` + `/^\d+\.md$/` filter + numeric sort + remove + the same three state-file cleanups), then calls `pruneUsage(storyDir, lastNum - 1)`. Its catch block sends `"Failed to delete last chapter"` to the client but **never logs** the error.
3. The frontend HTTP fallback for resend calls the unguarded, non-pruning HTTP variant, so the two transports differ.

Relevant existing primitives:
- `writer/lib/story-chapter-io.ts` — `listChapterFiles(dir)` is the canonical lister (returns `[]` on `NotFound`).
- `writer/lib/generation-registry.ts` — exports `isGenerationActive`, `markGenerationActive`, `clearGenerationActive`, `tryMarkGenerationActive`.
- `writer/lib/usage.ts` — `pruneUsage(storyDir, keepThroughChapter)` keeps records with `chapter <= keepThroughChapter`; to prune deleted chapter `N`, call `pruneUsage(dir, N - 1)`.
- `writer/lib/errors.ts` — `problemJson(title, status, detail)`; `errorMessage(err)`.

Constraints: TypeScript strict, double quotes, semicolons, JSDoc on functions, AGPL header on new files, RFC 9457 errors via `problemJson`. Pre-release, 0 users — no backward-compatibility or migration concerns.

## Goals / Non-Goals

**Goals:**
- One shared `deleteLastChapter(dirPath)` helper that owns listing, file removal, sidecar cleanup, and usage pruning.
- HTTP DELETE-last and WebSocket resend both call that helper, both guard against active generation, and neither swallows deletion errors.
- The off-by-one usage-prune semantics (`pruneUsage(dir, lastNum - 1)` removes exactly chapter `lastNum`'s record) are exercised by a test.

**Non-Goals:**
- Touching the PUT-chapter and rewind routes' guards — they are already correct; the TOCTOU hardening of those guards is the separate `edit-generation-lock-toctou` change.
- Any frontend change. The HTTP resend fallback inheriting the new 409 is acceptable; a friendlier zh-TW message is optional follow-up.
- Changing `writer/lib/usage.ts` or `writer/lib/generation-registry.ts` (consumers only).

## Decisions

- **Helper home**: place `deleteLastChapter` in `writer/lib/story-chapter-io.ts` alongside `listChapterFiles`. The helper imports `pruneUsage` from `./usage.ts`. Decision rationale: keeps last-chapter I/O concerns co-located. Alternative considered: a dedicated `writer/lib/story-chapter-delete.ts`. We choose the dedicated module **only** if importing `pruneUsage` into `story-chapter-io.ts` would create an import cycle (verify that `usage.ts` does not import from `story-chapter-io.ts`); on a cycle, fall back to the dedicated module with identical content and an AGPL header.
- **Helper return shape**: `DeleteLastChapterResult = { ok: true; deleted: number } | { ok: false; reason: "no-chapters" }`. This lets each transport map "no chapters" to its own client response (HTTP 404 vs `chat:error` `"No chapters to delete"`) while filesystem errors throw and are handled by the caller's catch block.
- **Guard placement**: the active-generation guard stays in the route/handler, not the helper, because the two transports return different shapes (HTTP 409 Problem Details vs WebSocket `chat:error`) and the helper must remain transport-agnostic. The helper's JSDoc states the caller owns the guard.
- **Error logging on resend**: the resend catch block distinguishes `Deno.errors.NotFound` ("Story not found") from other errors, logs other errors with `errorMessage(err)` before sending the generic `"Failed to delete last chapter"` to the client.

## Risks / Trade-offs

- [Off-by-one in usage pruning corrupts totals] → A dedicated test seeds chapters 1 and 2 with usage records, deletes the last chapter, and asserts only the chapter-1 record remains.
- [Import cycle when pulling `pruneUsage` into `story-chapter-io.ts`] → Verify no cycle first; if one would result, move the helper to `writer/lib/story-chapter-delete.ts`. If both placements cycle, STOP and report.
- [New 409 path breaks existing DELETE-last tests] → Only intended behavior changes (409-under-generation, usage pruning) update test expectations; if existing tests pin DELETE-last succeeding *during* an active generation, that is a STOP condition (the unguarded behavior would be intentionally pinned) — report instead of overriding.
- [Frontend resend fallback now sees 409] → Acceptable; surfaces as a generic resend failure. Out of scope to prettify here.

## Migration Plan

Not applicable — pre-release project, 0 users, no on-disk or wire-shape migration. The only observable new behavior is the 409 response when a generation is active and the corrected usage totals after a last-chapter delete.

## Dependencies / Coordination

- This change is the **base** for the `shared-chat-error-translator` change (both edit `ws-chat.ts`); land this one first to avoid merge conflicts.
- This change is also a prerequisite for `edit-generation-lock-toctou`: that change makes *all* chapter-mutation guards (including this DELETE-last guard) atomic with their mutation. This change only adds the (early, non-atomic) guard; the atomicity upgrade is deferred to that change.
- The `dedup-state-diff-reader` change depends on this one removing the inline chapter listing from `ws-chat.ts` (don't double-fix the listing).

## Open Questions

- None. The helper placement decision is resolved at implementation time by the import-cycle check.
