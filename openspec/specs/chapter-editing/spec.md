# Chapter Editing

## Purpose

Provides CRUD-style management of existing chapters and story branching. Covers editing the content of any past chapter, rewinding a story by truncating trailing chapters, and forking a story at a chosen chapter into a new story directory. Includes backend API endpoints, path safety, atomic file operations, concurrency guarding against active LLM generation, and the frontend UI composable + controls exposed in `ChapterContent.vue`.

## Requirements

### Requirement: Edit an existing chapter

The server SHALL expose `PUT /api/stories/:series/:name/chapters/:number` that replaces the content of an existing chapter file `NNN.md` within the story directory. The endpoint SHALL accept a JSON body `{ content: string }`. The request body SHALL be valid JSON and `content` SHALL be a string; a malformed JSON body or a non-string `content` field SHALL cause the server to return HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT touch the filesystem. Path parameters SHALL be validated with `validateParams` and resolved with `safePath()`; `:number` SHALL be parsed as a positive integer (greater than or equal to 1) and zero-padded to three digits before lookup — values that are not a positive integer (e.g., `0`, negative numbers, non-numeric strings) SHALL cause the server to return HTTP 400. The write SHALL be atomic: the server SHALL write the new content to a temporary file in the same directory (e.g., `NNN.md.tmp-<uuid>`) and then `Deno.rename` it over the target path so concurrent readers never observe a partial file. If the target chapter file does not exist, the server SHALL return HTTP 404. On success, the server SHALL return HTTP 200 with `{ number, content }`. The endpoint SHALL NOT directly broadcast a WebSocket message; propagation to other connected clients is handled by the existing per-connection 1-second server-side polling in `writer/routes/ws.ts`, which will emit `chapters:content` when the last chapter's content changes on disk. The endpoint SHALL inherit the global 1 MiB body limit and the standard `X-Passphrase` authentication middleware.

#### Scenario: Replace an existing chapter's content
- **WHEN** a client sends `PUT /api/stories/alpha/tale/chapters/2` with body `{ "content": "new text" }` and `002.md` exists
- **THEN** the server SHALL atomically replace `002.md` with `new text` and return HTTP 200 with `{ "number": 2, "content": "new text" }`; WebSocket subscribers of `alpha/tale` whose 1-second poller next ticks will observe the new on-disk state and the existing polling path will push a `chapters:content` message when the edit targets the last chapter

#### Scenario: Edit a chapter that does not exist
- **WHEN** a client sends `PUT /api/stories/alpha/tale/chapters/9` and `009.md` is missing
- **THEN** the server SHALL NOT create the file and SHALL return HTTP 404 with an RFC 9457 Problem Details body

#### Scenario: Edit rejected while generation is active
- **WHEN** a client sends `PUT /api/stories/alpha/tale/chapters/3` while `executeChat()` is actively streaming into the same story
- **THEN** the server SHALL return HTTP 409 with an RFC 9457 Problem Details body describing the active generation and SHALL NOT modify any file

#### Scenario: Invalid chapter number
- **WHEN** the `:number` path segment is not a positive integer (e.g., `abc`, `0`, `-1`)
- **THEN** the server SHALL return HTTP 400 without touching the filesystem

#### Scenario: Malformed JSON body is rejected
- **WHEN** a client sends `PUT /api/stories/alpha/tale/chapters/2` with a body that is not valid JSON (e.g., a truncated payload or invalid syntax)
- **THEN** the server SHALL return HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT touch the filesystem

#### Scenario: Non-string content field is rejected
- **WHEN** a client sends `PUT /api/stories/alpha/tale/chapters/2` with body `{ "content": 123 }` or `{ "content": null }` or a body missing the `content` field entirely
- **THEN** the server SHALL return HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT touch the filesystem

### Requirement: Rewind a story by truncating trailing chapters

The server SHALL expose `DELETE /api/stories/:series/:name/chapters/after/:number` that deletes every chapter file `MMM.md` in the story directory whose numeric value is strictly greater than `:number`. Path parameters SHALL be validated with `validateParams` and resolved with `safePath()`. `:number` SHALL be parsed as a non-negative integer (i.e., `0` or greater); a value of `0` means "delete all chapters", and any non-numeric or negative value SHALL cause the server to return HTTP 400. Deletion SHALL be performed in descending numeric order so that a partial failure leaves the lowest prefix intact. On success the server SHALL return HTTP 200 with `{ deleted: number[] }` listing the deleted chapter numbers in ascending order. The endpoint SHALL NOT directly broadcast a WebSocket message; the existing per-connection 1-second server-side polling in `writer/routes/ws.ts` will detect the chapter-count change on its next tick and push `chapters:updated` to each subscribed connection. The endpoint SHALL return HTTP 409 if an LLM generation is currently active for the target story.

#### Scenario: Rewind keeps chapters 1..N and removes the rest
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/after/2` and the directory contains `001.md`, `002.md`, `003.md`, `004.md`
- **THEN** the server SHALL remove `004.md` then `003.md` and return HTTP 200 with `{ "deleted": [3, 4] }`; subscribed WebSocket clients will receive `chapters:updated` with `count: 2` via the next tick of the existing 1-second poller in `writer/routes/ws.ts`

#### Scenario: Rewind with number 0 clears the story
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/after/0` and chapters `001.md`..`003.md` exist
- **THEN** the server SHALL remove all three files and return HTTP 200 with `{ "deleted": [1, 2, 3] }`

#### Scenario: Rewind is a no-op when no chapters exceed the threshold
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/after/5` and only `001.md`..`003.md` exist
- **THEN** the server SHALL return HTTP 200 with `{ "deleted": [] }`; because no files changed on disk, the existing 1-second polling in `writer/routes/ws.ts` will not observe a change and subscribers will receive no new message

#### Scenario: Rewind rejected during active generation
- **WHEN** a client sends `DELETE /api/stories/alpha/tale/chapters/after/2` while `executeChat()` is streaming into that story
- **THEN** the server SHALL return HTTP 409 and SHALL NOT delete any files

### Requirement: Branch a story at a chosen chapter

The server SHALL expose `POST /api/stories/:series/:name/branch` that forks the target story by copying chapters `001.md` through `NNN.md` (inclusive, where `N = fromChapter`) into a new story directory within the same series. The request body SHALL be valid JSON matching `{ fromChapter: number, newName?: string }`; a malformed JSON body, a missing `fromChapter`, a non-numeric `fromChapter`, or a non-string `newName` SHALL cause the server to return HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT create any directory. `fromChapter` SHALL be a positive integer (greater than or equal to 1) less than or equal to the current highest chapter number; a value of `0`, a negative value, or a non-integer number SHALL cause the server to return HTTP 400. If the source story directory `playground/:series/:name/` does not exist, the server SHALL return HTTP 404 with an RFC 9457 Problem Details body and SHALL NOT create any directory. When `newName` is omitted, the server SHALL generate it as `<originalName>-branch-<unixMillis>`. `newName` SHALL be validated with `isValidParam()` — reserved prefixes (leading `_` or `.`), path traversal segments, and empty strings SHALL be rejected with HTTP 400. The destination directory SHALL be created with `Deno.mkdir(..., { recursive: false })`; if it already exists the server SHALL return HTTP 409. Each copied chapter SHALL be written atomically (temp file + `Deno.rename` in the destination directory). If a story-scoped `_lore/` subdirectory exists in the source, it SHALL be recursively copied into the destination so the branch is self-contained for story-level lore; series-level and global lore SHALL remain shared by reference (not copied). If any step fails after `Deno.mkdir` succeeds, the server SHALL make a best-effort recursive removal of the destination directory before returning an error response. On success the server SHALL return HTTP 201 with `{ series, name, copiedChapters }`.

#### Scenario: Branch creates a new story with chapters up to the branch point
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with body `{ "fromChapter": 2, "newName": "tale-alt" }` and `tale/` contains `001.md`..`004.md`
- **THEN** the server SHALL create `playground/alpha/tale-alt/` containing exact copies of `001.md` and `002.md`, SHALL NOT copy `003.md` or `004.md`, and SHALL return HTTP 201 with `{ "series": "alpha", "name": "tale-alt", "copiedChapters": 2 }`

#### Scenario: Branch auto-generates a name when newName is omitted
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with body `{ "fromChapter": 1 }`
- **THEN** the server SHALL create a new story directory named `tale-branch-<timestamp>` where `<timestamp>` is a positive integer, copy `001.md` into it, and return the generated name in the response

#### Scenario: Branch copies story-scoped lore only
- **WHEN** a client branches a story that contains `tale/_lore/world.md` and the series also has `playground/alpha/_lore/people.md`
- **THEN** the new story directory SHALL contain `_lore/world.md` and SHALL NOT contain `people.md`; the series-level `_lore/` directory SHALL be unchanged

#### Scenario: Branch fails when destination already exists
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with `newName: "existing"` and `playground/alpha/existing/` already exists
- **THEN** the server SHALL return HTTP 409 and SHALL NOT modify the existing directory

#### Scenario: Branch rejects reserved or invalid new names
- **WHEN** the request body contains `newName` equal to `_hidden`, `.secret`, `..`, an empty string, or a name containing path separators
- **THEN** the server SHALL return HTTP 400 and SHALL NOT create any directory

#### Scenario: Branch rejects fromChapter exceeding the highest existing chapter
- **WHEN** the client sends `{ "fromChapter": 10 }` but the story only has `001.md`..`003.md`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body describing the out-of-range value

#### Scenario: Branch rejects non-positive fromChapter
- **WHEN** the client sends `{ "fromChapter": 0 }`, `{ "fromChapter": -1 }`, or a non-integer `fromChapter`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch rejects malformed JSON body
- **WHEN** the client sends a request body that is not valid JSON, omits `fromChapter`, or supplies a non-string `newName`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch returns 404 when the source story does not exist
- **WHEN** a client sends `POST /api/stories/alpha/missing/branch` with a valid body but `playground/alpha/missing/` does not exist
- **THEN** the server SHALL return HTTP 404 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch cleans up on partial failure
- **WHEN** the destination directory is created but copying the second chapter fails (e.g., I/O error)
- **THEN** the server SHALL recursively remove the destination directory and return HTTP 500 with a Problem Details body

### Requirement: Protect chapter mutations from racing an active generation

The server SHALL maintain a per-story active-generation registry as an in-memory `Map<string, number>` keyed by `"<series>/<name>"` whose value is the number of generations currently streaming into that story (a refcount). `writer/lib/chat-shared.ts` SHALL increment the refcount for the key before opening the LLM SSE stream and SHALL decrement it in a `finally` block that covers stream completion, errors, and aborts triggered by `chat:abort`; when the refcount would drop to zero the entry SHALL be removed from the map. The chapter edit (`PUT .../chapters/:number`) and rewind (`DELETE .../chapters/after/:number`) handlers SHALL consult this registry via a shared helper (e.g., `isGenerationActive(series, name)`) which SHALL return `true` iff the key is present with a value greater than zero, and SHALL return HTTP 409 with an RFC 9457 Problem Details body when active. A plain `Set<string>` is insufficient because two overlapping generations against the same story would let the first generation's `finally` delete the key while the second is still writing; the refcount ensures the registry accurately reflects whether *any* generation is still streaming. The branch handler SHALL NOT consult the registry — branching is a read-only operation on the source and captures whatever the source file contains at copy time.

#### Scenario: Registry entry is cleared after normal stream completion
- **WHEN** `executeChat()` finishes streaming a chapter for `alpha/tale` and it was the only active generation for that story
- **THEN** the refcount for `"alpha/tale"` SHALL drop to zero, the entry SHALL be removed from the map, and a subsequent `PUT .../chapters/:number` SHALL proceed

#### Scenario: Registry entry is cleared after chat:abort
- **WHEN** a client sends a WebSocket `chat:abort` during the only active generation for `alpha/tale`
- **THEN** the refcount for `"alpha/tale"` SHALL drop to zero and the entry SHALL be removed from the map after the abort handler runs, even though generation did not complete normally

#### Scenario: Overlapping generations keep the story locked until the last one finishes
- **WHEN** two generations for `alpha/tale` overlap in time and the first one completes (or is aborted) while the second is still streaming
- **THEN** the refcount SHALL drop from `2` to `1` but the entry SHALL remain in the map, and a `PUT .../chapters/:number` or `DELETE .../chapters/after/:number` sent in that window SHALL still be rejected with HTTP 409

#### Scenario: Concurrent edit is rejected during generation
- **WHEN** the registry has a refcount ≥ 1 for `"alpha/tale"` and a client sends `PUT /api/stories/alpha/tale/chapters/1`
- **THEN** the server SHALL respond HTTP 409 with `type`, `title`, `status: 409`, and a `detail` field referencing the active generation

### Requirement: Frontend exposes edit, rewind, and branch actions per chapter

The reader frontend SHALL provide UI controls to invoke the three mutation endpoints on the currently displayed chapter. A composable `reader-src/src/composables/useChapterActions.ts` SHALL expose async functions `editChapter(number, content)`, `rewindAfter(number)`, and `branchFrom(number, newName?)`. Each function SHALL use `useAuth().getAuthHeaders()` to authenticate and SHALL surface backend error responses to the caller. `reader-src/src/components/ChapterContent.vue` SHALL render an action toolbar on each chapter containing at minimum an "Edit" control that opens an inline textarea pre-populated with the current chapter content, a "Rewind to here" control, and a "Branch from here" control.

**After a successful edit the frontend SHALL call `useChapterNav().refreshAfterEdit(targetChapter)` (NOT `reloadToLast()`), where `targetChapter` is the chapter number the user edited. This guarantees the user stays on the chapter they just modified instead of being teleported to the last chapter of the story. `refreshAfterEdit` SHALL invalidate the rendered chapter view such that, when `<ChapterContent>` next renders, the markdown rendering pipeline re-runs and plugin `frontend-render` and `chapter:render:after` hooks are dispatched for that render — even when the new content is byte-identical to the old content. The `ContentArea.vue` sidebar relocation watch (defined in the `vue-component-architecture` spec) SHALL re-run as part of the same render-invalidation cycle so any newly-produced `.plugin-sidebar` panels are moved into `<Sidebar>`.**

After a successful rewind the frontend SHALL reload the chapter list and navigate to the new last chapter (`reloadToLast()`). After a successful branch the frontend SHALL navigate to the newly created story via Vue Router. These controls SHALL be unconditionally available — backend mode is the only reader mode and supports all three mutations.

#### Scenario: Edit flow updates content and stays on the edited chapter
- **WHEN** the user clicks "Edit" on chapter 2, modifies the text, and clicks "Save"
- **THEN** the frontend SHALL call `PUT /api/stories/:series/:name/chapters/2`, and on HTTP 200 SHALL call `useChapterNav().refreshAfterEdit(2)`. After the call resolves, `currentIndex` SHALL correspond to chapter 2 (not the last chapter), the URL SHALL be `/<series>/<story>/chapter/2`, and `<ChapterContent>` SHALL have re-rendered chapter 2 with all plugin `frontend-render` and `chapter:render:after` hooks dispatched

#### Scenario: Edit flow re-renders even on byte-identical save
- **WHEN** the user opens the editor on chapter 3, makes no changes, clicks "Save", and the server returns the unchanged content
- **THEN** `refreshAfterEdit(3)` SHALL invalidate the rendered chapter view (via `triggerRef` on `currentContent` plus a `renderEpoch` increment, as defined in the `chapter-navigation` spec), so that when `<ChapterContent>` next renders, `tokens` is re-evaluated and plugins that mutate tokens (e.g. `chapter:render:after` decorators) re-apply their effects

#### Scenario: Edit flow does not call reloadToLast
- **WHEN** the user saves an edit on any chapter
- **THEN** `ChapterContent.vue#saveEdit` SHALL NOT call `useChapterNav().reloadToLast()`; it SHALL call `refreshAfterEdit(targetChapter)`

#### Scenario: Rewind confirms before deleting
- **WHEN** the user clicks "Rewind to here" on chapter 2 and confirms the action
- **THEN** the frontend SHALL call `DELETE /api/stories/:series/:name/chapters/after/2`, and on HTTP 200 SHALL reload the chapter list and navigate to chapter 2 via `reloadToLast()`

#### Scenario: Branch navigates to the new story
- **WHEN** the user clicks "Branch from here" on chapter 3 and submits the dialog
- **THEN** the frontend SHALL call `POST /api/stories/:series/:name/branch` with `fromChapter: 3`, and on HTTP 201 SHALL navigate via Vue Router to the named `chapter` route `/:series/:story/chapter/:chapter` (resolving to `/:series/<newName>/chapter/3` — the actual path pattern registered in `reader-src/src/router/index.ts`)
