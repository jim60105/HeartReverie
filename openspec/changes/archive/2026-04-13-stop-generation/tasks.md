## 1. Backend: AbortController threading

- [x] 1.1 Add optional `signal?: AbortSignal` to `ChatOptions` in `writer/lib/chat-shared.ts` and pass it to the LLM `fetch()` call
- [x] 1.2 In the SSE stream loop, catch `AbortError` from the fetch response, close the chapter file cleanly with partial content, and return early without executing post-response hooks
- [x] 1.3 Add unit tests for `executeChat()` abort behavior: verify partial content preserved, verify post-response hooks skipped

## 2. Backend: WebSocket abort handler

- [x] 2.1 In `writer/routes/ws.ts`, add a connection-scoped `Map<string, AbortController>` for tracking active generations by `id`
- [x] 2.2 In `handleChatSend` and `handleChatResend`, create an `AbortController`, store it in the map keyed by `id`, and pass `controller.signal` to `executeChat()`. Remove the controller from the map in the `finally` block
- [x] 2.3 Add a `handleChatAbort` handler: look up the controller by `id`, call `abort()`, send `{ type: "chat:aborted", id }`, and remove the controller from the map. Silently ignore if no active generation for the given `id`
- [x] 2.4 Register the `chat:abort` message type in the WebSocket message dispatcher
- [x] 2.5 Add unit tests for the abort handler: abort active generation, abort after completion (no-op), abort with unknown id (no-op)

## 3. Frontend: useChatApi abort support

- [x] 3.1 In `reader-src/src/composables/useChatApi.ts`, add an `AbortController` field for tracking the current HTTP request and a `currentRequestId` ref for tracking the active WS generation id
- [x] 3.2 For WebSocket path: on abort, send `{ type: "chat:abort", id: currentRequestId }` and listen for `chat:aborted` to resolve the promise and reset state
- [x] 3.3 For HTTP fallback path: on abort, call `controller.abort()` on the in-flight fetch request
- [x] 3.4 Expose `abortCurrentRequest()` method from the composable that handles both WS and HTTP abort paths
- [x] 3.5 On receiving `chat:aborted`, set `isLoading` to `false`, clear `streamingContent`, and resolve the send/resend promise
- [x] 3.6 Add unit tests for composable abort: WS abort sends correct message, HTTP abort calls controller.abort(), abort when no active request is no-op

## 4. Frontend: Stop button UI

- [x] 4.1 In `ChatInput.vue`, add a Stop button (labeled "⏹ 停止") that conditionally renders in place of the Send button when `isLoading` is `true` (using `v-if`/`v-else`)
- [x] 4.2 Wire the Stop button click to call `useChatApi().abortCurrentRequest()`
- [x] 4.3 Style the Stop button with a warning/red theme to communicate the destructive action
- [x] 4.4 Add unit tests for Stop button: visible during loading, hidden when idle, calls abort on click, Send button reappears after abort completes

## 5. Integration and verification

- [x] 5.1 Verify existing chat send/resend tests still pass with the new AbortController changes
- [x] 5.2 Manual integration test: start a chat, click Stop mid-stream, verify partial content preserved and UI resets
- [x] 5.3 Manual integration test: start a chat via HTTP fallback, click Stop, verify fetch is aborted and UI resets
