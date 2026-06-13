## 1. Shared helper

- [x] 1.1 Verify no import cycle: confirm `writer/lib/usage.ts` does not import from `writer/lib/story-chapter-io.ts` (expect no matches); if a cycle would result, place the helper in a new `writer/lib/story-chapter-delete.ts` (AGPL header) instead
- [x] 1.2 Add `DeleteLastChapterResult` type and `deleteLastChapter(dirPath)` helper (JSDoc, matching file style): list via `listChapterFiles`, remove highest-numbered `NNN.md`, best-effort `Promise.allSettled` remove `NNN-state.yaml` / `NNN-state-diff.yaml` / `current-status.yaml`, then `await pruneUsage(dirPath, lastNum - 1)`; return `{ ok: true, deleted }` or `{ ok: false, reason: "no-chapters" }`
- [x] 1.3 Import `pruneUsage` from `./usage.ts` in the helper's module
- [x] 1.4 Verify compilation: `deno check writer/server.ts` exits 0

## 2. HTTP DELETE-last route

- [x] 2.1 In `writer/routes/chapters.ts` DELETE-last route, extract `series`/`name` params (as the PUT route does) and add the `isGenerationActive(series, name)` guard returning HTTP 409 `problemJson("Conflict", 409, "Generation in progress for this story")`
- [x] 2.2 Replace the inline list/remove/sidecar-cleanup block with `await Deno.stat(dirPath)` then `const result = await deleteLastChapter(dirPath)`; return 404 on `!result.ok`, log `Chapter deleted`, and return `{ deleted: result.deleted }`
- [x] 2.3 Keep the existing catch block (NotFound → 404 "Story not found", else 500)
- [x] 2.4 Run `deno test --allow-read --allow-write --allow-env --allow-net --allow-run tests/writer/routes/chapters_test.ts`; fix expectations only for the intended 409 and usage-pruning behavior

## 3. WebSocket resend handler

- [x] 3.1 In `writer/routes/ws-chat.ts`, import `deleteLastChapter` from `../lib/story-chapter-io.ts` and `isGenerationActive` from `../lib/generation-registry.ts`; remove the now-unused `pruneUsage` import (and `join` if unused)
- [x] 3.2 Add the `isGenerationActive(series, story)` guard before deleting; on active, send `{ type: "chat:error", id, detail: "Generation in progress for this story" }` and return
- [x] 3.3 Replace the inline readDir/filter/sort/remove/cleanup/prune block with `const result = await deleteLastChapter(storyDir)`; send `chat:error` `"No chapters to delete"` when `!result.ok`, otherwise log `Chapter deleted (resend)`
- [x] 3.4 Update the catch block to log non-NotFound errors via `errorMessage(err)` with context before sending `chat:error` `"Failed to delete last chapter"`; keep the NotFound → "Story not found" branch
- [x] 3.5 Run the WebSocket route test file (`ls tests/writer/routes/ | grep -i ws`); all pass

## 4. Tests

- [x] 4.1 Add a test: DELETE-last returns 409 while `markGenerationActive(series, name)` is in effect (clear in a `finally`), modeled on the existing PUT-route 409 test
- [x] 4.2 Add a test: seed a 2-chapter story with `_usage.json` records for chapters 1 and 2, call DELETE-last, read `_usage.json`, assert only the chapter-1 record remains
- [x] 4.3 Confirm existing 404 "No chapters to delete" / 404 "Story not found" assertions still pass unchanged
- [x] 4.4 Run `deno task test:backend`; all pass including the 2 new tests

## 5. Gates

- [x] 5.1 `grep -n "readDir" writer/routes/ws-chat.ts` returns no matches (inline listing removed)
- [x] 5.2 `grep -n "pruneUsage" writer/routes/ws-chat.ts` returns no matches (moved into the helper)
- [x] 5.3 Confirm DELETE-last now has the `isGenerationActive` guard (DELETE-last, PUT, rewind each guarded)
- [x] 5.4 `deno task fmt && deno task lint` exit 0
- [x] 5.5 No files outside the in-scope list modified (`git status`)

## 6. Mandatory container integration verification (BLOCKING)

> Per the workspace's mandatory integration-verification protocol — this change alters runtime delete/guard behavior on both the HTTP and WebSocket chapter-deletion paths. Do NOT mark the change done or commit until this passes.

- [x] 6.1 Build and run the container: `cd HeartReverie/ && scripts/podman-build-run.sh`
- [x] 6.2 Confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` is clean
- [x] 6.3 Exercise the HTTP `DELETE .../chapters/last` route via `curl -H "X-Passphrase: ..." localhost:8080/...` and confirm the last chapter is deleted, `_usage.json` is pruned, and a 409 is returned while a generation is active
- [x] 6.4 Exercise the WebSocket resend (delete-last) path and confirm it deletes the last chapter, prunes usage, and rejects with `chat:error` while a generation is active
- [x] 6.5 Only after 6.1–6.4 pass, mark the change complete and commit
