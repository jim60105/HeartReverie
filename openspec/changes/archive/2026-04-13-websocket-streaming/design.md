## Context

The HeartReverie frontend currently uses a 3-second HTTP polling loop (`setInterval` in `useChapterNav`) to detect new chapters and observe streaming progress during LLM generation. The server receives LLM output as SSE chunks via `stream: true`, writes each chunk incrementally to a chapter file on disk, and only returns the HTTP response to the browser after generation completes. The browser sees partial content by re-reading the growing file every 3 seconds.

This architecture has inherent latency (up to 3 seconds per visible update), generates unnecessary HTTP requests during idle periods, and provides no ordering guarantees between the chat response and chapter updates.

The backend runs on Hono/Deno which natively supports WebSocket via `Deno.upgradeWebSocket()` and Hono's `upgradeWebSocket()` helper from `hono/deno`. No new dependencies are required.

## Goals / Non-Goals

**Goals:**
- Replace HTTP polling with WebSocket push for real-time chapter updates during LLM generation
- Stream LLM response deltas directly to the browser over WebSocket (dual-write: file + WebSocket)
- Unify chat send/resend into WebSocket messages with request-response correlation
- Push chapter-list change notifications when new files appear
- Maintain backward compatibility: HTTP chat endpoint continues to work for non-WebSocket clients
- Graceful degradation: fall back to polling when WebSocket is unavailable or disconnected

**Non-Goals:**
- Multi-user broadcast / room-based WebSocket (this is a single-user application)
- Binary WebSocket frames (all messages are JSON text)
- WebSocket for prompt editor or other non-chat features
- Server-Sent Events as an intermediate step (go directly to WebSocket)
- Changing the LLM SSE streaming protocol (upstream remains OpenAI-compatible SSE)

## Decisions

### Decision 1: Single WebSocket connection per session

**Choice:** One WebSocket connection handles all real-time communication (chat, chapter updates, streaming deltas).

**Rationale:** The application is single-user. A single connection simplifies state management, authentication, and reconnection. Multiple connections would add complexity without benefit.

**Alternatives considered:**
- Separate WebSocket per feature (chat, chapters): rejected — unnecessary complexity for single-user app
- Server-Sent Events for push + HTTP for commands: rejected — SSE is unidirectional, would still need HTTP for send/resend

### Decision 2: JSON message protocol with `type` discriminator

**Choice:** All WebSocket messages are JSON objects with a `type` field that discriminates the message kind.

Client → Server message types:
- `{ type: "auth", passphrase: string }` — Authentication handshake (first message)
- `{ type: "chat:send", id: string, series: string, story: string, message: string }` — Send chat message
- `{ type: "chat:resend", id: string, series: string, story: string, message: string }` — Resend (delete last + re-send)
- `{ type: "subscribe", series: string, story: string }` — Subscribe to chapter updates for a story

Server → Client message types:
- `{ type: "auth:ok" }` — Authentication successful
- `{ type: "auth:error", detail: string }` — Authentication failed
- `{ type: "chat:delta", id: string, content: string }` — Streaming LLM delta chunk
- `{ type: "chat:done", id: string }` — Generation complete
- `{ type: "chat:error", id: string, detail: string }` — Chat error
- `{ type: "chapters:updated", series: string, story: string, count: number }` — Chapter count changed
- `{ type: "chapters:content", series: string, story: string, chapter: number, content: string }` — Chapter content changed
- `{ type: "error", detail: string }` — Generic protocol error

**Rationale:** JSON with `type` discriminator is simple, debuggable, and maps cleanly to TypeScript discriminated unions. The `id` field on chat messages enables request-response correlation.

**Alternatives considered:**
- Protocol Buffers: rejected — overkill for single-user app, adds build step
- Newline-delimited JSON: rejected — WebSocket frames already provide message boundaries

### Decision 3: Authentication via first message

**Choice:** The client sends `{ type: "auth", passphrase: string }` as its first message after WebSocket upgrade. The server validates the passphrase using the existing timing-safe comparison. All subsequent messages are rejected until auth succeeds. The server closes the connection with code 4001 if auth fails.

**Rationale:** WebSocket upgrade requests cannot carry custom headers in browser APIs. Query string auth exposes credentials in logs. First-message auth is the standard browser WebSocket authentication pattern.

**Alternatives considered:**
- Cookie-based auth: rejected — current auth is passphrase-based, not session-based
- Query parameter: rejected — credentials appear in access logs and referrer headers
- Upgrade header: rejected — browser WebSocket API doesn't support custom headers

### Decision 4: Dual-write architecture (file + WebSocket)

**Choice:** During LLM generation, each SSE chunk from the upstream LLM is processed sequentially: (1) written to the chapter file on disk, (2) sent as a `chat:delta` message to the WebSocket client. Both operations happen within the same async iteration of the SSE stream reader.

**Rationale:** File persistence is essential for the FSA mode and story continuity. WebSocket delivery enables real-time display. Since there is a single consumer of the upstream SSE stream and operations are sequential within each iteration, no race condition exists.

**Alternatives considered:**
- WebSocket-only (no file write during streaming): rejected — breaks FSA mode and story persistence
- File write only, then read-and-push: rejected — introduces read-after-write latency and potential race conditions
- Tee the readable stream: rejected — adds complexity; sequential dual-write is simpler and equally correct

### Decision 5: Chapter monitoring via filesystem polling on server

**Choice:** The server uses a lightweight `setInterval` (1-second) to check the chapter directory for new files when a client is subscribed. When the count changes, it pushes a `chapters:updated` message. The polling runs only when a WebSocket client is subscribed to a story.

**Rationale:** Deno's `Deno.watchFs()` is available but has platform-specific quirks. A 1-second server-side poll is simple, reliable, and has negligible overhead for a single-user application. The poll is scoped to the subscribed story directory only.

**Alternatives considered:**
- `Deno.watchFs()`: viable alternative, but adds complexity for edge cases (duplicate events, debouncing). Can be adopted later as an optimization.
- Client-side polling as fallback only: this is the current architecture; server-side monitoring enables push

### Decision 6: Automatic reconnection with exponential backoff

**Choice:** The `useWebSocket` composable SHALL implement automatic reconnection using exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap). During disconnection, the composable falls back to the existing HTTP polling mechanism. On reconnection, it re-authenticates and re-subscribes.

**Rationale:** Network interruptions are expected. Seamless reconnection with fallback ensures the user never sees a broken UI.

### Decision 7: WebSocket route at `/api/ws`

**Choice:** The WebSocket upgrade endpoint is at `GET /api/ws`. It uses Hono's `upgradeWebSocket()` helper.

**Rationale:** Consistent with existing API route naming. Single endpoint simplifies client configuration.

## Risks / Trade-offs

- **[Risk] WebSocket connection drops during LLM generation** → The server continues writing to disk regardless of WebSocket state. On reconnection, the client can read the chapter file via HTTP to catch up on missed content.
- **[Risk] Memory pressure from buffering deltas** → Deltas are forwarded immediately, not buffered. If the WebSocket send buffer backs up, the server can drop delta messages (client catches up via file read on next poll).
- **[Risk] Dual-write ordering** → File write happens before WebSocket send. If WebSocket send fails, the file still has the content. The client can always fall back to reading the file.
- **[Trade-off] Server-side polling for chapters** → Adds a 1-second timer per subscribed story. Acceptable for single-user; would need `watchFs` for multi-user.
- **[Trade-off] Breaking change to chat flow** → Frontend switches from HTTP POST to WebSocket message. The HTTP endpoint remains for backward compatibility but the frontend no longer uses it when WebSocket is connected.

## Open Questions

- Should the server push the full chapter content on `chapters:content`, or just a notification that triggers a client-side fetch? Full content is simpler but sends more data over WebSocket.
- Should the chat HTTP endpoint remain permanently, or be deprecated in a future version?
