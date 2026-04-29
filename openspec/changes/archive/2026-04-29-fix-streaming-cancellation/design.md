## Context

The streaming-cancellation pipeline straddles three layers: a frontend Stop button (`reader-src/src/components/ChatInput.vue` → `useChatApi.abortCurrentRequest()`), a transport routing decision (WebSocket `chat:abort` message vs. HTTP `fetch` AbortController), and the backend `executeChat()` function in `writer/lib/chat-shared.ts` which proxies the upstream LLM stream. OpenRouter's [stream-cancellation contract](https://openrouter.ai/docs/api/reference/streaming#stream-cancellation) only requires that the inbound TCP/HTTP connection to the provider be closed; the rest of the pipeline (preserving partial output, surfacing the right error to the user, recording usage, releasing per-request state) is our responsibility.

The current code passes a `ChatAbortError` instance as the `reason` argument to `AbortController.abort()` on the WebSocket side, but the catch sites in `chat-shared.ts` discriminate aborts by `err instanceof DOMException && err.name === "AbortError"`. This mismatch was easy to miss because (a) the HTTP path uses `c.req.raw.signal` which Hono/Deno aborts *without* a custom reason — that path's check coincidentally works, and (b) the WS streaming-read case still ends up emitting `chat:aborted` because `ws.ts` re-catches `ChatAbortError`, hiding the fact that the dedicated abort cleanup branch in `chat-shared.ts` was skipped.

OpenRouter's mid-stream error format is documented as a unified SSE event with a top-level `error` field plus `choices[0].finish_reason: "error"`. Our SSE parser reads `choices[0].delta.content` and `usage` only, so a provider failure mid-stream silently drops; the loop then exits via `done`, the abort flag is never set, and depending on whether any tokens streamed before the error the user sees either "no content" 502 or a successful response missing the failure reason.

The project has zero deployed users, so no migration is required — we can rewrite the contract and assert the corrected behavior in tests.

## Goals / Non-Goals

**Goals:**

- Abort detection in `executeChat()` MUST be **reason-agnostic**: regardless of whether the abort reason is `undefined` (default `DOMException`), a custom `Error`, or a `ChatAbortError` instance, the dedicated abort branch (file close → log abort → throw `ChatAbortError`) MUST run.
- Mid-stream provider errors per OpenRouter's documented format MUST be detected and surfaced as a structured `ChatError` (HTTP 502 + RFC 9457 / `chat:error` envelope) rather than silently swallowed.
- All abort and mid-stream-error code paths MUST be covered by deterministic backend tests that exercise the real `executeChat()` function with a stubbed `globalThis.fetch`.
- Existing public envelopes (`chat:aborted`, `chat:error`, HTTP 499, RFC 9457 Problem Details) and the `useChatApi` frontend composable MUST remain unchanged — this is a backend correctness fix only.

**Non-Goals:**

- Introducing retries on mid-stream errors. The provider list in OpenRouter's docs explicitly notes that some providers do not support cancellation; building generic retry/circuit-breaker logic is out of scope.
- Changing the partial-content preservation policy. The current behavior (the partial chapter file is left on disk for the user to inspect) is preserved.
- Front-end changes. The `useChatApi` composable already handles all three terminal events (`chat:done`, `chat:error`, `chat:aborted`) plus HTTP `AbortError` — no UI work is required.
- Adding env-var configuration for any of this. Per the existing project posture, the contract is hard-coded.

## Decisions

### Decision 1: Discriminate aborts by `signal.aborted`, narrowed around `reader.read()`

**Choice**: Replace the `err instanceof DOMException && err.name === "AbortError"` check in the upstream-`fetch()` `catch` with `signal?.aborted === true`. In the streaming loop, **narrow** the abort catch so it wraps only the `await reader.read()` call:

```ts
while (true) {
  let chunk: ReadableStreamReadResult<Uint8Array>;
  try {
    chunk = await reader.read();
  } catch (err) {
    if (signal?.aborted === true) { aborted = true; break; }
    throw err;
  }
  const { done, value } = chunk;
  // ... parse + persist outside the abort-discriminating catch
}
```

File writes, JSON parsing, hook dispatch, and `onDelta` callbacks live outside that narrow `try`, so errors from those operations propagate normally instead of being silently classified as client aborts when a concurrent abort happens to be in flight.

**Rationale**: `AbortSignal.aborted` is the canonical, transport-independent flag for "this operation was cancelled" — it is true regardless of whether the abort reason is `undefined`, a `DOMException`, a custom `Error`, or a `ChatAbortError`. The existing checks were brittle because they depended on which path called `controller.abort(reason)` with what argument. **Narrowing** the catch to `reader.read()` is essential because the only operation that genuinely throws on abort is the read call; widening the abort discriminator across the whole streaming `try` would mask file-system errors, plugin-hook bugs, or DOM exceptions from the JSON parser as "aborts".

**Alternatives considered**:

- *Match `err instanceof DOMException || err instanceof ChatAbortError`*: works today but reintroduces the same fragility — any future code path that calls `abort()` with a different reason type will silently fall through. Rejected.
- *Wrap the entire streaming `try` in `signal.aborted` discrimination*: simpler diff but allows non-read errors (file write, hook throw) to be misclassified as aborts. Rejected per critique.
- *Pass no reason from the WS route and keep the DOMException check*: works but does not protect against future code paths that mistakenly call `abort(reason)`. The `signal.aborted` check is strictly more robust. We will *also* simplify the WS route to call `abort()` without a reason, but the `signal.aborted` check is the load-bearing fix.

### Decision 2: Stop passing custom abort reasons in `writer/routes/ws.ts`

**Choice**: Change `controller.abort(new ChatAbortError("Connection closed"))` (line 106) and `controller.abort(new ChatAbortError("Generation aborted by client"))` (line 352) to plain `controller.abort()`.

**Rationale**: The reason was never observed by callers — `chat-shared.ts` always constructs a fresh `ChatAbortError` for the public throw, so the reason-as-message argument was decorative. With Decision 1 in place, dropping the reason simplifies the producer side and makes the default (a `DOMException` named `AbortError`) the universal contract. This also aligns the backend with the OpenRouter SDK example in the docs, which uses `controller.abort()` without arguments.

### Decision 3: Mid-stream error detection via top-level `error` field, raised outside the JSON-parse catch

**Choice**: Inside the streaming SSE parser, restructure the existing `try { JSON.parse(payload) } catch { /* skip malformed */ }` so the `catch` swallows **only** `SyntaxError` (i.e. JSON-parse failures). Detection of `parsed.error` (non-null object) and `parsed.choices?.[0]?.finish_reason === "error"` runs **outside** that `catch`, so the thrown `ChatError("llm-stream", ...)` is not silently dropped:

```ts
let raw: unknown;
try {
  raw = JSON.parse(payload);
} catch {
  continue; // malformed JSON only — not application errors
}
if (typeof raw !== "object" || raw === null) continue;
const parsed = raw as LLMStreamChunk & { error?: { message?: string; code?: number | string } };

const hasErrorField = typeof parsed.error === "object" && parsed.error !== null;
const finishedWithError = parsed.choices?.[0]?.finish_reason === "error";
if (hasErrorField || finishedWithError) {
  const message = parsed.error?.message
    ?? (parsed.error?.code !== undefined ? String(parsed.error.code) : "Mid-stream provider error");
  llmLog.info("LLM error", {
    type: "error",
    errorCode: "stream-error",
    latencyMs: Math.round(performance.now() - llmStartTime),
    error: message,
    partialLength: aiContent.length,
  });
  throw new ChatError("llm-stream", message, 502);
}

const delta = parsed.choices?.[0]?.delta?.content;
if (delta) { ... }
```

A new `"llm-stream"` member is added to the `ChatError.code` discriminated-union type, and a corresponding entry is added to the `ERROR_TITLES` map in `writer/routes/chat.ts` (e.g. `"llm-stream": "Bad Gateway"`) so the RFC 9457 Problem Details response carries a meaningful `title`.

The outer streaming `try`/`catch` (the one that previously caught `DOMException` to set `aborted = true`) is updated to **rethrow `ChatError` instances without re-logging** — otherwise the `errorCode: "stream-error"` log would be duplicated by the existing `errorCode: "stream"` log line. The outer catch's job becomes purely "set `aborted = true` if `signal.aborted`, otherwise log + rethrow", and `ChatError` is recognized as an already-logged structured error.

**Rationale**: The OpenRouter docs are explicit that the unified SSE error event is the only signal of a mid-stream failure once HTTP 200 has been sent. Dual-checking both `error` and `finish_reason: "error"` is robust against minor format drift — providers may send only one or the other. Throwing a `ChatError` (not a `ChatAbortError`) routes correctly through the existing HTTP catch (which emits a 502 RFC 9457 problem) and the WS catch (which emits `chat:error` with the message as `detail`), so no envelope changes are needed downstream. Pulling the throw out of the JSON-parse catch is essential — if it were left inside, the existing `catch {}` would silently swallow it and the bug would remain.

**Alternatives considered**:

- *Treat mid-stream errors as soft failures (return `result.usage = null` with whatever content streamed)*: hides a real failure from the user. Rejected — the user explicitly asked for correctness against the OpenRouter contract.
- *Convert the mid-stream error to a `chat:done` with a footer note in the chapter*: leaks provider error strings into user-visible story content. Rejected.
- *Throw inside the JSON-parse `catch`*: would be silently swallowed. Rejected per critique.

### Decision 4: Test the corrected paths against `executeChat()` directly with a stubbed `fetch`

**Choice**: Add focused backend tests in `tests/writer/lib/` that drive `executeChat()` end-to-end with a stubbed `globalThis.fetch` returning a `Response` whose `body` is a controllable `ReadableStream`. The existing `chat_shared_reasoning_test.ts` and `chat_shared_app_attribution_test.ts` already establish this pattern — extend it.

The new tests cover:

1. **Abort before upstream fetch resolves**: pre-aborted controller is passed in; `executeChat` rejects with `ChatAbortError`; no chapter file is created; `llm.jsonl` records `errorCode: "aborted"`.
2. **Abort during streaming after some tokens**: controller is aborted from a microtask scheduled mid-stream; `executeChat` rejects with `ChatAbortError`; the partial chapter file contains the streamed prefix; the LLM log records the abort with `aborted: true` and a non-null `latencyMs`.
3. **Mid-stream error chunk after some tokens**: stub stream yields one normal `data:` chunk, then an `error` chunk per OpenRouter format, then `[DONE]`; `executeChat` rejects with `ChatError("llm-stream", ...)` carrying the provider message; the partial chapter file contains the prefix; the LLM log records `errorCode: "stream-error"`.
4. **One end-to-end WebSocket abort test in `tests/writer/routes/ws_test.ts`**: send `chat:send`, observe at least one `chat:delta` arrives, send `chat:abort`, expect `chat:aborted` (NOT `chat:error`), confirm `activeGenerations` returns to zero so the idle timer is restored.

**Rationale**: Driving `executeChat()` directly is the lowest-cost way to assert the actual abort and mid-stream-error contracts. The WS end-to-end test is necessary to prove the bug fix (without it we cannot regression-protect the "abort during fetch initiation surfaces as 502" failure mode). Pure unit-level mocking of the `signal.aborted` flag would not catch real-world fetch behavior.

**Alternatives considered**:

- *Test by mocking `globalThis.AbortController`*: brittle — couples tests to internal implementation choices. Rejected.
- *Skip the WS end-to-end test, rely on unit tests of `executeChat`*: would not catch a regression where the WS route forgets to attach the per-request `AbortController` to its `abortControllers` map. Rejected.

## Risks / Trade-offs

- **Risk**: A future code path inside `executeChat()` that catches `AbortError` and proceeds without consulting `signal.aborted` could re-introduce the same fragility for downstream operations (e.g., the post-stream `pre-write` or `response-stream` hooks). → **Mitigation**: the `signal` parameter is held for the lifetime of `executeChat()`; documentation in the new spec scenarios makes the convention explicit ("abort is determined by `signal.aborted`, not by error type"). Future reviewers can grep for `signal.aborted`.
- **Risk**: OpenRouter's mid-stream error format may evolve (e.g., to use `event: error` SSE event names instead of inline JSON). → **Mitigation**: the proposed check inspects both `parsed.error` and `parsed.choices?.[0]?.finish_reason === "error"`, providing two independent triggers. If the format changes substantially, this is a one-function update and the test will fail loudly.
- **Risk**: Providers that do **not** support stream cancellation (per OpenRouter's published list) will continue billing after our `fetch` connection closes. → **Mitigation**: this is inherent to the upstream contract; we already document the same caveat. The new spec scenarios call this out so users / forks understand the limitation.
- **Trade-off**: We tighten the abort contract but keep the public envelopes unchanged. A hypothetical fork that depended on the *current* mis-routed 502 for "abort during fetch init" would silently switch to a 499. We accept this because (a) the project is pre-release and (b) the corrected behavior is what the OpenRouter contract requires.
- **Trade-off**: The stubbed-`fetch` test pattern requires each test to construct a `ReadableStream` and a synthetic SSE payload. This is verbose but already in use — we add helper functions in the new test file to reduce duplication if multiple scenarios benefit.

## Migration Plan

No migration: the project has zero deployed users and no backward-compat target. Deploy is a single `git pull` + restart.
