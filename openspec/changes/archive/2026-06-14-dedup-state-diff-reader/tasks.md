## 1. readStateDiff helper

- [x] 1.1 Confirm the YAML import specifier used in `chapters.ts` (`grep -n "yaml" writer/routes/chapters.ts`) and reuse it
- [x] 1.2 Confirm the `Logger` interface shape (`grep -n "interface Logger\|type Logger" writer/lib/logger*.ts`) and adapt the `Pick<>` so the helper accepts any object with a `warn` method
- [x] 1.3 Add `readStateDiff(dirPath, chapterNum, logger?)` to `writer/lib/story-chapter-io.ts` (JSDoc): read `NNN-state-diff.yaml`, `parseYaml`, return payload only when `entries` is an array; on non-NotFound error log via `logger?.warn` with op + chapter context and return `undefined`
- [x] 1.4 Import `StateDiffPayload` from `../types.ts` and the `Logger` type from `./logger.ts`
- [x] 1.5 Verify compilation: `deno check writer/lib/story-chapter-io.ts` exits 0; report any import cycle

## 2. Swap the diff-read sites

- [x] 2.1 `chapters.ts` batch mode: replace the inner try/parse with `const stateDiff = await readStateDiff(dirPath, parseInt(file, 10), log);`
- [x] 2.2 `chapters.ts` single read: replace with `const stateDiff = dirPath ? await readStateDiff(dirPath, num, log) : undefined;`
- [x] 2.3 `ws-subscribe.ts` diff read: replace with `readStateDiff(storyDir, lastNum, <adapter>)` where the adapter routes non-NotFound warnings through `logWsError("diff-read", …)` (inspect the top of `ws-subscribe.ts` to choose the least-contorted adapter)
- [x] 2.4 Remove now-unused `parseYaml` imports from the touched route files

## 3. Swap the listing sites

- [x] 3.1 `ws-subscribe.ts` listing: replace the inline readDir+filter+sort with a try/catch around `listChapterFiles(storyDir)` that calls `logWsError("dir-read", err); return;` on throw
- [x] 3.2 `export.ts` listing: LEFT UNCHANGED — semantics differ from `listChapterFiles()`: export's inline listing filters `entry.isFile` *before* the `\d+\.md` regex (so a directory named `NNN.md` is excluded, whereas `listChapterFiles()` would include it) and converts `Deno.errors.NotFound` into an HTTP 404 response (whereas `listChapterFiles()` returns `[]`). Converting would silently change export output on those edge cases, so per design decision D4 it is left as-is.
- [x] 3.3 Add `readStateDiff` (and `listChapterFiles` where missing) imports to each touched route file
- [x] 3.4 Run route tests: `deno test --allow-read --allow-write --allow-env --allow-net --allow-run tests/writer/routes/chapters_test.ts` plus the ws and export route test files; all pass

## 4. Unit-test the helper

- [x] 4.1 Add `tests/writer/lib/story_chapter_io_readstatediff_test.ts` (or extend an existing story-chapter-io test) using `Deno.makeTempDir()`, covering: valid diff payload returned; missing file → `undefined` and logger NOT called; malformed YAML → `undefined` and logger called once; valid YAML without `entries` → `undefined`
- [x] 4.2 Run `deno task test:backend`; all pass including the 4 new tests

## 5. Gates

- [x] 5.1 `grep -rn "state-diff.yaml" writer/routes/` shows no `readTextFile` of a diff file outside the helper (only `readStateDiff` call sites)
- [x] 5.2 No inline `/^\d+\.md$/` chapter listings remain in `ws-subscribe.ts` (and `export.ts` if it was converted)
- [x] 5.3 `deno task fmt && deno task lint` exit 0
- [x] 5.4 No files outside the in-scope list modified (`git status`)
