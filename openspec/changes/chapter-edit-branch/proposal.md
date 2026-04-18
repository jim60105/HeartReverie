## Why

HeartReverie currently offers almost no chapter management: a past chapter cannot be edited, and only the single most recent chapter can be deleted (`DELETE /api/stories/:series/:name/chapters/last`). This prevents authors from fixing earlier chapters, exploring alternative story paths, or recovering from a bad generation that happened several chapters ago. Adding editing, branching, and rewinding turns the reader into a proper authoring tool and unlocks the "what-if" storytelling workflow that interactive fiction requires.

## What Changes

- Add `PUT /api/stories/:series/:name/chapters/:number` to replace the content of any existing chapter file (`NNN.md`) atomically.
- Add `DELETE /api/stories/:series/:name/chapters/after/:number` to truncate the story by removing all chapter files with a number strictly greater than `:number` (rewind). This supersedes the narrow `DELETE .../chapters/last` endpoint conceptually; the existing endpoint remains for now.
- Add `POST /api/stories/:series/:name/branch` to fork the story at a given chapter. The handler copies chapters `001.md`…`NNN.md` (inclusive) into a new story directory under the same series. Body: `{ fromChapter: number, newName?: string }`. If `newName` is omitted, a name is generated as `<story>-branch-<unix-timestamp>`. Lore is **shared by reference** (not copied) because lore lives at the series/global scope under `_lore/` and is orthogonal to chapter content; any story-scoped `_lore/` inside the source story IS copied so the branch remains self-contained.
- Ensure atomic writes for chapter edits and branch copies (write to a temp file in the same directory, then `Deno.rename`) to keep concurrent readers (polling / WebSocket subscribers) from observing half-written files.
- Reject edits and rewinds targeting a story while an LLM generation is actively writing to that story's latest chapter, returning HTTP 409 Conflict.
- Frontend: add an "Edit" button on each chapter in `ChapterContent.vue` opening an editor, a "Branch from here" action, and a "Rewind to here" action. Wire them through a new `useChapterActions` composable that calls the new APIs via `useAuth` headers. After successful edit or rewind, reload chapters via `useChapterNav.reloadToLast()` / `loadFromBackendInternal`. After successful branch, navigate to the newly created story.
- Propagate edit/rewind changes to other connected clients by relying on the existing per-connection server-side polling in `writer/routes/ws.ts` (the `subscribe` message): subscribers already poll the story directory every 1 s and emit `chapters:updated` on chapter-count changes and `chapters:content` on last-chapter content changes, so no new broadcast pathway is required.

## Capabilities

### New Capabilities

- `chapter-editing`: CRUD-style management of existing chapters (edit content of any chapter, rewind the story by truncating trailing chapters) and story branching (fork a story at a chosen chapter into a new story directory). Covers backend API endpoints, path safety, atomic file operations, concurrency guarding against active generation, and the frontend UI composable + controls exposed in `ChapterContent.vue`.

### Modified Capabilities

<!-- None. The existing writer-backend `Delete last chapter` requirement is left intact; the new rewind endpoint is additive and lives in the new chapter-editing capability. -->

## Impact

- **Backend code**: `writer/routes/chapters.ts` (new PUT and DELETE-after handlers), new `writer/routes/branch.ts` (or extend `chapters.ts`) for `POST .../branch`, `writer/app.ts` (register new routes), `writer/lib/story.ts` (shared helpers: `listChapterFiles`, `atomicWriteChapter`, `copyChapterRange`, `isGenerationActive`), `writer/types.ts` (new request/response interfaces, `WsChaptersUpdatedMessage` already exists and will be reused).
- **Backend concurrency**: introduce a per-story "active generation" registry (in-memory `Map<string, number>` keyed by `<series>/<story>` with a refcount value) populated by `writer/lib/chat-shared.ts` — increments the refcount when a chat begins and decrements it on completion/abort; the edit and rewind handlers reject the request whenever the refcount for the key is greater than zero. A refcount is required so that two overlapping generations on the same story do not let the first `finally` clear the entry while the second is still writing.
- **Frontend code**: `reader-src/src/composables/useChapterActions.ts` (new), `reader-src/src/composables/useChapterNav.ts` (minor — expose a way to reload arbitrary chapter indices after edit), `reader-src/src/components/ChapterContent.vue` (edit/branch/rewind buttons and inline editor), `reader-src/src/types/index.ts` (API response types).
- **Tests**: `tests/writer/routes/chapters_test.ts` (new PUT/DELETE-after cases, atomicity, concurrency rejection), new `tests/writer/routes/branch_test.ts`, frontend tests for `useChapterActions`.
- **Security**: new endpoints reuse `safePath()`, `validateParams`, and the existing `X-Passphrase` auth middleware. Branch target names go through `isValidParam()`. The body-size limit (1 MiB) already covers chapter edit payloads.
- **Rate limiting**: mutating endpoints inherit the global `/api/*` limiter (300 req/min); no new bucket required for a single-user app.
- **Docs**: update `AGENTS.md` "Project Structure" if new files are added, and the REST surface section in `openspec/specs/writer-backend/spec.md` stays unchanged (no requirement edits) but a short note in the branch/edit spec references it.
- **No breaking changes**: existing `DELETE .../chapters/last` endpoint and all current behavior are preserved.
