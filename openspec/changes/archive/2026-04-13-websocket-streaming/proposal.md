## Why

The current architecture relies on 3-second HTTP polling to detect new chapters and observe streaming progress. The server already receives LLM output as real-time SSE chunks and writes them to disk incrementally, but there is no push channel to the browser — the frontend blocks on the chat POST until generation completes, then polls the disk-written file every 3 seconds to show partial content. Replacing polling with a persistent WebSocket connection enables true real-time streaming of LLM deltas directly to the browser, eliminates redundant HTTP requests during idle periods, and provides a unified bidirectional channel for chat send/resend operations with proper message ordering guarantees.

## What Changes

- Add a WebSocket upgrade endpoint (`/api/ws`) on the Hono backend that authenticates via the first message (passphrase)
- Stream LLM response deltas directly to the browser over WebSocket as they arrive from the upstream SSE, in addition to writing them to disk (dual-write: file + WebSocket)
- Send chat `send` and `resend` commands as WebSocket messages instead of separate HTTP POST/DELETE requests, enabling ordered request/response correlation
- Push chapter-list change notifications over WebSocket when the chapter count changes (replaces the 3-second poll for chapter list)
- Push chapter-content deltas over WebSocket during active generation (replaces the 3-second poll for content updates)
- Remove the `setInterval`-based polling loop from `useChapterNav` when a WebSocket connection is active
- **BREAKING**: The chat HTTP endpoints (`POST /chat`) remain functional for backward compatibility, but the frontend will prefer the WebSocket channel when connected

## Capabilities

### New Capabilities
- `websocket-connection`: WebSocket upgrade endpoint, authentication handshake, connection lifecycle (open/close/reconnect), and typed message protocol (JSON frames with `type` discriminator)
- `websocket-chat-streaming`: Chat send/resend over WebSocket with real-time LLM delta streaming to browser, dual-write (file + WebSocket), and message correlation

### Modified Capabilities
- `auto-reload`: Replace polling-based chapter detection with WebSocket push notifications; keep polling as fallback when WebSocket is disconnected
- `chapter-navigation`: Receive chapter-content updates via WebSocket push during active generation instead of polling the last chapter file
- `chat-input`: Send chat messages via WebSocket channel instead of HTTP POST; handle streaming response state

## Impact

- **Backend**: New WebSocket upgrade handler in `writer/routes/` or `writer/server.ts`; chat route refactored to support dual output (HTTP response + WebSocket push); new message protocol types in `writer/types.ts`
- **Frontend**: New `useWebSocket` composable for connection management; `useChapterNav` modified to accept push updates; `useChatApi` modified to send/receive over WebSocket; `ChatInput.vue` updated for streaming state feedback
- **Dependencies**: Deno's built-in `WebSocket` API (no new dependencies); Hono's WebSocket helper (`hono/deno`)
- **Testing**: New WebSocket integration tests for backend; updated frontend composable tests mocking WebSocket
- **Risk**: Dual-write (file + WebSocket) means the file is written incrementally by the same SSE reader loop that also pushes to WebSocket — this is safe because both operations are sequential within the same async iteration (write chunk to file, then send chunk to WebSocket). No race condition exists since there is a single consumer of the upstream SSE stream.
