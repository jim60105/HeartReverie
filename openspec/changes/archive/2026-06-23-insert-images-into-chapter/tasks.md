## 1. Paragraph segmentation helper

- [x] 1.1 Create `writer/lib/chapter-paragraphs.ts` exporting `splitChapterParagraphs(rawContent, stripRegex)` that returns `{ index, text, start, end }[]` per the `numbered-paragraph-variable` spec. CRITICAL: build a **length-preserving masked view** (replace each `getStripTagPatterns()` match with equal-length whitespace, newlines preserved) so the returned `start`/`end` offsets index the RAW string 1:1; segment on the mask (blank-line runs, CRLF-safe), drop empties, number 1-based; stable.
- [x] 1.2 Add a `renderNumberedParagraphs(paragraphs)` helper that produces the `numbered_paragraphs` string (sequence number + text, blank-line separated).
- [x] 1.3 Unit tests in `tests/writer/lib/chapter-paragraphs_test.ts`: blank-line numbering, stripped-tag exclusion, **mask length-preservation (masked view byte length == raw length)**, stripped tag BETWEEN two paragraphs does not merge/split them, stripped tag BEFORE paragraph 1 (K=0 lands after it), leading/trailing blank lines, CRLF, empty chapter (count 0), raw-offset correctness (slicing `[start,end)` yields the source span), and `insertAfterParagraph: N` resolving to paragraph N's `end` offset.

## 2. Write-mode plumbing (types + validation)

- [x] 2.1 Add `"insert-into-chapter"` to the `WriteMode` discriminated union in `writer/lib/chat-shared.ts` and the `insert` field + `chapterInserted`/`insertedCount` to the run-prompt response type in `writer/types.ts` (HTTP body + `plugin-action:done` WS envelope types).
- [x] 2.2 Add the new problem-detail factories to `writer/lib/errors.ts`: `plugin-action:invalid-insert-combo` (400), `plugin-action:invalid-insert-payload` (422), `plugin-action:insert-paragraph-out-of-range` (422); reuse existing `no-chapter` (400) and `concurrent-generation` (409).
- [x] 2.3 Extend `validateModeCombo` in `writer/routes/plugin-actions-validation.ts` with the `insert` arm: insert is mutually exclusive with append/replace and rejects any non-`undefined` `appendTag` → `plugin-action:invalid-insert-combo`; return mode `"insert-into-chapter"`.
- [x] 2.4 Add `numbered_paragraphs` to `RESERVED_VARIABLE_NAMES` in `writer/routes/plugin-actions-shared.ts` so `extraVariables.numbered_paragraphs` is rejected with `plugin-action:extra-variables-collision`.

## 3. Preflight + execute (insert flow)

- [x] 3.1 In preflight, when mode is insert, assert the highest-numbered chapter exists (else `plugin-action:no-chapter`) and carry the insert mode + (lazily) the chapter path into `PreflightContext`.
- [x] 3.2 In `runUnderLock` (`writer/routes/plugin-actions-execute.ts`), for insert mode: read the highest-numbered chapter snapshot INSIDE the lock, call `splitChapterParagraphs`, inject `numbered_paragraphs` (rendered) into `renderVariables` (empty string for non-insert modes), build messages, and pass `writeMode = { kind: "insert-into-chapter", pluginName }` to `streamLlmAndPersist`.
- [x] 3.3 Shape the insert success response: `chapterInserted: true`, `insertedCount: n`, `chapterUpdated: true`, `chapterReplaced: false`, `appendedTag: null`, `content: <full chapter after insert>`; and the empty-array no-op response (`chapterInserted: false`, `insertedCount: 0`, `chapterUpdated: false`). Ensure non-insert modes default `chapterInserted: false`, `insertedCount: 0`.

## 4. streamLlmAndPersist insert branch

- [x] 4.1 In `writer/lib/chat-shared.ts`, add the `insert-into-chapter` branch: accumulate the full stream, normalise (trim + strip one outer ```` ``` ```` fence), `JSON.parse`, validate the `{ insertions: [{ insertAfterParagraph:int>=0, text:non-empty-string }] }` envelope → `plugin-action:invalid-insert-payload` on any violation.
- [x] 4.2 Resolve each `insertAfterParagraph` against the paragraph list (read inside the lock): `0` → before paragraph 1; `1..count` → after that paragraph; out of range → `plugin-action:insert-paragraph-out-of-range` (abort whole run, no write).
- [x] 4.3 Apply insertions to the raw chapter string: splice each `text` BYTE-FOR-BYTE (no trim/no internal newline normalisation), adding only outer blank-line separators (collapse joins, no >2 consecutive newlines). `K=0` → raw start of visible paragraph 1 (offset 0 only for zero-paragraph chapters). Apply descending by resolved offset; GROUP same-offset insertions and concatenate their texts in array order (not reversed) before a single splice. Write via `atomicWriteChapter`.
- [x] 4.4 On success (non-empty): re-read chapter, dispatch `post-response` with full post-insert content + `source: "plugin-action"` + `pluginName`; do NOT dispatch `pre-write`/`response-stream`. On empty array: write nothing, no `post-response`. On abort/error before rename: no write, no `post-response`.
- [x] 4.5 Confirm the per-story generation lock wraps the read→stream→splice→post-response sequence and is released in `finally` (reuse existing append/replace lock handling); concurrent lock → `plugin-action:concurrent-generation` (409).

## 4A. insert-transform hook (envelope production)

- [x] 4A.1 Add the `insert-transform` stage to the `HookStage` union (`writer/types/hooks.ts`) and to `VALID_STAGES` + `KNOWN_BACKEND_STAGES` in `writer/lib/hooks-stages.ts`; do NOT add it to `PARALLEL_ALLOWED` (serial, mutating). Add an `InsertTransformPayload` interface in `writer/types/hooks.ts` with `readonly` reference fields + a MUTABLE `envelope: string | null` output field.
- [x] 4A.2 In `finalizeInsertIntoChapter` (`writer/lib/chat-chapter-finalize.ts`), BEFORE `parseInsertEnvelope`, dispatch `insert-transform` with `{ correlationId, pluginName, rawResponse: aiContent, numberedParagraphs, series, name, storyDir, envelope: null }` (NOT deep-frozen). Read back `ctx.envelope`: if a non-empty string, parse THAT; else parse `aiContent`. Thread `numberedParagraphs` into the insert WriteMode so the finalizer can pass it to the hook.
- [x] 4A.3 Ensure a handler that throws aborts the run before any write (no chapter mutation, no `post-response`); confirm the dispatch is inside the lock-held finalize path.
- [x] 4A.4 Update `plugin-validators-hooks.ts` / loader if needed so a plugin may register `insert-transform` with `parallel:false`. Verify introspection/`_debug-hooks` recognise the new stage.

## 5. WebSocket + HTTP envelope

- [x] 5.1 Update `writer/routes/ws-plugin-action.ts` to forward `insert` from the client envelope and to include `chapterInserted`/`insertedCount` in `plugin-action:done`.
- [x] 5.2 Update the HTTP run-prompt handler to accept `insert` and return `chapterInserted`/`insertedCount` in the JSON body.

## 6. Frontend helper

- [x] 6.1 Extend the `runPluginPrompt` options type + helper (`reader-src/src/composables/useChatApi.ts` and/or `lib/api.ts`) with `insert?: boolean`; forward `insert: true` on WS envelope and HTTP body ONLY when set; keep mutual exclusion typing with `append`/`replace`.
- [x] 6.2 Surface `chapterInserted`/`insertedCount` in the resolved result and route `plugin-action:invalid-insert-combo` / `invalid-insert-payload` / `insert-paragraph-out-of-range` to `errorMessage` + rejected promise (no local chapter mutation).
- [x] 6.3 In `usePluginActions`, ensure a `chapterInserted: true` result triggers the existing chapter reload pathway EXACTLY ONCE (no double reload).
- [x] 6.4 Audit all consumers of the run-prompt result for assumptions that `chapterUpdated: true` implies append/replace specifically (e.g. editor-buffer reset, success messaging); ensure insert is treated as a valid third write outcome via `chapterInserted` without breaking those paths.

## 7. Tests

- [x] 7.1 Backend route tests (`tests/writer/routes/`): insert combo rejections (insert+append, insert+replace, insert+appendTag), no-chapter, concurrent-generation, invalid-insert-payload (non-JSON, fenced-JSON accepted, malformed entry, empty text), out-of-range (whole-run abort + byte-identical chapter), successful mid-chapter splice, top-of-chapter `0`, multi-insertion non-corruption, empty-array no-op, `numbered_paragraphs` reserved-collision, post-response dispatch with full chapter, abort preserves chapter.
- [x] 7.2 `streamLlmAndPersist` insert-branch unit tests (envelope parsing + offset application) where practical.
- [x] 7.4 `insert-transform` hook tests: a registered handler that sets `ctx.envelope` causes the engine to parse the handler's envelope (not the raw response); no-handler falls back to raw response; a throwing handler aborts with the chapter byte-for-byte unchanged and no `post-response`.
- [x] 7.3 Frontend tests (`reader-src` Vitest): `runPluginPrompt` forwards `insert`, omits append/replace/appendTag, exposes `chapterInserted`, surfaces insert error slugs.

## 8. Docs + style gates

- [x] 8.1 Document the insert mode in `docs/plugin-system.md` (action-button section): `insert: true`, `numbered_paragraphs`, JSON envelope shape, `insertAfterParagraph` semantics, result fields, error slugs.
- [x] 8.3 Document the `insert-transform` hook (context fields, mutable `envelope` slot, origin self-filter, serial/non-frozen, fallback to raw response) in the action-button / hooks docs.
- [x] 8.2 Run `deno task fmt` and `deno task lint`; fix and commit any resulting changes.

## 9. Mandatory container integration verification

- [x] 9.1 Build + run via `scripts/podman-build-run.sh`; confirm `podman logs heartreverie` is free of error/warn at startup.
- [x] 9.2 With a test story that has a multi-paragraph last chapter, drive an insert via a temporary `.md` prompt (or the consuming plugin) and `curl -H "X-Passphrase: ..."` the run-prompt route with `insert: true`; verify the chapter file gains the spliced block at the addressed paragraph and `post-response` fires.
- [x] 9.3 Verify the out-of-range and invalid-payload paths leave the chapter byte-for-byte unchanged in the container.
