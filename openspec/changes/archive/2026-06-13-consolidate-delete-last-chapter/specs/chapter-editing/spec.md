## ADDED Requirements

### Requirement: Shared last-chapter deletion helper guarded against active generation

The backend SHALL provide a single shared helper `deleteLastChapter(dirPath)` in `writer/lib/story-chapter-io.ts` (or, if importing `pruneUsage` would create an import cycle, in a dedicated module with identical behavior) that performs every step of deleting a story's highest-numbered chapter: it SHALL list chapter files via the canonical `listChapterFiles()` helper, remove the highest-numbered chapter file `NNN.md`, best-effort remove its sidecar artifacts (`NNN-state.yaml`, `NNN-state-diff.yaml`, `current-status.yaml`) without failing when any is absent, and prune the deleted chapter's usage record via `pruneUsage(dirPath, lastNum - 1)`. The helper SHALL return `{ ok: true, deleted: <number> }` on success and `{ ok: false, reason: "no-chapters" }` when the directory contains no chapter files. The helper SHALL throw on filesystem errors other than the best-effort sidecar cleanups, leaving the active-generation guard and client-response mapping to the caller.

The HTTP `DELETE /api/stories/:series/:name/chapters/last` route SHALL consult `isGenerationActive(series, name)` after path validation and SHALL return HTTP 409 with an RFC 9457 Problem Details body without modifying any file when a generation is active for the target story. When no generation is active, the route SHALL delegate to `deleteLastChapter()`, returning HTTP 404 when the result is `{ ok: false, reason: "no-chapters" }` and HTTP 200 with `{ deleted: <number> }` on success. The route SHALL NOT re-implement chapter listing, file removal, sidecar cleanup, or usage pruning inline.

#### Scenario: DELETE last chapter is rejected during active generation
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/last` while a generation is active for `alpha/tale` (the registry refcount for `"alpha/tale"` is greater than zero)
- **THEN** the server SHALL return HTTP 409 with an RFC 9457 Problem Details body describing the active generation and SHALL NOT delete any file

#### Scenario: DELETE last chapter succeeds when idle
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/last` with no active generation and the directory contains `001.md` and `002.md`
- **THEN** the server SHALL remove `002.md` and its sidecar artifacts, prune the chapter-2 usage record, and return HTTP 200 with `{ "deleted": 2 }`

#### Scenario: DELETE last chapter when no chapters exist
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/last` and the directory contains no chapter files
- **THEN** the server SHALL return HTTP 404 with an RFC 9457 Problem Details body and SHALL NOT modify any file

#### Scenario: Helper reports no-chapters without throwing
- **WHEN** `deleteLastChapter(dirPath)` is invoked for a directory that exists but contains no `NNN.md` chapter files
- **THEN** the helper SHALL return `{ ok: false, reason: "no-chapters" }` and SHALL NOT throw
