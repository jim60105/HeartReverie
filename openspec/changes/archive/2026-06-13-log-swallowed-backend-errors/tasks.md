## 1. WebSocket plugin-action logging

- [x] 1.1 In `writer/routes/ws-plugin-action.ts`, add imports: `createLogger` from `../lib/logger.ts`, and `errorMessage` + `problemJson` from `../lib/errors.ts`
- [x] 1.2 Add `const log = createLogger("ws");` at module level (after imports, matching `ws-chat.ts:26`)
- [x] 1.3 In the catch block, call `log.error("Plugin action failed (unexpected)", { event: "plugin-action:error", correlationId, pluginName, error: errorMessage(err), stack: err instanceof Error ? err.stack : undefined })` before sending the envelope
- [x] 1.4 Replace the hand-built RFC 9457 literal with `problemJson("Internal Server Error", 500, detail)` in the `plugin-action:error` envelope
- [x] 1.5 Run the ws-plugin-action test file (`ls tests/writer/routes/ | grep -i plugin`); all pass

## 2. Narrow state-diff catches in chapters.ts

- [x] 2.1 Skip this group if the `dedup-state-diff-reader` change already extracted the reads into a helper; in that case verify the helper logs non-NotFound errors and proceed to group 3 (N/A — dedup change has not landed; reads are still inline in `chapters.ts`)
- [x] 2.2 Verify `createLogger` (scope "file") and `errorMessage` are already imported in `chapters.ts` (`grep -n "createLogger\|errorMessage" writer/routes/chapters.ts`)
- [x] 2.3 Change the batch-mode (`:59-67`) bare `catch {` to `catch (err: unknown)` that logs at warn level with the chapter number (`parseInt(file, 10)`) when `err` is not `Deno.errors.NotFound`
- [x] 2.4 Change the single-read (`:104-121`) bare `catch {` identically, using `num` as the chapter number
- [x] 2.5 Run `deno test --allow-read --allow-write --allow-env --allow-net --allow-run tests/writer/routes/chapters_test.ts`; all pass (responses unchanged)

## 3. Optional test

- [x] 3.1 If the ws-plugin-action harness can force `runPluginActionWithDeps` to throw, add a test asserting the `plugin-action:error` envelope is still sent with the same problem fields; otherwise skip (wire shape pinned by existing tests, change is log-only) — skipped: `tests/writer/routes/ws_coverage_test.ts:706` already drives the outer catch via a throwing `pluginManager.hasPlugin` Proxy and asserts the `plugin-action:error` envelope's `status: 500` + string `detail`

## 4. Gates

- [x] 4.1 `grep -n "about:blank" writer/routes/ws-plugin-action.ts` returns no matches (literal replaced by `problemJson`)
- [x] 4.2 `grep -c "log.error\|log.warn" writer/routes/ws-plugin-action.ts` is at least 1
- [x] 4.3 The two state-diff reads in `chapters.ts` no longer use a bare `catch {` (other intentional bare catches elsewhere unchanged)
- [x] 4.4 `deno task test:backend` exits 0 (421 passed, 0 failed)
- [x] 4.5 `deno task fmt && deno task lint` exit 0 for in-scope files (`deno fmt --check`/`deno lint` on `ws-plugin-action.ts` + `chapters.ts` both exit 0). NOTE: repo-wide `deno task lint` reports a pre-existing `no-unused-vars` (`wsRequest`) in an unrelated in-progress WIP file `reader-src/src/composables/useChatApi.ts` (110 lines ahead of HEAD before this change) — that failure pre-dates and is out of scope for this change
- [x] 4.6 In-scope code files (`ws-plugin-action.ts`, `chapters.ts`) plus this change's artifacts modified. `reader-src/src/composables/useChatApi.ts` shows in `git status` only because it was already a dirty WIP in the working tree before this session; the repo-wide `deno fmt` normalized its whitespace (logic untouched)
