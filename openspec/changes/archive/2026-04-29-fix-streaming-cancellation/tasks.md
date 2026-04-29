## 1. Type and route plumbing for the new ChatError code

- [x] 1.1 In `writer/lib/chat-shared.ts`, extend the `ChatError.code` discriminated-union literal type to include `"llm-stream"`. Audit any existing `switch (err.code)` / map-lookup sites for completeness; TypeScript's `noUnusedLocals` / strict checks will surface any non-exhaustive handling.
- [x] 1.2 In `writer/routes/chat.ts`, add a corresponding entry to the `ERROR_TITLES` map (e.g. `"llm-stream": "Bad Gateway"`) so the RFC 9457 Problem Details `title` is meaningful for mid-stream errors.

## 2. Backend implementation: `writer/lib/chat-shared.ts`

- [x] 2.1 Replace the abort detection in the upstream-`fetch()` `catch` block (currently around line 244, `if (err instanceof DOMException && err.name === "AbortError")`) with `if (signal?.aborted)`. Keep the existing log line and `throw new ChatAbortError("Generation aborted by client")`. (The `try` here only awaits `fetch`, so guarding the whole catch with `signal.aborted` is safe.)
- [x] 2.2 **Narrow** the streaming-loop abort detection. Restructure the `while (true)` loop so a small inner `try` wraps **only** `await reader.read()`. Its `catch` SHALL be: `if (signal?.aborted === true) { aborted = true; break; } throw err;`. Pull all subsequent work (the `decoder.decode` + line-splitting + per-line parse + `persistChunk` / `onDelta`) out of that inner `try` so file-write, hook, and JSON-parse errors propagate as themselves and are NOT misclassified as aborts.
- [x] 2.3 Restructure the SSE `data:` payload parser so the existing `try { JSON.parse(payload) } catch { /* skip malformed */ }` swallows ONLY parse failures. Detection logic and the resulting throw run OUTSIDE the parse-catch:
  ```ts
  let raw: unknown;
  try { raw = JSON.parse(payload); } catch { continue; }
  if (typeof raw !== "object" || raw === null) continue;
  const parsed = raw as LLMStreamChunk & { error?: { message?: string; code?: number | string } };
  // mid-stream error detection here, OUTSIDE the parse-catch
  ```
  Apply the same restructure to the post-loop tail-buffer flush.
- [x] 2.4 Implement mid-stream error detection: after parsing succeeds and the value is a non-null object, check `const hasErr = parsed.error !== null && typeof parsed.error === "object"` AND `const finishedErr = parsed.choices?.[0]?.finish_reason === "error"`. If `hasErr || finishedErr`, extract `parsed.error?.message ?? (parsed.error?.code !== undefined ? String(parsed.error.code) : "Mid-stream provider error")`, log ONE LLM-interaction-log entry `llmLog.info("LLM error", { type: "error", errorCode: "stream-error", latencyMs, error: extractedMessage, partialLength: aiContent.length })`, then `throw new ChatError("llm-stream", extractedMessage, 502)`. The existing `finally { file.close(); }` preserves partial content.
- [x] 2.5 Update the OUTER streaming `try`/`catch` (the one whose old shape set `aborted = true` on `DOMException`) so it: (a) recognizes `ChatError` instances and rethrows them WITHOUT logging a second `errorCode: "stream"` entry, (b) does NOT use `signal?.aborted` as a fallback abort signal here — abort detection happens exclusively inside the narrow `reader.read()` catch (task 2.3), so any error reaching this outer catch is by definition non-abort and MUST propagate as itself even when the signal is concurrently aborted, (c) logs + rethrows other unexpected stream errors as `errorCode: "stream"`. The mid-stream error must produce exactly ONE log entry, never two.
- [x] 2.6 Verify by reading the resulting file that the abort cleanup branch (`if (aborted) { ... }` at lines 433-446) runs whenever `signal.aborted === true`, regardless of error class. The branch SHALL gracefully handle the case where the chapter file was never opened (i.e. abort during initial fetch) — in that case the log lines that reference the file path or partial content should still emit, but no `file.close()` is needed.

## 3. Backend implementation: `writer/routes/ws.ts`

- [x] 3.1 Change `controller.abort(new ChatAbortError("Connection closed"))` (around line 106, inside `cleanup()`) to `controller.abort()` (no argument).
- [x] 3.2 Change `controller.abort(new ChatAbortError("Generation aborted by client"))` (around line 352, inside `handleChatAbort`) to `controller.abort()` (no argument).
- [x] 3.3 Confirm via re-reading that no other call site in `writer/routes/ws.ts` passes a custom abort reason.

## 4. Type-check and existing-test sweep

- [x] 4.1 Run `deno check writer/server.ts` and confirm no NEW type errors are introduced (the pre-existing TS7031 in `writer/server.ts:70` SHALL remain unchanged — do not touch unrelated code).
- [x] 4.2 Run `deno task test:backend` and confirm all 92 existing backend tests still pass with the changes from sections 1-3 in place (regression sweep before adding new tests).

## 5. New backend tests for `executeChat()` (`tests/writer/lib/chat_shared_cancellation_test.ts`)

- [x] 5.1 Create a new test file that imports `executeChat`, `ChatAbortError`, and `ChatError` from the writer library, plus the `captureUpstreamFetch`-style helper pattern used in `chat_shared_reasoning_test.ts` and `chat_shared_app_attribution_test.ts`. Set up `LLM_API_KEY` with the same save/restore pattern (try/finally with `previousKey`).
- [x] 5.2 Sub-test "abort while initial fetch is pending throws ChatAbortError (no chapter file created)": stub `globalThis.fetch` to return a promise that resolves only when the signal aborts:
  ```ts
  globalThis.fetch = (_url, init) => new Promise((_, reject) => {
    const sig = init?.signal as AbortSignal;
    sig.addEventListener("abort", () => reject(sig.reason ?? new DOMException("aborted", "AbortError")), { once: true });
  });
  ```
  Start `executeChat({ ..., signal: ctrl.signal })` without awaiting, give the event loop one microtask to enter `fetch`, then `ctrl.abort()`. Assert: (a) `executeChat()` rejects with `ChatAbortError`, (b) the target chapter path on disk does NOT exist after the rejection.
- [x] 5.3 Sub-test "pre-aborted controller throws ChatAbortError": call `ctrl.abort()` immediately (before `executeChat`), pass `ctrl.signal`. Assert it rejects with `ChatAbortError`. (Different code path from 5.2 — exercises `signal.aborted` being true on entry.)
- [x] 5.4 Sub-test "aborts after partial streaming preserve partial chapter": stub `globalThis.fetch` to return a `ReadableStream` that yields one `data: {"choices":[{"delta":{"content":"hello "}}]}` chunk, then a microtask-deferred second chunk. Schedule `controller.abort()` after the first chunk has been received. Assert: (a) `executeChat()` rejects with `ChatAbortError`, (b) the chapter file contains the user-message block plus exactly `hello ` (NOT `hello world`), (c) the LLM interaction log has at least one entry with `aborted: true`.
- [x] 5.5 Sub-test "abort with custom Error reason still produces ChatAbortError": this REGRESSION GUARD is essential — even though `writer/routes/ws.ts` no longer passes a custom reason, the chat library MUST remain reason-agnostic. Construct the same partial-streaming setup as 5.4 but call `ctrl.abort(new Error("legacy custom reason"))`. Assert `executeChat()` rejects with a freshly constructed `ChatAbortError` (NOT the rethrown `Error`, NOT a `ChatError`).
- [x] 5.6 Sub-test "mid-stream error chunk surfaces as ChatError(llm-stream)": stub `globalThis.fetch` to return a `ReadableStream` yielding (a) one normal `data:` chunk with content `"partial "`, (b) one error chunk `data: {"id":"x","object":"chat.completion.chunk","created":1,"error":{"message":"Provider connection lost","code":502},"choices":[{"finish_reason":"error","delta":{}}]}`, (c) `data: [DONE]`. Assert: (a) `executeChat()` rejects with a `ChatError` whose `.code === "llm-stream"`, `.message === "Provider connection lost"`, `.httpStatus === 502`; (b) the chapter file contains the user-message block plus `"partial "`; (c) the LLM interaction log includes EXACTLY ONE entry with `errorCode: "stream-error"` (no duplicate `"stream"` entry).
- [x] 5.7 Sub-test "mid-stream error without explicit message field falls back to a non-empty message": construct an SSE error chunk where `parsed.error` is `{"code": 502}` (no `message`). Assert the thrown `ChatError`'s `.message` is a non-empty string.
- [x] 5.8 Sub-test "mid-stream error indicated only by finish_reason": construct an SSE chunk where `parsed.choices[0].finish_reason === "error"` but `parsed.error` is missing. Assert `executeChat()` rejects with `ChatError("llm-stream", ...)`.
- [x] 5.9 Sub-test "filesystem write error during streaming is NOT misclassified as abort" — defensive: stub `globalThis.fetch` to return a normal `ReadableStream` chunk, but make the chapter file path point to a directory that does not exist (or otherwise force `file.write` to reject). With a non-aborted signal, assert that `executeChat()` rejects with the underlying filesystem error (NOT `ChatAbortError`). This verifies the narrowed-catch design.
- [x] 5.10 Run `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/lib/chat_shared_cancellation_test.ts` and confirm all sub-tests pass.

## 6. Extended end-to-end WebSocket abort test (`tests/writer/routes/ws_test.ts`)

- [x] 6.1 Add one new sub-test next to the existing `chat:abort: unknown id is silently ignored` test: "chat:abort during initial fetch resolves as chat:aborted (not chat:error)". Stub the upstream `fetch` to await indefinitely on its initial response (rejecting only when its signal aborts). From the WS client send `chat:send` with a known `id`, then immediately send `chat:abort` with the same `id`. Assert the next received message is `{ type: "chat:aborted", id }`, NOT `chat:error`.
- [x] 6.2 Optional follow-up sub-test: "connection close while generation in flight tears down upstream fetch". Trigger a `chat:send`, wait for one `chat:delta`, close the WS from the client side, then assert (via the test stub's bookkeeping) that the upstream `fetch`'s `signal.aborted` becomes `true` within a small timeout window.
- [x] 6.3 Run `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/routes/ws_test.ts` and confirm all sub-tests pass.

## 7. Final verification

- [x] 7.1 Run `deno task test:backend` end-to-end and confirm 0 failures (existing 92 + new test sub-tests). If any pre-existing test fails, investigate whether the change introduced a regression.
- [x] 7.2 Run `deno task test:frontend` to confirm no frontend regression (this change is backend-only).
- [x] 7.3 Run `openspec validate fix-streaming-cancellation --strict` and confirm validation passes.
- [x] 7.4 Manually grep `writer/lib/chat-shared.ts` for any remaining `instanceof DOMException` references in the abort-handling code paths; confirm none remain in the abort discriminator.
