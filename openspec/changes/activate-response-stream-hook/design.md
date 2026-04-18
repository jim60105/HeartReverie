## Context

The `response-stream` hook stage has been declared in the codebase since the hook system was introduced, but it has never been dispatched. `writer/types.ts` lists it in `HookStage`. `writer/lib/hooks.ts` includes it in `VALID_STAGES` so `register()` accepts it without error. The `plugin-hooks` spec documents it as a stage where plugins "observe or transform stream chunks", and even explicitly acknowledges (under "Undispatched hook stages documentation") that it is not yet active. Meanwhile, `executeChat()` in `writer/lib/chat-shared.ts` is the single code path that handles SSE chunks coming from the LLM — for both HTTP (`routes/chat.ts`) and WebSocket (`routes/ws.ts`) callers, which share this function via an `onDelta` callback.

Today, each parsed `delta` is immediately (a) appended to `aiContent`, (b) written to the chapter file via `file.write`, and (c) surfaced to the caller via `onDelta?.(delta)`. There is no interception point for plugins.

Constraints:
- Must be a single dispatch point so HTTP and WebSocket share behavior (both go through `executeChat()`).
- Must not change the semantics of `onDelta`, the on-disk chapter file, or the accumulated `aiContent` when no handler is registered.
- The hook must be awaitable (handlers may do async work like calling a moderation API).
- Streaming backpressure matters: the dispatch is per-chunk and runs inside the SSE read loop.

## Goals / Non-Goals

**Goals:**
- Dispatch `response-stream` for every non-empty content delta parsed from the LLM SSE stream, inside `executeChat()`.
- Let handlers **transform** the chunk (including to empty → drop) via a mutable `chunk` field on the context object, consistent with how `prompt-assembly` and `pre-write` use mutable fields.
- Make the payload shape explicit and typed (`ResponseStreamPayload`) so plugin authors and tests get a clear contract.
- Preserve byte-exact streaming behavior when zero handlers are registered.
- Emit the (possibly transformed) chunk to the chapter file, the accumulated `aiContent`, and the `onDelta` callback — i.e., what the client sees matches what is persisted.

**Non-Goals:**
- Redesigning the hook dispatcher (`HookDispatcher.dispatch` already supports mutable context — we reuse it unchanged).
- Introducing chunk batching, back-pressure controls, or per-chunk priority gating.
- Activating `strip-tags` (the other undispatched stage) — that is out of scope and tracked separately.
- Providing a sample/built-in plugin using `response-stream`. The hook is activated; adopting it is a future change.
- Exposing the hook to the frontend (`FrontendHookDispatcher`) — this is a backend-only streaming concern.

## Decisions

### Decision 1: Dispatch point — inside the SSE parse loop, per-delta, BEFORE side effects

Dispatch happens after a delta is successfully parsed but **before** `aiContent += delta`, the file write, and the `onDelta` callback. Concretely, both of the two delta-handling code paths in `executeChat()` (the main `while` loop and the trailing-buffer flush after the loop) get the same treatment:

```ts
if (delta) {
  const ctx = await hookDispatcher.dispatch("response-stream", {
    correlationId,
    chunk: delta,
    series,
    name,
    storyDir,
    chapterPath,
    chapterNumber: targetNum,
  });
  const out = typeof ctx.chunk === "string" ? ctx.chunk : "";
  if (out.length > 0) {
    aiContent += out;
    await file.write(encoder.encode(out));
    onDelta?.(out);
  }
}
```

**Rationale:** Dispatching *before* side effects is the only way a transform can affect what is persisted and what the client sees. Dispatching afterwards would make the hook observation-only, which contradicts the existing spec wording ("transform stream chunks").

**Alternatives considered:**
- *Dispatch after side effects, observation-only*: Rejected — eliminates the transformation use case (live censorship, redaction) that justifies activating the hook.
- *Dispatch in two phases (pre-transform + post-observe)*: Rejected — doubles per-chunk overhead and complicates the spec for a use case with no known consumer.
- *Dispatch once per flush boundary instead of per delta*: Rejected — the SSE reader's buffering is driven by the network, not by semantic boundaries, so "per chunk" is the only stable contract.

### Decision 2: Chunk transformation via mutable `chunk` field (not a return value)

The context object carries a mutable `chunk: string` field. Handlers transform by assignment (`context.chunk = transformed`). An empty string drops the chunk. Non-string assignments are treated as empty.

**Rationale:** This matches the existing pattern in `prompt-assembly` (mutates `previousContext`, `templateVariables`, `promptFragments`) and `pre-write` (mutates `preContent`). `HookDispatcher.dispatch()` already ignores handler return values and only propagates context-object mutations, so no dispatcher changes are needed. The existing spec text in Requirement "Handler execution" says `response-stream` handlers "MAY return a transformed chunk" — this change refines that to "MAY mutate `context.chunk`" for consistency with all other backend stages.

**Alternatives considered:**
- *Return value from handler*: Rejected — inconsistent with every other stage, would require dispatcher changes, harder to compose across multiple handlers.
- *Separate `output` field distinct from input `chunk`*: Rejected — adds complexity with no gain; mutation is the project's established convention.

### Decision 3: Typed payload — add `ResponseStreamPayload` interface in `writer/types.ts`

Define:

```ts
export interface ResponseStreamPayload {
  correlationId: string;
  chunk: string;          // mutable: handlers overwrite to transform; "" drops
  series: string;
  name: string;
  storyDir: string;
  chapterPath: string;
  chapterNumber: number;
  logger?: unknown;       // injected by HookDispatcher
}
```

The dispatcher still accepts `Record<string, unknown>`; this interface is for documentation, plugin authors, and tests. The dispatch call site spreads the payload into the `dispatch()` argument.

**Rationale:** Gives plugin authors an IDE-discoverable contract and catches typos at test time. Matches the explicit typing in `plugin-hooks` spec for other stages (e.g., `FrontendRenderContext`).

### Decision 4: No-handler fast path is the existing dispatcher behavior

When `#handlers.get("response-stream")` returns `undefined`/empty, `HookDispatcher.dispatch()` runs the zero-iteration loop and returns the context unchanged. The activation imposes:
- One `performance.now()` pair + one `Map.get` + one `debug` log per chunk.

This is acceptable: chunks are already on the order of tens per second and each triggers a `fetch` read + `decode` + `JSON.parse`. No additional optimization (e.g., skipping dispatch when no handlers) is needed; the dispatcher already handles it efficiently.

**Alternative considered:** short-circuit dispatch when the handler list is empty — micro-optimization rejected as unnecessary and it would diverge the `response-stream` call site from other stages.

### Decision 5: Error handling — per-handler errors must not break the stream

`HookDispatcher.dispatch()` already catches handler exceptions and logs them without rethrowing. The SSE read loop does NOT wrap the dispatch in additional `try/catch`. If a handler throws, the original delta is still persisted (because the handler mutated the context before throwing, or did not mutate it at all — either way, whatever is in `ctx.chunk` at return time is what gets written). This is intentional: a buggy observability plugin must not be able to corrupt a story.

**Edge case:** If a handler mutates `ctx.chunk` to `undefined`, non-string, or deletes the key, the activation code coerces to `""` (drop). This prevents `TypeError` in `encoder.encode()` and keeps the stream robust.

### Decision 6: Abort semantics unchanged

The existing `AbortSignal` wiring (`options.signal` propagated to `fetch`) is untouched. If the client aborts mid-stream, the `reader.read()` rejects with `AbortError`, the outer `try` catches it, and the `aborted` flag flips. Hook dispatch does not observe abort — that is the caller's concern. If an in-flight dispatch is running when abort fires, it completes on its own timeline (handlers receive no abort signal); this is consistent with `pre-write` and `post-response`.

## Risks / Trade-offs

- **Risk**: A slow handler introduces streaming latency visible to the user → **Mitigation**: document in the `plugin-hooks` spec that handlers run on the hot path and SHOULD be near-instant; tests verify the no-handler baseline is unchanged; project logging already records per-dispatch latency.
- **Risk**: A buggy handler drops every chunk, producing an empty chapter → **Mitigation**: the existing `no-content` check at the end of `executeChat()` (`if (!aiContent)`) still fires and throws `ChatError("no-content", ...)`, so the user gets a clear error rather than a silently-truncated story.
- **Risk**: A handler mutates context fields other than `chunk` (e.g., `chapterPath`) hoping to influence where content is written → **Mitigation**: spec requirement explicitly states only `chunk` is semantically honored; all other fields are read-only context; tests assert behavior.
- **Risk**: Handler ordering matters when multiple plugins transform the same chunk (e.g., redact then translate vs. translate then redact) → **Trade-off accepted**: priority-based ordering is the documented mechanism (`register(stage, handler, priority)`); plugin authors coordinate via priorities the same way they do for `prompt-assembly`.
- **Trade-off**: Per-chunk dispatch overhead (≈ one Map lookup + log in the no-handler case) is preferred over a "no dispatch if empty" micro-optimization, to keep the call site uniform with other stages and to guarantee that late-registered handlers (e.g., registered during startup but after the first chat request races) are still picked up by the next stream.

## Migration Plan

No user-facing migration. No existing plugin registers for `response-stream`. Deployment is a straightforward code update. Rollback is a single-commit revert; any plugin that starts depending on the hook after this lands will need to be disabled on rollback (but none exist at merge time).
