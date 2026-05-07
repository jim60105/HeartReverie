## 1. Critical Path — Silent Failure Fixes

- [x] 1.1 **Fix `lib/story.ts:104` — `listChapterFiles` error classification**: Change the catch block to only return an empty array for `Deno.errors.NotFound`. For all other errors, log the error with the story path context and rethrow so callers (branching logic, chapter count) receive an honest signal rather than silently getting an empty list that could trigger duplicate story creation.

- [x] 1.2 **Fix `routes/chapters.ts:344,349` — story init error handling**: In the inner catch (stat call), check for `Deno.errors.NotFound` specifically — only create the directory in that case; rethrow permission/IO errors. In the outer catch, add `log.error(`[POST /api/stories/:series/:name/chapters] ${error}`)` before returning the 500 Problem Details response.

## 2. Route Handler 500 Logging

- [x] 2.1 **Fix `routes/chapters.ts:75,125,167,221,282`** — Add `log.error(...)` with route context before the `problemJson(c, 500, ...)` calls in all chapter error paths (list, read, edit, rewind, delete).

- [x] 2.2 **Fix `routes/stories.ts:40,65`** — Add `log.error(...)` before all 500 responses in the story listing handlers (both series listing and story-within-series listing).

- [x] 2.3 **Fix `routes/lore.ts:175,202,255,322,375`** — Add `log.error(...)` before all five 500 responses in lore endpoints (list tags, list passages, get passage, write passage, delete passage). Include the endpoint path and caught error in each log message.

- [x] 2.4 **Fix `routes/images.ts:85`** — Distinguish `Deno.errors.NotFound` (return `{ images: [] }`) from other errors (log at error level and return 500 Problem Details). This prevents corrupt JSON or I/O errors from being silently masked as "no images".

- [x] 2.5 **Fix `routes/plugins.ts:106,130,163`** — In each file-serving catch block, check for `Deno.errors.NotFound` → return 404. For all other errors, log at warn level and return 500. Current behavior incorrectly reports all errors as "Not Found".

- [x] 2.6 **Fix `routes/story-config.ts:55,64,91,112`** — Add `log.error(...)` with route context before all four 500 responses in story config endpoints (get config, get field, update config, delete field).

- [x] 2.7 **Fix `routes/prompt.ts:45`** — Add `log.error(...)` before the 500 response in the prompt read handler.

- [x] 2.8 **Fix `routes/branch.ts:83`** — Add `log.error(...)` before the 500 response in the branch creation handler.

## 3. Silent Catch Block Fixes

- [x] 3.1 **Fix `lib/chat-shared.ts:495`** — Add `log.debug(`[chat:stream] Malformed JSON chunk (${chunk.length} bytes): ${chunk.slice(0, 200)}`)` in the streaming parse catch block. Continue processing (existing behavior preserved).

- [x] 3.2 **Fix `lib/chat-shared.ts:886,990`** — In both `executeChat` and `executeContinue`, distinguish `Deno.errors.NotFound` when reading the system prompt file. NotFound → use default/empty (expected for first-time setup). Other errors → log at error level with the file path and rethrow.

- [x] 3.3 **Fix `lib/lore.ts:273,278`** — Change the lore directory read catch blocks to only swallow `Deno.errors.NotFound`. For other errors (permission denied, I/O), log at error level with the directory path and rethrow.

- [x] 3.4 **Fix `lib/lore.ts:313` (`readPassage`)** — When returning null on failure, add `log.warn(`[lore:readPassage] Failed to read ${filename}: ${error}`)` for non-NotFound errors. NotFound → return null silently (expected behavior for optional passages).

## 4. Logger Self-Protection

- [x] 4.1 **Fix `lib/logger.ts:99,103`** — Add a debounced `console.error` fallback when the log write queue encounters errors. Implement a `lastConsoleErrorTime` timestamp and only emit to stderr if more than 60 seconds have elapsed since the last emission.

- [x] 4.2 **Fix `lib/logger.ts:174,192`** — Add failure counting for log file write errors. On first failure in a window, emit `console.error` with the write error. Track `failureCount`; on recovery (successful write after failures), emit a single info-level console message noting how many writes were affected.

## 5. WebSocket Polling

- [x] 5.1 **Fix `routes/ws.ts:150,182,203,207`** — Add debug-level logging to all 4 nested catch blocks in the WebSocket polling loop. Implement per-operation rate limiting using a `Map<string, number>` keyed by operation name (e.g., `"chapter-read"`, `"generation-check"`). Only emit a log entry if more than 5 seconds have elapsed since the last log for *that specific operation*. This prevents cross-operation suppression where one noisy operation silences another.

## 6. Request Parse Failures

- [x] 6.1 **Fix `routes/chat.ts:50`** — Replace `catch(() => ({}))` with a proper try/catch that logs at warn level (`[POST /api/chat] Malformed request body`) and returns `problemJson(c, 400, "Invalid JSON in request body")`.

- [x] 6.2 **Fix `routes/plugin-actions.ts:492`** — Same pattern as 6.1: replace silent parse catch with warn-level logging and a 400 Problem Details response.

- [x] 6.3 **Fix `routes/plugin-actions.ts:306`** — Distinguish `Deno.errors.NotFound` (file genuinely missing → 404) from `Deno.errors.PermissionDenied` and other errors (→ log at warn, return 500). Current code reports all file access errors as "file not found".

- [x] 6.4 **Fix `routes/prompt.ts:52,100`** — Replace silent parse catches with warn-level logging and 400 Problem Details responses for malformed prompt request bodies.

- [x] 6.5 **Fix `routes/story-config.ts:97`** — Replace silent parse catch with warn-level logging and 400 response for malformed story config request body.

- [x] 6.6 **Fix `routes/branch.ts:89`** — Replace silent parse catch with warn-level logging and 400 response for malformed branch request body.

- [x] 6.7 **Fix `routes/lore.ts:302`** — Replace silent parse catch with warn-level logging and 400 response for malformed lore passage request body.

## 7. Additional Filesystem Catch Fixes

- [x] 7.1 **Fix `app.ts:247`** — Distinguish `Deno.errors.NotFound` when serving `index.html` for SPA fallback. Only return 404 for NotFound; log and return 500 for other errors (permission denied, I/O failure). Current code returns 404 for any read failure.

- [x] 7.2 **Fix `routes/lore.ts:315`** — In the stat call that determines whether a passage is new or existing, check for `Deno.errors.NotFound` specifically. Only treat NotFound as "new file"; log and return 500 for permission/IO errors.

- [x] 7.3 **Fix `routes/prompt.ts:125`** — In the template file read catch block, distinguish `Deno.errors.NotFound` (use default template) from other errors (log at error level and return 500). Current code swallows all read failures.

## 8. Shared Utilities

- [x] 8.1 **Create `serializeError` utility in `writer/lib/errors.ts`** — Add a shared `serializeError(error: unknown): Record<string, unknown>` function that safely extracts `name`, `message`, and `stack` from Error instances, or stringifies non-Error values. All error logging tasks (2.x, 3.x, 5.x, 6.x, 7.x) SHALL use this utility for consistent error serialization.

## 9. Minor Improvements

- [x] 9.1 **Improve `lib/generation-registry.ts:69`** — Enhance `tryMarkGenerationActive` to return richer context when the lock is already held (e.g., include a timestamp or requester identifier if available), or add a debug log when a lock attempt is rejected.

## 10. Verification

- [x] 10.1 **Type check** — Run `deno check writer/server.ts` and verify no new type errors are introduced by the changes.

- [x] 10.2 **Container build** — Run `podman build` (or equivalent) to verify the container image builds successfully with all changes.

- [x] 10.3 **Test suite** — Run `deno test` to verify existing tests pass. If the project has integration tests that exercise error paths, verify they still pass or update assertions to expect the new log output / response codes.

- [x] 10.4 **Manual smoke test** — Start the dev server and verify: (a) normal story listing works, (b) accessing a non-existent story returns 404 (not 500), (c) server logs show error entries for intentionally triggered failures.
