## 1. Types and Protocol

- [x] 1.1 Define WebSocket message types in `writer/types.ts` — client-to-server (`AuthMessage`, `ChatSendMessage`, `ChatResendMessage`, `SubscribeMessage`) and server-to-client (`AuthOkMessage`, `AuthErrorMessage`, `ChatDeltaMessage`, `ChatDoneMessage`, `ChatErrorMessage`, `ChaptersUpdatedMessage`, `ChaptersContentMessage`, `ErrorMessage`) as TypeScript discriminated unions with `type` field
- [x] 1.2 Define frontend WebSocket message types in `reader-src/src/types/index.ts` — mirror the server types for type-safe parsing on the client side

## 2. Backend WebSocket Endpoint

- [x] 2.1 Create `writer/routes/ws.ts` with WebSocket upgrade handler using Hono's `upgradeWebSocket()` — handle upgrade, reject non-WebSocket requests with 426
- [x] 2.2 Implement first-message authentication in `ws.ts` — parse `auth` message, validate passphrase via timing-safe comparison, respond with `auth:ok` or `auth:error` (close with code 4001), reject non-auth messages before authentication
- [x] 2.3 Implement JSON message dispatcher in `ws.ts` — parse incoming messages, dispatch by `type` field, handle malformed JSON with error response, ignore unknown types
- [x] 2.4 Implement connection lifecycle in `ws.ts` — track authenticated state and subscriptions, clean up on close, implement 60-second idle timeout with close code 4002
- [x] 2.5 Register WebSocket route in `writer/app.ts` at `GET /api/ws`

## 3. Backend Story Subscription

- [x] 3.1 Implement `subscribe` message handler in `ws.ts` — validate series/story params, start 1-second server-side polling of chapter directory, push `chapters:updated` on count change, push `chapters:content` on last-chapter content change
- [x] 3.2 Implement subscription replacement — new `subscribe` stops previous polling interval and starts monitoring the new story directory
- [x] 3.3 Implement subscription cleanup on WebSocket close — clear polling intervals and release resources

## 4. Backend Chat over WebSocket

- [x] 4.1 Extract shared chat logic from `writer/routes/chat.ts` into a reusable function — template reading, prompt building, LLM API call, SSE parsing, file writing, post-response hooks
- [x] 4.2 Implement `chat:send` handler in `ws.ts` — call shared chat function with dual-write callback that writes to file AND sends `chat:delta` over WebSocket, send `chat:done` on completion, send `chat:error` on failure
- [x] 4.3 Implement `chat:resend` handler in `ws.ts` — delete last chapter file, then proceed with `chat:send` logic; handle zero-chapters error
- [x] 4.4 Handle WebSocket disconnect during generation — catch WebSocket send errors silently, continue file writes, skip further WebSocket sends
- [x] 4.5 Ensure post-response hooks execute identically for WebSocket-initiated and HTTP-initiated chat

## 5. Frontend WebSocket Composable

- [x] 5.1 Create `reader-src/src/composables/useWebSocket.ts` — singleton composable managing a single WebSocket connection with reactive `isConnected` ref
- [x] 5.2 Implement authentication handshake in `useWebSocket` — send `auth` message on open, handle `auth:ok`/`auth:error` responses, expose `isAuthenticated` reactive ref
- [x] 5.3 Implement automatic reconnection with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap) and re-authentication on reconnect
- [x] 5.4 Implement typed message sending (`send(message)`) and event-based message receiving (`onMessage(type, handler)`) in `useWebSocket`
- [x] 5.5 Implement connection cleanup on composable disposal

## 6. Frontend Chat via WebSocket

- [x] 6.1 Update `useChatApi.ts` — when WebSocket is connected, send `chat:send` / `chat:resend` messages instead of HTTP POST; generate unique `id` for correlation
- [x] 6.2 Add `streamingContent` reactive ref to `useChatApi` — accumulate `chat:delta` content in real time, clear on `chat:done` or `chat:error`
- [x] 6.3 Implement HTTP fallback in `useChatApi` — when WebSocket is disconnected, use existing HTTP POST/DELETE endpoints
- [x] 6.4 Update `ChatInput.vue` to display streaming content during generation — show `streamingContent` from `useChatApi` in the UI when `isLoading` is true
- [x] 6.5 Handle `chat:error` messages — set `errorMessage` ref with generic user-friendly text, reset `isLoading`

## 7. Frontend Chapter Updates via WebSocket

- [x] 7.1 Update `useChapterNav.ts` — listen for `chapters:updated` WebSocket messages to update `chapters` ref reactively without HTTP polling
- [x] 7.2 Update `useChapterNav.ts` — listen for `chapters:content` WebSocket messages to update cached last-chapter content reactively
- [x] 7.3 Send `subscribe` message from `loadFromBackend()` when WebSocket is connected — subscribe to the currently loaded story
- [x] 7.4 Implement WebSocket/polling toggle — stop HTTP polling when WebSocket is connected, resume polling on disconnect
- [x] 7.5 Re-subscribe on WebSocket reconnection — after re-authentication, re-send `subscribe` for the currently loaded story

## 8. Backend Tests

- [x] 8.1 Test WebSocket upgrade — successful upgrade, non-WebSocket rejection (426)
- [x] 8.2 Test first-message authentication — valid passphrase → `auth:ok`, invalid → `auth:error` + close 4001, non-auth before auth → error
- [x] 8.3 Test subscribe — valid subscription starts monitoring, subscription replacement stops previous
- [x] 8.4 Test `chat:send` — message correlation, delta streaming, `chat:done` on completion, `chat:error` on failure
- [x] 8.5 Test `chat:resend` — deletes last chapter then streams, zero-chapters error case
- [x] 8.6 Test connection lifecycle — idle timeout (60s), cleanup on close, generation continues after disconnect
- [x] 8.7 Test JSON protocol — malformed JSON → error, unknown type → silently ignored

## 9. Frontend Tests

- [x] 9.1 Test `useWebSocket` — connection, authentication handshake, reconnection with backoff, message sending/receiving
- [x] 9.2 Test `useChatApi` with WebSocket — send over WebSocket, receive streaming deltas, HTTP fallback when disconnected
- [x] 9.3 Test `useChapterNav` with WebSocket — chapters:updated processing, chapters:content processing, polling toggle, subscribe on loadFromBackend
- [x] 9.4 Test `ChatInput.vue` streaming display — streamingContent shown during generation

## 10. Documentation

- [x] 10.1 Update `AGENTS.md` with WebSocket architecture description — endpoint, protocol, message types
- [x] 10.2 Update `.env.example` if any new environment variables are needed (no new vars needed)
