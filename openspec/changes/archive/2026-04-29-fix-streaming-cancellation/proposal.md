## Why

Our streaming-cancellation implementation has two correctness gaps that diverge from [OpenRouter's stream-cancellation contract](https://openrouter.ai/docs/api/reference/streaming#stream-cancellation), and the abort code path has no backend test coverage.

1. The WebSocket route calls `controller.abort(new ChatAbortError(...))` (in `writer/routes/ws.ts` for both per-request abort and connection close). Per the WHATWG `AbortController` contract, when a `reason` argument is supplied, `signal.reason` is set to that value and `fetch()` (and the underlying stream reader) reject with that exact reason — **not** a generic `DOMException` named `AbortError`. The two `catch` blocks in `writer/lib/chat-shared.ts` (initial `fetch()` at line 244; streaming SSE read at line 420) test only `err instanceof DOMException && err.name === "AbortError"`, so they fail to recognize a `ChatAbortError` reason. Consequences: an abort during fetch initiation is mis-reported to the client as a 502 / generic `chat:error`; an abort during stream reading skips the dedicated cleanup branch (`if (aborted) { ... }` at lines 433–446) which logs the abort, records partial token usage, and constructs a clean `ChatAbortError` — instead the original `ChatAbortError` is rethrown bare from line 427, also tagged in logs as a `stream` error rather than `aborted`.

2. The SSE parser ignores OpenRouter's documented **mid-stream error** format. After tokens have streamed, OpenRouter cannot change the HTTP status (already 200 OK), so it delivers errors as a unified SSE event with a top-level `error` field plus `choices[0].finish_reason: "error"`. Our parser at `chat-shared.ts:371-389` only inspects `choices[0].delta.content` and `usage`, so a mid-stream provider failure is silently dropped — the loop reaches `break` on `done`, the `aborted` flag is never set, the `sawModelContent` guard may trigger a misleading "no content" 502, and the user is told the request "failed" with no detail.

This change is timely because the project is pre-release with zero deployed users, so we can fix the bugs without any migration concerns and codify the corrected contract in specs and tests.

## What Changes

- **BREAKING (internal)**: replace the brittle `err instanceof DOMException && err.name === "AbortError"` checks in `writer/lib/chat-shared.ts` with `signal.aborted` (an idempotent, reason-agnostic flag). For the initial-`fetch()` `catch` block the check guards the entire `try` body (only `fetch` is awaited there). For the streaming-read `catch` block, the abort discriminator MUST be narrowed to wrap **only** `reader.read()` — file writes, JSON parsing, hook dispatch, and `onDelta` invocations MUST surface their own errors instead of being misclassified as aborts when a concurrent abort happens to be in flight.
- Add a new `"llm-stream"` member to the `ChatError.code` discriminated-union literal type in `writer/lib/chat-shared.ts` and add a corresponding entry to the `ERROR_TITLES` map in `writer/routes/chat.ts` so HTTP responses use a meaningful Problem Details `title`.
- Add explicit handling for OpenRouter's mid-stream error chunks in the SSE parser. Restructure the parser so the existing `try { JSON.parse(...) } catch { /* skip malformed */ }` swallows **only** `SyntaxError` / parse failures: detection of `parsed.error` (non-null object) or `parsed.choices?.[0]?.finish_reason === "error"` MUST happen *outside* that catch so the thrown `ChatError("llm-stream", ...)` propagates. Log the failure exactly once to the LLM interaction log with `errorCode: "stream-error"`; the outer streaming catch MUST be updated to recognize `ChatError` instances and rethrow them without adding a second `"stream"` log entry. Preserve any already-streamed content via the existing `finally { file.close(); }` block.
- Stop passing a custom reason to `controller.abort(...)` in `writer/routes/ws.ts` (both the per-request `chat:abort` handler and the on-disconnect cleanup). The default `DOMException("AbortError")` is sufficient because the abort branch in `chat-shared.ts` is now reason-agnostic and the public `ChatAbortError` instance is always re-constructed inside `chat-shared.ts`.
- Add backend tests in `tests/writer/lib/` and `tests/writer/routes/` that drive the full abort and mid-stream-error paths through `executeChat()` with a stubbed `globalThis.fetch` that yields a controllable streaming `Response`. Cover at minimum: (a) abort triggered before the upstream fetch resolves, (b) abort triggered after some SSE chunks have streamed, (c) mid-stream error chunk delivered after some content. Each test must assert the public observable behavior (thrown error class, logged abort/error fields, and partial chapter file contents).
- Document the contract: the new `streaming-cancellation` capability spec captures the four guarantees (signal propagation, abort-reason agnosticism, partial-content preservation on abort, mid-stream error detection); the `writer-backend` spec is updated to reference the new capability and add scenarios for the corrected abort/mid-stream paths.

## Capabilities

### New Capabilities

- `streaming-cancellation`: the contract for cancelling an in-flight LLM streaming request — what triggers cancellation (HTTP client disconnect, WebSocket `chat:abort`, WebSocket close), how the abort signal propagates to the upstream `fetch`, what client error is surfaced (`ChatAbortError` → 499 / `chat:aborted`), what partial state is preserved on disk, and how mid-stream provider errors are detected and reported.

### Modified Capabilities

- `writer-backend`: the existing "LLM API proxy" requirement gains scenarios for abort during fetch initiation, abort during streaming, mid-stream error chunks, and a cross-reference to the new `streaming-cancellation` capability.
- `websocket-chat-streaming`: existing requirements gain scenarios documenting that connection close aborts all in-flight generations and that `chat:abort` for an unknown id is silently ignored (already true in code; previously untested at the spec level).

## Impact

- **Code**: `writer/lib/chat-shared.ts` (abort detection switched to `signal.aborted`; SSE parser extended with mid-stream error handling), `writer/routes/ws.ts` (drop the custom abort reason in two places).
- **Tests**: new backend test files under `tests/writer/lib/` (abort and mid-stream error scenarios for `executeChat`) and at least one extension to `tests/writer/routes/ws_test.ts` (end-to-end abort flow).
- **APIs**: HTTP `/api/stories/:series/:name/chat` continues to return 499 on abort; WebSocket `chat:aborted` and `chat:error` envelopes are unchanged. Behavioral fix only — no envelope schema change.
- **Logs**: the LLM interaction log (`llm.jsonl`) gains a new `errorCode: "stream-error"` value for mid-stream failures; the existing `aborted: true` response log is now reliably emitted on every abort path.
- **Frontend**: no changes required — the `useChatApi` composable already handles `chat:aborted`, `chat:error`, and HTTP 499 correctly. Indirect benefit: the user no longer sees `發送失敗` (generic chat error) when they press the Stop button mid-fetch.
- **Specs**: one new capability (`streaming-cancellation`), two MODIFIED capabilities (`writer-backend`, `websocket-chat-streaming`).
- **Dependencies / runtime / config**: none. No new env vars, no new packages. Pure correctness fix plus tests plus documentation.
