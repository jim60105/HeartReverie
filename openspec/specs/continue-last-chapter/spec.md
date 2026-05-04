# continue-last-chapter Specification

## Purpose
TBD - created by archiving change continue-last-chapter. Update Purpose after archive.
## Requirements
### Requirement: Continue endpoint resumes generation in place

The server SHALL expose two equivalent ways to resume LLM generation on the latest existing chapter without creating a new chapter file: an HTTP route `POST /api/stories/:series/:name/chat/continue` (no request body fields are required) and a WebSocket message `{ type: "chat:continue", id: string, series: string, story: string }`. Both SHALL execute through a single library function `executeContinue()` in `writer/lib/chat-shared.ts` that reuses the existing prompt-building, streaming, abort, mid-stream-error, and token-usage code paths.

`executeContinue()` SHALL:

1. Validate the resolved story directory through `safePath(series, name)` and reject path-traversal with `ChatError("bad-path", …, 400)`.
2. Refuse with `ChatError("no-chapter", "Cannot continue: no existing chapter file", 400)` when the story directory contains zero `NNN.md` files.
3. **Re-read the latest chapter file from disk on every invocation** (via `Deno.readTextFile`) so any manual edits the user has made to the file since the previous round — to the `<user_message>` block, to the LLM-generated prose, or to both — are picked up verbatim. There SHALL be no in-memory caching of chapter bytes between Continue calls.
4. Parse the freshly-read chapter via a helper `parseChapterForContinue()` that returns `{ userMessageText, assistantPrefill }`, where `userMessageText` is the *content* of the **first** `<user_message>…</user_message>` block (with the wrapping tags removed; `""` when no such block exists) and `assistantPrefill` is the chapter bytes with that first user_message block removed and then run through `stripPromptTags()`.
5. Refuse with `ChatError("no-content", "Latest chapter is empty; nothing to continue", 400)` when **both** `userMessageText.trim() === ""` *and* `assistantPrefill.trim() === ""`. Either part being non-empty is sufficient to allow continue.
6. Acquire the per-story generation lock via `tryMarkGenerationActive(series, name)`; on failure throw `ChatError("concurrent", …, 409)`. Release the lock in `finally`.
7. Build the prompt by re-using the same `previous_context` machinery as `buildPromptFromStory()` for chapters 1..n−1 (same Vento template, same plugin hooks, same lore resolution, same `stripPromptTags()` policy on prior chapters). The render SHALL be invoked with `userInput: userMessageText` (so the user's possibly-edited prompt drives the trailing user turn) and `isFirstRound` derived from the filtered prior-context length (`isFirstRound = filteredContext.length === 0`) so the render path matches `executeChat()` semantics: the first-ever continue (single chapter, empty `previous_context`) takes the first-round branch, while subsequent continues do not.
8. After the rendered `messages` array is returned, conditionally append exactly one extra entry `{ role: "assistant", content: assistantPrefill }` as the **last** element of the array **only when `assistantPrefill.trim() !== ""`**. When `assistantPrefill` is empty (the `<user_message>` block exists but no prose has been generated yet, or the user manually deleted the prose tail), `executeContinue()` SHALL NOT append an empty assistant message — the request is genuinely equivalent to a `chat:send` carrying `userMessageText`, and the model produces a fresh continuation. This avoids sending an empty message that providers may reject (the project's own `assertNoEmptyMessages()` treats empty messages as malformed) or treat inconsistently.
9. Before opening the chapter file for append in `streamLlmAndPersist()`, the persistence layer SHALL verify the on-disk bytes still match `existingContent` (the bytes captured during step 3). On mismatch (an external editor modified the file between the parse and the append) the function SHALL throw `ChatError("conflict", "Latest chapter changed during continue; please retry", 409)` before opening the file for writing. This is a defence-in-depth snapshot check; the per-story generation lock and the frontend's editor-disabled-during-loading already prevent the common cases.
10. Call `streamLlmAndPersist()` with the new `WriteMode` variant `{ kind: "continue-last-chapter"; targetChapterNumber: <n>; existingContent: <unstripped chapter-n bytes read in step 3> }`.

The HTTP route SHALL be subject to the same per-passphrase rate limiter that already guards `POST /api/stories/:series/:name/chat`. The WebSocket message SHALL be authenticated identically to `chat:send` (handler runs only after the connection has authenticated).

#### Scenario: Continue refused when story has zero chapter files

- **GIVEN** a freshly created story directory with no `NNN.md` files
- **WHEN** the client sends `POST /api/stories/:series/:name/chat/continue` (or `chat:continue` over WebSocket)
- **THEN** the server SHALL respond with HTTP 400 (RFC 9457 Problem Details `detail: "Cannot continue: no existing chapter file"`) or `chat:error` (with the same detail), AND SHALL NOT open or modify any chapter file

#### Scenario: Continue refused when latest chapter has no semantic content

- **GIVEN** a story whose latest `NNN.md` file exists but contains no `<user_message>` block AND no non-whitespace prose (e.g. zero bytes, only whitespace, or only a stripped-away plugin tag)
- **WHEN** the client invokes continue via either transport
- **THEN** the server SHALL respond with HTTP 400 / `chat:error` carrying detail `"Latest chapter is empty; nothing to continue"`, AND SHALL NOT open the file for writing

#### Scenario: Continue allowed when chapter has user_message but no prose

- **GIVEN** a story whose latest chapter contains `<user_message>探索藥妝店</user_message>\n\n` followed by no prose (the LLM stopped before producing any content)
- **WHEN** the client invokes continue
- **THEN** the server SHALL accept the request, render the upstream prompt with `userInput: "探索藥妝店"`, NOT append any trailing assistant message (because `assistantPrefill.trim() === ""`), and stream a fresh continuation that is appended to the chapter file's tail

#### Scenario: Continue refused while another generation is active

- **GIVEN** a story whose generation lock is held by an in-flight `executeChat()` (or another `executeContinue()`) call
- **WHEN** the client invokes continue
- **THEN** `tryMarkGenerationActive()` SHALL return `false`, `executeContinue()` SHALL throw `ChatError("concurrent", "Another generation is already in progress for this story", 409)`, and the existing chapter bytes SHALL NOT be modified

### Requirement: Prompt construction parses chapter n into user turn + assistant prefill

The upstream chat/completions request body produced by `executeContinue()` SHALL contain a `messages` array structured as follows:

1. Entries 0..k−1 are the messages produced by `renderSystemPrompt()` invoked with `userInput: userMessageText` (where `userMessageText` is the content of the first `<user_message>…</user_message>` block extracted from chapter n's freshly-read on-disk bytes — see Requirement: Continue endpoint, step 4). The render uses the same Vento `system.md` template, the same `previous_context` array (chapters 1..n−1 stripped via `stripPromptTags()`), and the same plugin `prompt-assembly` hook dispatch as `executeChat()`. When `userMessageText === ""` the rendered trailing user turn carries empty content, exactly as it would on the first-round case where no user input has been typed.
2. Entry k (the last entry) SHALL be `{ role: "assistant", content: assistantPrefill }` **only when `assistantPrefill.trim() !== ""`**. When `assistantPrefill` is empty, no trailing assistant message is appended — the request ends with whatever `system.md` rendered (so the upstream sees a normal user-driven request equivalent to `chat:send`, not a malformed empty assistant message). When non-empty, `assistantPrefill` is chapter n's bytes with the first `<user_message>…</user_message>` block removed and then run through `stripPromptTags()`. The terminal `assistant` role SHALL signal to OpenAI-compatible providers that they should *continue* that content rather than restart, per OpenRouter's prefix-completion documentation.

Splitting chapter n at the `<user_message>` boundary — rather than treating the whole chapter as one assistant prefill — ensures that user edits to either part are honoured: edits to `<user_message>` change the user turn; edits to the prose tail change the assistant prefill. Re-reading chapter n from disk on every Continue call (Requirement: Continue endpoint, step 3) is what makes those edits visible.

The Vento system prompt template (`system.md`) SHALL NOT be modified for this requirement; the trailing assistant prefill is appended to the rendered message array *after* `renderSystemPrompt()` returns.

If the rendered prompt happens to already end with an assistant message (e.g. a future template variant), `executeContinue()` SHALL still append the chapter-n prefill as a separate trailing assistant message. The upstream provider SHALL receive two consecutive assistant messages with no intervening user message; this is documented OpenAI-compatible behaviour and most providers concatenate consecutive same-role messages internally.

The provider-dependence of trailing-assistant prefill is a known limitation: OpenRouter (the project's default `LLM_API_URL`) and Anthropic-via-OpenRouter passthrough document the behaviour and treat it reliably; strict OpenAI (`api.openai.com/v1/chat/completions`) does not officially document prefill via trailing assistant message and may insert a leading newline or behave inconsistently with some models. Operators swapping `LLM_API_URL` to a strict provider accept this limitation; this capability SHALL NOT add a `prefill: true` / `continue_final_message: true` request flag because no supported provider requires one.

#### Scenario: Trailing assistant prefill present only when non-empty

- **WHEN** `executeContinue()` builds the request body and `assistantPrefill.trim() !== ""`
- **THEN** the JSON `messages` array's last element SHALL satisfy `messages[messages.length - 1].role === "assistant"` AND `messages[messages.length - 1].content === assistantPrefill`
- **WHEN** `assistantPrefill.trim() === ""` (e.g. chapter n contains only a `<user_message>` block with no prose)
- **THEN** the request body SHALL NOT contain a trailing assistant message — the rendered `system.md` output is sent as-is — AND the last user-role message SHALL carry `userMessageText`

#### Scenario: Edited `<user_message>` is the last user-role message

- **GIVEN** chapter `005.md` was originally written by a `chat:send` carrying the user message `"探索藥妝店"`, and the user has since manually edited the file to change the `<user_message>` block to `"探索便利商店"` (the prose tail is unchanged)
- **WHEN** the client clicks Continue
- **THEN** `executeContinue()` SHALL re-read `005.md` from disk, parse the edited `<user_message>` content `"探索便利商店"`, render the upstream prompt with `userInput: "探索便利商店"`, AND the **last `role === "user"` message** in the upstream `messages` SHALL contain `"探索便利商店"` (not the original `"探索藥妝店"`). NOTE: this scenario asserts on the last user-role message rather than `messages[messages.length - 2]`, because `system.md` is free to emit additional assistant messages after the user turn (e.g. a `threshold_lord_end` cue) before the prefill is appended.

#### Scenario: User-edited prose tail is honoured in the prefill

- **GIVEN** chapter `005.md` originally contained `<user_message>探索藥妝店</user_message>\n\n他走進店裡，看見店員。` and the user has since manually edited the prose tail to `<user_message>探索藥妝店</user_message>\n\n他走進店裡，看見一個小女孩。`
- **WHEN** the client clicks Continue
- **THEN** `executeContinue()` SHALL re-read `005.md` from disk, parse the edited prose, AND the trailing assistant message in the upstream `messages` SHALL satisfy `content === stripPromptTags("他走進店裡，看見一個小女孩。")` (post-edit; not the pre-edit value)

#### Scenario: Latest chapter is re-read from disk on every Continue invocation

- **GIVEN** two consecutive Continue invocations on the same chapter, with the chapter file mutated on disk between them
- **WHEN** the second invocation runs
- **THEN** the second invocation's prompt SHALL reflect the post-mutation bytes, AND the implementation SHALL have called `Deno.readTextFile(chapterPath)` (or an equivalent live-read API) at the start of the second invocation rather than reusing bytes loaded for the first

#### Scenario: System template is unchanged

- **GIVEN** the project's `system.md` Vento template at the time of this change
- **WHEN** `executeContinue()` runs
- **THEN** the function SHALL invoke the same `renderSystemPrompt()` entry point as `executeChat()` with `userInput: userMessageText` and `isFirstRound = (filteredContext.length === 0)` (so single-chapter continues match the first-round semantics of `executeChat()`), AND SHALL NOT pass any `templateOverride` that mentions a continue-specific branch

#### Scenario: Stripping rules for prior chapters match `executeChat`

- **GIVEN** chapters 1..n−1 each contain a leading `<user_message>…</user_message>` block, plugin tags (e.g. `<state>…</state>`), and prose
- **WHEN** `executeContinue()` builds `previous_context`
- **THEN** entries for chapters 1..n−1 SHALL be the result of running `stripPromptTags()` on each chapter's raw bytes — i.e. the same stripping policy `executeChat()` uses today (only chapter n is handled differently, by the parse-and-route path described above)

### Requirement: Persistence appends in place without truncation

In `WriteMode { kind: "continue-last-chapter" }`, `streamLlmAndPersist()` SHALL open the target chapter file with `Deno.open(chapterPath, { write: true, append: true, mode: 0o664 })` — explicitly NOT `truncate: true` and NOT `create: true`. The file MUST already exist on disk; if it does not (race condition between the precheck and the open), the function SHALL surface the `Deno.errors.NotFound` as a `ChatError("no-chapter", …, 400)`.

Each streamed content delta SHALL be passed through the `response-stream` plugin hook (identically to `write-new-chapter` mode) and the resulting transformed bytes SHALL be appended to the file's tail. The `<think>…</think>` framing for streaming reasoning text SHALL be emitted to the file using the same code path as `write-new-chapter` mode — reasoning bytes are wrapped in `<think>\n…\n</think>\n\n` and written before the corresponding content delta.

The `pre-write` plugin hook SHALL NOT be dispatched for `continue-last-chapter` mode (no new user message exists; there is nothing for `pre-write` to inject). The `post-response` plugin hook SHALL be dispatched after a successful continue, with all the same fields as the chat path (`correlationId`, `content`, `storyDir`, `series`, `name`, `rootDir`, `chapterNumber`, `chapterPath`) plus `source: "continue"` (a new value alongside the existing `"chat"` and `"plugin-action"`). The `content` field of the `post-response` payload SHALL carry **the full updated chapter** (original pre-continue bytes plus all bytes appended during this stream), NOT the per-call delta. This mirrors the `append-to-existing-chapter` flow in `writer/routes/plugin-actions.ts`, which already re-reads the chapter file from disk and dispatches `post-response` with full-chapter content; plugins (e.g. `context-compaction`) that consume `post-response` rely on receiving the full chapter and would silently misbehave if continue-mode events carried only a delta.

To produce the full-chapter `content`, `streamLlmAndPersist()` SHALL re-read the chapter file from disk via `Deno.readTextFile(chapterPath)` after the stream completes (after all deltas have been written and flushed) and assign the result to the `chapterContentAfter` field of the returned `StreamLlmResult`. The existing `content` field of `StreamLlmResult` SHALL continue to be only the newly generated bytes (per its existing contract for `write-new-chapter` mode). Callers (the chat route handler, the WS handler) SHALL consume `chapterContentAfter` for the HTTP response body and SHALL NOT use `content`.

The `<user_message>…</user_message>` block written at the head of chapter n by the original `chat:send` round SHALL remain on disk verbatim. The existing leading bytes of chapter n SHALL be preserved bit-for-bit; new bytes SHALL be concatenated to the file's tail.

#### Scenario: Append preserves existing bytes

- **GIVEN** chapter `005.md` on disk containing exactly `<user_message>探索藥妝店</user_message>\n\n他走進店裡，` (length L bytes)
- **WHEN** `executeContinue()` runs and the upstream LLM streams two content deltas: `"看見店員微笑。"` then `"店員說了什麼。"`
- **THEN** after the function returns, `005.md` SHALL contain exactly the original L bytes followed by the bytes that the `response-stream` hook emitted for the two deltas (in order), with no truncation, no rewrite of the leading `<user_message>` block, and no `\n` injected between the original tail and the first new byte

#### Scenario: pre-write hook not dispatched

- **WHEN** `streamLlmAndPersist()` runs in `continue-last-chapter` mode with a `HookDispatcher` that records every dispatched hook
- **THEN** the recorded hook list SHALL NOT include any `pre-write` entry for this invocation

#### Scenario: post-response hook dispatched with source "continue"

- **GIVEN** a successful continue invocation on chapter `n` whose pre-continue bytes are `B0` and whose stream produces transformed appended bytes `B1`
- **WHEN** the function reaches its post-stream success path
- **THEN** exactly one `post-response` hook SHALL be dispatched with `source === "continue"` AND `chapterNumber === <n>` AND `chapterPath === <storyDir>/<padded-n>.md` AND `content === B0 + B1` (byte-for-byte equal to the chapter file contents read from disk after the stream completes), AND the returned `StreamLlmResult.chapterContentAfter` SHALL equal that same value

### Requirement: Streaming, abort, mid-stream-error, and token-usage pipelines reused

The continue path SHALL share the existing streaming and lifecycle infrastructure with `executeChat()`:

1. The same SSE parser handles content deltas, `data: [DONE]` sentinels, mid-stream `error` chunks, and `usage` blocks.
2. The same abort discriminator (`signal?.aborted === true`) detects client cancellation; on abort the function SHALL throw `ChatAbortError("Generation aborted by client")`. The chapter file SHALL retain whatever bytes were appended before the abort (no truncation, no rollback).
3. Mid-stream provider errors SHALL surface as `ChatError("llm-stream", <provider message>, 502)` exactly as in `executeChat()`. Bytes appended before the error chunk SHALL be preserved on disk.
4. When the upstream emits `usage`, `executeContinue()` SHALL append a `TokenUsageRecord` to the story's `_usage.json` with `chapter: <n>` and `model: <resolved model>`, identical to `executeChat()`. The HTTP response and `chat:done` envelope SHALL include the record (or `null` when the upstream omitted `usage`).
5. The HTTP route SHALL convert `ChatAbortError` to HTTP 499 (Client Closed Request, RFC 9457) and `ChatError` to its declared `httpStatus` with a Problem Details body, identical to `POST /chat`.
6. The WebSocket route SHALL emit `chat:delta` for each delta (transformed by `response-stream`), `chat:done` on success, `chat:aborted` on abort, and `chat:error` on `ChatError`. The per-id `AbortController` SHALL be registered in the same connection-scoped map used by `chat:send` and SHALL be torn down by the same on-close cleanup.

#### Scenario: Abort during continue preserves appended bytes

- **GIVEN** a continue request that has streamed three content deltas to the existing chapter tail
- **WHEN** the client sends `chat:abort` (or disconnects HTTP) before the stream completes
- **THEN** `executeContinue()` SHALL throw `ChatAbortError`, the chapter file SHALL contain the original pre-continue bytes followed by exactly the three deltas already written, the WS route SHALL send `{ type: "chat:aborted", id }`, and the HTTP route SHALL respond 499

#### Scenario: Mid-stream error during continue preserves appended bytes

- **GIVEN** a continue request that has streamed two content deltas and then receives an SSE error chunk (`error.message: "Provider connection lost"`)
- **WHEN** `executeContinue()` parses the error chunk
- **THEN** the function SHALL throw `ChatError("llm-stream", "Provider connection lost", 502)`, the chapter file SHALL contain the original pre-continue bytes followed by exactly the two deltas written before the error, the LLM interaction log SHALL include exactly one entry with `errorCode: "stream-error"`, the HTTP route SHALL respond 502 with the provider message in `detail`, and the WS route SHALL emit `{ type: "chat:error", id, detail: "Provider connection lost" }`

#### Scenario: Token usage record appended

- **GIVEN** a successful continue invocation whose upstream emits `usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }`
- **WHEN** the function returns
- **THEN** `_usage.json` for the story SHALL gain one new record with `chapter: <n>` (the same chapter number that received the appended bytes), `model: <resolved llmConfig.model>`, and the three token counts; AND the HTTP response (or `chat:done` envelope) SHALL include that record

### Requirement: LLM interaction log discriminates continue from send

`streamLlmAndPersist()` already logs each request through the LLM interaction logger (`createLlmLogger()`) with a `mode` field carrying the `WriteMode.kind`. For the continue path the value SHALL be `"continue-last-chapter"`. The existing `request` / `response` / `error` log shapes are unchanged — only the `mode` discriminator gains a new value.

#### Scenario: LLM log carries continue discriminator

- **WHEN** `executeContinue()` runs successfully
- **THEN** the LLM interaction log entries for that correlation id SHALL include `mode: "continue-last-chapter"` on both the request and response entries

