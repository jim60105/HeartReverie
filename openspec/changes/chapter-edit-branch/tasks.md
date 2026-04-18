## 1. Shared backend helpers

- [ ] 1.1 In `writer/lib/story.ts`, extract a reusable `listChapterFiles(dir: string): Promise<string[]>` that returns sorted `NNN.md` names, and refactor `buildPromptFromStory` plus the existing handlers in `writer/routes/chapters.ts` to use it
- [ ] 1.2 In `writer/lib/story.ts`, add `atomicWriteChapter(dirPath: string, chapterFile: string, content: string): Promise<void>` using temp file + `Deno.rename` in the same directory, with a `try/finally` that removes the temp file on failure
- [ ] 1.3 In `writer/lib/story.ts`, add `copyChapterFile(srcDir: string, dstDir: string, chapterFile: string): Promise<void>` that reads the source and writes via `atomicWriteChapter`
- [ ] 1.4 Add `writer/lib/generation-registry.ts` exporting `markGenerationActive(series, name)`, `clearGenerationActive(series, name)`, and `isGenerationActive(series, name)` backed by a module-level `Map<string, number>` keyed by `"<series>/<name>"` with a refcount value. `markGenerationActive` SHALL increment the refcount; `clearGenerationActive` SHALL decrement and delete the entry when it reaches zero; `isGenerationActive` SHALL return `true` iff the key is present with value > 0. Include a unit test that exercises the overlapping-generations case (two `mark` calls, one `clear`, assert still active).
- [ ] 1.5 Wire `writer/lib/chat-shared.ts` to call `markGenerationActive` before opening the upstream LLM stream and `clearGenerationActive` in a `finally` block covering success, error, and abort paths; add a unit test that exercises both the success and abort paths and verifies the refcount returns to zero
- [ ] 1.6 Extend `writer/types.ts` with request/response interfaces: `ChapterEditRequest`, `ChapterEditResponse`, `ChapterRewindResponse`, `BranchRequest`, `BranchResponse`

## 2. Edit chapter endpoint

- [ ] 2.1 In `writer/routes/chapters.ts`, add `PUT /api/stories/:series/:name/chapters/:number` that validates params (reject `:number` that is not a positive integer ≥ 1 with HTTP 400), rejects when `isGenerationActive()` is true (HTTP 409 Problem Details), parses the JSON body (reject malformed JSON and non-string `content` with HTTP 400), verifies the target `NNN.md` exists (HTTP 404 otherwise), and writes via `atomicWriteChapter`
- [ ] 2.2 Do NOT add a direct WebSocket broadcast — propagation to other clients is handled by the existing per-connection 1-second polling in `writer/routes/ws.ts` (started via the `subscribe` message), which will pick up the on-disk change and emit `chapters:content` for last-chapter edits on its next tick
- [ ] 2.3 Tests in `tests/writer/routes/chapters_test.ts`: happy path, non-existent chapter → 404, active generation → 409, invalid number (`abc`, `0`, `-1`) → 400, malformed JSON body → 400, non-string `content` → 400, invalid path → 400, body-limit rejection

## 3. Rewind endpoint

- [ ] 3.1 In `writer/routes/chapters.ts`, add `DELETE /api/stories/:series/:name/chapters/after/:number` that validates params (reject non-numeric or negative `:number` with HTTP 400; `0` is a valid "delete all" value), checks `isGenerationActive()` (HTTP 409), lists chapters, and removes every file with a number strictly greater than `:number` in **descending order**, collecting the deleted numbers
- [ ] 3.2 Return HTTP 200 with `{ deleted: number[] }` sorted ascending; do NOT emit a WebSocket broadcast from the handler — the existing per-connection 1-second polling in `writer/routes/ws.ts` will push `chapters:updated` to each subscriber on the next tick whenever the on-disk chapter count changes
- [ ] 3.3 Tests: normal truncation, rewind-after-0 clears all, no-op when nothing to delete (handler returns empty `deleted[]`), invalid `:number` (`abc`, `-1`) → 400, active generation → 409, missing story → 404

## 4. Branch endpoint

- [ ] 4.1 Create `writer/routes/branch.ts` exporting `registerBranchRoutes(app, deps)` and register it in `writer/app.ts` alongside other route registrations
- [ ] 4.2 Implement `POST /api/stories/:series/:name/branch` that first confirms the source story directory exists (return HTTP 404 otherwise), parses the JSON body (reject malformed JSON, missing `fromChapter`, non-numeric `fromChapter`, or non-string `newName` with HTTP 400), validates `fromChapter` (positive integer ≥ 1 and ≤ highest existing chapter; `0`/negative/non-integer → HTTP 400) and `newName` (via `isValidParam()`; generate `<name>-branch-<Date.now()>` when absent; reject leading `_`/`.`, path separators, empty strings)
- [ ] 4.3 Create the destination via `Deno.mkdir(dest, { recursive: false })`; on `AlreadyExists` return HTTP 409
- [ ] 4.4 Copy chapters `001.md`..`NNN.md` via `copyChapterFile`; if the source story contains `_lore/`, recursively copy it to the destination using a helper that preserves file mode `0o664`/dir mode `0o775`
- [ ] 4.5 Wrap steps 4.3–4.4 in a `try/catch` that performs best-effort `Deno.remove(dest, { recursive: true })` on failure and returns HTTP 500 with a Problem Details body
- [ ] 4.6 Return HTTP 201 with `{ series, name, copiedChapters }`
- [ ] 4.7 Tests in `tests/writer/routes/branch_test.ts`: explicit name, auto-generated name, story-scoped lore copied while series lore is untouched, destination exists → 409, invalid newName → 400, `fromChapter` out of range → 400, non-positive `fromChapter` (`0`, `-1`) → 400, malformed JSON body → 400, missing source story → 404, mid-copy I/O failure triggers cleanup

## 5. Frontend composable and UI

- [ ] 5.1 Create `reader-src/src/composables/useChapterActions.ts` with `editChapter(number, content)`, `rewindAfter(number)`, `branchFrom(number, newName?)`, each using `useAuth().getAuthHeaders()` and returning a typed result or throwing a typed error
- [ ] 5.2 Add request/response types to `reader-src/src/types/index.ts`
- [ ] 5.3 Extend `reader-src/src/composables/useChapterNav.ts` with a `reloadKeepingIndex()` helper (or reuse `loadFromBackendInternal` + manual index preservation) so post-rewind reloads land on the intended chapter
- [ ] 5.4 In `reader-src/src/components/ChapterContent.vue`, render an action toolbar per chapter (edit / rewind / branch) visible only when `useChapterNav().mode.value === "backend"`
- [ ] 5.5 Implement the inline edit flow: clicking "Edit" swaps the rendered chapter for a `<textarea>` pre-filled with current content; "Save" calls `editChapter()` and, on success, updates the chapter in place
- [ ] 5.6 Implement the rewind flow with a confirmation dialog, calling `rewindAfter()` and reloading chapters + navigating to the new last chapter on success
- [ ] 5.7 Implement the branch flow with a small dialog prompting for an optional `newName`, calling `branchFrom()`, and on HTTP 201 navigating via Vue Router to the named `chapter` route (path pattern `/:series/:story/chapter/:chapter` as registered in `reader-src/src/router/index.ts`), resolving to `/:series/<newName>/chapter/<fromChapter>`
- [ ] 5.8 Frontend tests (Vitest): `useChapterActions` happy paths, error propagation, and `ChapterContent.vue` rendering the toolbar only in backend mode

## 6. Docs and verification

- [ ] 6.1 Update `AGENTS.md` "Project Structure" to mention `writer/routes/branch.ts`, `writer/lib/generation-registry.ts`, and `reader-src/src/composables/useChapterActions.ts`
- [ ] 6.2 Run `deno task test:backend` and confirm all new and existing backend tests pass
- [ ] 6.3 Run `deno task test:frontend` and confirm all frontend tests pass
- [ ] 6.4 Run `deno task build:reader` and confirm the reader builds without errors
- [ ] 6.5 Manual smoke test: create a story, generate 3 chapters, edit chapter 2, rewind after chapter 1, branch from chapter 1 with and without `newName`, and confirm a second browser tab receives the WebSocket updates
