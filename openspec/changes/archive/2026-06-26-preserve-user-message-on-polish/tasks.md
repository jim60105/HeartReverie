## 1. Type & capture helper

- [x] 1.1 In `writer/lib/chat-types.ts`, extend the `replace-last-chapter` `WriteMode` variant with a REQUIRED `readonly preservedPrefix: string` field, with a JSDoc note that it holds the verbatim leading `<user_message>` block (incl. its ≤2-line-break separator) to re-prepend on write; `""` means nothing to preserve.
- [x] 1.2 Create `writer/lib/user-message-prefix.ts` exporting a pure helper `extractLeadingUserMessage(raw: string): string` that returns the leading `<user_message>…</user_message>` block plus its bounded trailing separator using an anchored, case-sensitive, non-greedy regex `^<user_message\b[^>]*>[\s\S]*?<\/user_message>(?:\r?\n){0,2}` (NO leading `^\s*`; trailing capture bounded to ≤2 line breaks so prose whitespace is not absorbed), or `""` when there is no matching block at byte 0. Include the AGPL header. Add a `// deno-lint-ignore` only if required, with a `-- <reason>` trailer.

## 2. Wire capture into replace mode

- [x] 2.1 In `writer/routes/plugin-actions-execute.ts` `runUnderLock`, inside the `validatedMode === "replace-last-chapter"` branch, after reading `rawDraft` and BEFORE/independent of the strip pass, compute `preservedPrefix = extractLeadingUserMessage(rawDraft)`. The capture MUST run on `rawDraft` directly and MUST NOT depend on `getStripTagPatterns()` being non-null. Keep `draft` bound to the existing stripped `cleanDraft` (the LLM still must not see `<user_message>`).
- [x] 2.2 Set `writeMode = { kind: "replace-last-chapter", pluginName, preservedPrefix }` (always a string; `""` when no block captured).

## 3. Re-prepend on finalisation

- [x] 3.1 In `writer/lib/chat-chapter-finalize.ts` `finalizeReplaceLastChapter`, read `preservedPrefix` from the `replace-last-chapter` write mode (defaulting to `""`) and compute `newContent = preservedPrefix + aiContent.trimEnd() + "\n"` before `atomicWriteChapter`. Verify the `FinalizeArgs`/dispatch typing flows the new field through (the finaliser already receives the discriminated write mode).
- [x] 3.2 Confirm the re-read `chapterContentAfter` (used for the `post-response` payload and the returned `content`) reflects the re-prepended block — it is read from disk after the write, so no extra change should be needed; assert this in tests.

## 4. Tests

- [x] 4.1 In `tests/writer/routes/plugin_actions_replace_test.ts`, add a case: a chapter beginning with `<user_message>\n玩家輸入\n</user_message>\n\n{prose}` polished via `replace: true` results in an on-disk chapter whose bytes are `"<user_message>\n玩家輸入\n</user_message>\n\n" + <trimmed mocked LLM output> + "\n"`, and that the captured block survives byte-for-byte.
- [x] 4.2 Add a case asserting the mocked LLM request `draft`/messages did NOT contain `<user_message>` (the block stays stripped from prompt input).
- [x] 4.3 Add a case: a chapter with NO leading `<user_message>` block produces output byte-for-byte equal to the pre-change behaviour (trimmed LLM output + `"\n"`).
- [x] 4.4 Add a case: a `<user_message>` block that appears only mid-body is NOT preserved (preserved prefix empty; block stripped from `draft`; absent from output).
- [x] 4.5 Add a case asserting `post-response.content` and the returned `content` include the re-prepended `<user_message>` block.
- [x] 4.5b Add a case for the de-duplication guard: when a preserved prefix exists AND the model output itself begins with a leading `<user_message>` block, the written chapter contains exactly ONE leading block (the preserved original); the model's emitted block is dropped.
- [x] 4.5a Add a case proving preservation is mode-level, not polish-specific: dispatch a `replace: true` run via a NON-polish plugin fixture (e.g. a test plugin with its own `.md` prompt) against a chapter with a leading `<user_message>` block, and assert the block survives byte-for-byte (same outcome as the polish case).
- [x] 4.6 Add a case: a chapter where another (fixture) leading block precedes `<user_message>` (e.g. `<meta>…</meta>\n<user_message>…</user_message>\n\n{prose}`) — assert the `<user_message>` block is NOT preserved (pins the documented limitation).
- [x] 4.7 Add a case: empty/whitespace-only mocked LLM output with a leading `<user_message>` block → on-disk bytes equal `preservedPrefix + "\n"` (message preserved despite empty model output).
- [x] 4.8 Add a case: a deployment/fixture with NO `promptStripTags` (`getStripTagPatterns()` null) and a leading `<user_message>` block → block still captured and re-prepended; output begins with the block.
- [x] 4.9 Add/confirm an abort-or-error case: when the run aborts/errors, the original chapter (incl. its leading `<user_message>`) remains byte-for-byte unchanged and no write occurs (extend existing replace abort coverage if present).
- [x] 4.10 Create `tests/writer/lib/user-message-prefix_test.ts` unit-testing `extractLeadingUserMessage` covering: leading block captured incl. ≤2-break separator; no block (`""`); unterminated/malformed block (`""`); mid-body-only block (`""`); block NOT at byte 0 i.e. preceded by content (`""`); over-long trailing whitespace (`\n\n\n   `) → separator bounded to 2 breaks; uppercase `<USER_MESSAGE>` (`""`, case-sensitive); CRLF separator (`\r\n\r\n`) captured.

## 5. Verify & finalise

- [x] 5.1 Run `deno task fmt` and `deno task lint` — both clean.
- [x] 5.2 Run the backend tests: `deno task test:backend` (or at minimum `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/routes/plugin_actions_replace_test.ts tests/writer/lib/chat_chapter_finalize_test.ts`).
- [x] 5.3 Mandatory integration verification: `scripts/podman-build-run.sh`, confirm clean startup (`podman logs heartreverie 2>&1 | grep -i "error\|warn"`), then in the reader UI click **✨ 潤飾** on a chapter that has a `<user_message>` block and confirm the `<user_message>` block is still present in the chapter file after the polish completes (and that polished prose replaced the body).
