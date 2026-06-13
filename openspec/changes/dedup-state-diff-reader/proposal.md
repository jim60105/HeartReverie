## Why

Two micro-formats each have three to four independent owners that have drifted. State-diff loading (`readTextFile` → `parseYaml` → validate `parsed?.entries` is an array) is implemented verbatim at three sites (`chapters.ts` ×2, `ws-subscribe.ts` ×1) — and the ws-subscribe copy logs read errors while the chapters copies do not. Chapter-file listing (`/^\d+\.md$/` filter + numeric sort) is re-implemented inline in `ws-subscribe.ts` and `export.ts` even though `listChapterFiles()` is the documented canonical helper with identical semantics. Any change to the diff schema or the chapter naming convention currently requires lockstep edits across files with no shared tests.

## What Changes

- Add a shared `readStateDiff(dirPath, chapterNum, logger?)` helper to `writer/lib/story-chapter-io.ts` that reads and validates the `NNN-state-diff.yaml` sidecar, returns `undefined` when the file is absent/unparseable/malformed, and logs non-`NotFound` failures through the optional logger (so parse errors and permission problems are never silent).
- Replace the three inline state-diff read sites (`chapters.ts` batch mode, `chapters.ts` single read, `ws-subscribe.ts` poll loop) with calls to the helper, preserving the WebSocket path's existing read-error logging.
- Replace the inline chapter-listing re-implementations in `ws-subscribe.ts` and `export.ts` with the canonical `listChapterFiles()`, preserving ws-subscribe's early-return-on-readDir-error behavior. `export.ts` is converted only if its listing semantics match exactly; otherwise it is left as-is and noted.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `batch-chapter-loading`: Add a requirement that state-diff sidecar reads go through a single shared `readStateDiff()` helper used by every HTTP and WebSocket read path, with consistent NotFound-vs-other error handling.
- `backend-refactor`: Add a requirement that chapter-file listing is centralized in the canonical `listChapterFiles()` helper, with no inline `/^\d+\.md$/` re-implementations remaining in the route layer.

## Impact

- Backend: `writer/lib/story-chapter-io.ts` (new `readStateDiff`); `writer/routes/chapters.ts`, `writer/routes/ws-subscribe.ts`, `writer/routes/export.ts` (call-site swaps; remove now-unused `parseYaml` imports).
- Tests: new unit test for `readStateDiff` (valid / missing / malformed / no-entries); existing route tests pin the HTTP/WS response shapes as the regression net.
- Coordination: depends on the `consolidate-delete-last-chapter` change (which removes `ws-chat.ts`'s inline listing — don't double-fix) and the `log-swallowed-backend-errors` change (coordinated catch-narrowing — the helper's optional logger is the shared end state). No on-disk format change; no migration concerns (pre-release).
