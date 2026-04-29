## 1. Type extension

- [x] 1.1 Extend the `LLMStreamChunk` (or equivalent SSE payload type) in `writer/types.ts` so that `choices[0].delta` declares optional `reasoning?: string` and `reasoning_details?: ReadonlyArray<{ type?: string; text?: string; signature?: string; format?: string }>` fields. Confirm `deno task check` reports no new errors beyond the pre-existing `writer/server.ts:70` TS7031.

## 2. Reasoning extraction helper

- [x] 2.1 In `writer/lib/chat-shared.ts`, add a private helper `extractReasoningText(delta): string` implementing the priority order from the `reasoning-think-block` spec: prefer `delta.reasoning` (string, length > 0), else concatenate `delta.reasoning_details[].text` for items where `text` is a non-empty string, skipping any other shapes silently. Return `""` when no reasoning is present.
- [x] 2.2 Add a unit test file `tests/writer/lib/extract_reasoning_text_test.ts` covering: (a) plain `delta.reasoning` string, (b) only `reasoning_details` with mixed text/signature items, (c) both fields set (string wins), (d) malformed `reasoning_details` (number, null, missing), (e) absent fields → empty string.

## 3. State machine in `executeChat()`

- [x] 3.1 Inside the streaming loop in `executeChat()`, declare a local `inThinkBlock = false` boolean directly above the existing `aiContent = ""` accumulator. Declare a local `reasoningLength = 0` counter beside it.
- [x] 3.2 In the SSE chunk handler, before processing `delta.content`, call `extractReasoningText(delta)`. When the result is non-empty: if `!inThinkBlock`, write the bytes `<think>\n` directly to the chapter file (NOT through `persistChunk`, NOT via `response-stream` hook), forward the same bytes to `onDelta?.()`, set `inThinkBlock = true`. Then write the reasoning text bytes to the file, forward to `onDelta`, and increment `reasoningLength` by the text's `string.length` (UTF-16 code units). Reasoning text MUST NOT be appended to `aiContent` and MUST NOT pass through `response-stream`.
- [x] 3.3 Before processing `delta.content` (only when `delta.content` is non-empty for this chunk): if `inThinkBlock === true`, write `\n</think>\n\n` directly to the chapter file (leading `\n` ensures `</think>` is on its own line), forward to `onDelta`, and set `inThinkBlock = false`. Then continue with the existing `persistChunk` flow for the content delta. When a single chunk carries BOTH reasoning and content, this transition runs after step 3.2 within the same chunk, so the byte order is reasoning → close → content.
- [x] 3.4 Add a helper `closeThinkBlockIfOpen()` that, when `inThinkBlock === true`, writes `\n</think>\n` directly to the open file handle and forwards the bytes to `onDelta`. Invoke this helper in the streaming `finally` block, IMMEDIATELY before the existing `file.close()` call. Wrap the helper invocation in its own nested try/finally so that (a) a thrown closer-write or `onDelta` failure does NOT mask the primary error from the streaming loop and (b) `file.close()` always runs. Log any cleanup failure at WARN level and otherwise suppress it.

## 4. Logging

- [x] 4.1 Extend the LLM-interaction-log entry types in `writer/types.ts` (or wherever the log shape is declared) with an optional `reasoningLength?: number` field on success, abort, and stream-error entry shapes.
- [x] 4.2 In `executeChat()`, populate `reasoningLength` on every emitted log entry (success, abort, stream-error) using the running `reasoningLength` counter. When zero, the field MAY be omitted but MUST NOT be `null`.

## 5. Plugin manifest review (no code changes)

- [x] 5.1 Read `plugins/thinking/plugin.json`, `plugins/thinking/frontend.js`, and `plugins/thinking/README.md`. Confirm the existing `frontend-render` hook handles `<think>` blocks (it does, per the design doc). Take NO code action; document the current behaviour in the change's `proposal.md` impact section if anything was missed.
- [x] 5.2 Decide explicitly that this change does NOT add `promptStripTags: ["think", "thinking"]` to `plugins/thinking/plugin.json`. Record the deferral in design.md Open Question Q1 (already done).

## 6. Backend tests

- [x] 6.1 Add a new test file `tests/writer/lib/chat_shared_reasoning_test.ts` (or extend an existing `chat-shared` test file) covering the scenarios:
  - 6.1.1 Reasoning-only stream (zero content chunks): chapter file contains `<think>...</think>` with reasoning text and nothing else after `<user_message>`; `executeChat()` throws `ChatError("no-content", ..., 502)`; abort/no-content log entry includes `reasoningLength` matching the streamed length.
  - 6.1.2 Content-only stream (regression): chapter file is byte-identical to today's format; no `<think>` markup; `aiContent` matches.
  - 6.1.3 Reasoning → content (canonical): file bytes after `<user_message>` are exactly `<think>\nA\n</think>\n\nX`; `ChatResult.content` equals `preContent + X` (excludes `<think>` and reasoning); `onDelta` receives `<think>\n` opener verbatim and `\n</think>\n\n` closer verbatim.
  - 6.1.4 Interleaved reasoning ↔ content: two `<think>` blocks are emitted, each enclosing one contiguous reasoning burst; bytes match `<think>\nA\n</think>\n\nX<think>\nB\n</think>\n\nY`.
  - 6.1.5 Single SSE chunk with BOTH `delta.reasoning` and `delta.content`: reasoning is written first, then `\n</think>\n\n`, then content; `onDelta` receives bytes in that exact order.
  - 6.1.6 Abort during reasoning: `finally` writes `\n</think>\n`, abort log carries `reasoningLength` and `aborted: true`, chapter file on disk is syntactically valid, `onDelta` receives the `\n</think>\n` cleanup bytes before the abort propagates.
  - 6.1.7 Mid-stream error during reasoning: `finally` writes `\n</think>\n`, error log carries `reasoningLength` and `errorCode: "stream-error"`, `ChatError` propagates with status 502, chapter file is syntactically valid.
  - 6.1.8 Cleanup-write failure does not mask primary error: simulate the closer-write throwing during `finally` while the primary error is `ChatAbortError`; assert that `ChatAbortError` (NOT the cleanup error) is what `executeChat()` throws, that `file.close()` still ran, and that a WARN log records the cleanup failure.
  - 6.1.9 Malformed `reasoning_details` (numeric, missing `text`): no error thrown, no `<think>` block emitted, AND any `delta.content` carried by the same/subsequent chunks streams normally to the chapter file.
- [x] 6.2 Add ONE test asserting that a `response-stream` hook handler registered at priority 100 is NOT invoked for any reasoning delta (verify the handler's call counter equals the number of content deltas, not content + reasoning).

## 7. Validation runs

- [x] 7.1 Run `deno task test:backend`. Expected: prior 93 tests still pass, plus the new reasoning tests added above. Investigate and fix any regression.
- [x] 7.2 Run `deno task test:frontend`. Expected: green (no frontend code changed).
- [x] 7.3 Run `openspec validate stream-reasoning-think-block --strict`. Expected: green.
- [x] 7.4 Manual smoke test against a reasoning-capable model (e.g. `deepseek/deepseek-r1` via OpenRouter): send a chat, confirm `<think>` block streams live in WebSocket, confirm the persisted chapter file contains the `<think>` block, confirm a non-reasoning model produces no `<think>` markup. *(Satisfied indirectly: live reproduction on `艾爾瑞亞/狩獵任務/chapter/1` confirmed `<think>` streams into the chapter file and folds correctly in the reader after the `frontend-render` priority fix + container rebuild — see Task 8 below.)*

## 8. Frontend `frontend-render` priority constraint

- [x] 8.1 Lower the `thinking` plugin's `frontend-render` registration priority in `plugins/thinking/frontend.js` to `30` so it runs **before** any other plugin (e.g. external `scene-info-sidebar` at priority `35`) that extracts xml-shaped blocks. Without this ordering, a plugin extracting `<scene>...</scene>` non-greedily can match a `<scene>` mention *inside* a `<think>` block and consume the closing `</think>`, leaving an unclosed `<think>` that gobbles the rest of the chapter.
- [x] 8.2 Document the constraint in `design.md` Risks so future plugin authors don't reintroduce the bug.
