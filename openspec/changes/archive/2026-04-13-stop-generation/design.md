## Context

HeartReverie's chat system currently supports send and resend over WebSocket (with HTTP fallback). Once a `chat:send` or `chat:resend` message is dispatched, the LLM generation runs to completion — there is no mechanism for the user to interrupt it. The `executeChat()` function in `writer/lib/chat-shared.ts` streams chunks from the upstream LLM API via SSE and writes each to disk, calling an optional `onDelta` callback for WebSocket delivery. The LLM fetch uses the standard `fetch()` API which supports `AbortSignal` for cooperative cancellation.

## Goals / Non-Goals

**Goals:**

- Allow users to stop an in-progress LLM generation immediately to save output token costs
- Add a `chat:abort` WebSocket message that the backend uses to abort the upstream LLM connection
- Add a Stop button in the ChatInput UI that is visible only during active generation
- Preserve partial content already written to the chapter file at the point of abort
- Support abort for both WebSocket and HTTP chat paths

**Non-Goals:**

- Deleting partial chapter content on abort (partial content is preserved as-is)
- Supporting multiple concurrent generations per connection (already single-generation)
- Undo/rollback of partial content — that's the resend button's job

## Decisions

### Decision 1: AbortController threading through executeChat

**Choice:** Add an optional `signal?: AbortSignal` parameter to `ChatOptions` and pass it to the `fetch()` call for the LLM API.

**Rationale:** The Fetch API natively supports `AbortSignal`. By threading the signal through `executeChat()`, both the WebSocket handler (which creates an `AbortController` per generation) and the HTTP handler (which can use request signal or timeout) can cancel the upstream request cooperatively. No custom cancellation mechanism needed.

**Alternative considered:** Custom cancellation flag polled in the SSE loop — rejected because `AbortSignal` on `fetch()` immediately tears down the TCP connection, stopping token consumption sooner.

### Decision 2: Per-generation AbortController in WS handler

**Choice:** The WebSocket `handleChatSend`/`handleChatResend` functions create an `AbortController` per invocation, store it in a connection-scoped `Map<string, AbortController>` keyed by the client-provided `id`, and pass `controller.signal` to `executeChat()`. When `chat:abort` arrives with a matching `id`, the controller is aborted.

**Rationale:** The `id` correlation allows aborting the correct generation if multiple messages are in flight (future-proof). A `Map` is used instead of a single variable because `chat:resend` calls `handleChatSend` internally, and the same pattern applies.

**Alternative considered:** Single `activeController` variable — simpler but doesn't support `id`-based correlation safely.

### Decision 3: Server sends chat:aborted confirmation

**Choice:** After calling `controller.abort()`, the server sends `{ type: "chat:aborted", id }` to the client and does NOT send `chat:done`. The SSE loop in `executeChat()` catches the `AbortError` and returns early, closing the chapter file cleanly with whatever was written.

**Rationale:** The client needs to know the abort succeeded to update UI state (hide stop button, re-enable inputs). Reusing `chat:done` would be ambiguous — the client can't tell if generation finished naturally or was aborted.

### Decision 4: HTTP abort via AbortController in useChatApi

**Choice:** For the HTTP fallback path, `useChatApi` creates a local `AbortController` and passes `signal` to the `fetch()` call. The `abortCurrentRequest()` function calls `controller.abort()`, which cancels the HTTP request.

**Rationale:** The HTTP POST to `/chat` is a blocking request that waits for full generation. Aborting the fetch doesn't stop server-side generation (the server doesn't know the client disconnected until it tries to send the response), but it frees the UI immediately. The server will eventually detect the closed connection when writing the response fails. This is acceptable because the HTTP path is a fallback.

### Decision 5: Stop button visibility and placement

**Choice:** The Stop button replaces the Send button during generation (conditional rendering with `v-if`/`v-else`). The Resend button remains visible but disabled during generation.

**Rationale:** Avoids cluttering the UI with three buttons. The user never needs Send and Stop simultaneously. A red/warning-styled button clearly communicates the destructive nature of stopping.

## Risks / Trade-offs

- **[Partial content left in chapter file]** → Acceptable by design. Users can use Resend to replace partial content. The chapter file is always in a valid state (just incomplete).
- **[HTTP abort doesn't stop server-side generation]** → The server continues generating but the response is discarded. This is the expected behavior for HTTP connections where the server can't be notified of client disconnect mid-request. The cost savings are smaller for HTTP path, but the UI becomes responsive immediately.
- **[Race condition: abort arrives after generation completes]** → The `Map.get(id)` returns the controller; `abort()` on an already-completed controller is a no-op. The server sends `chat:done` before `chat:aborted` could be processed. Client handles whichever arrives first.
