## Why

Users currently have no way to halt an ongoing LLM generation once a chat message is submitted. Since LLM output tokens cost money, unnecessary or unwanted generation wastes budget. A "Stop" button lets users cancel mid-stream, immediately saving token costs and freeing up the interface for the next interaction.

## What Changes

- Add a "Stop" button in the chat input area, visible only while generation is in progress
- Add a `chat:abort` client-to-server WebSocket message type that signals the backend to abort the active LLM generation
- Add a `chat:aborted` server-to-client WebSocket message type that confirms the abort
- Backend immediately closes the upstream LLM API connection upon receiving `chat:abort`, stopping further token consumption
- The chapter file retains whatever content was written up to the abort point (partial content is preserved, not deleted)
- Pass an `AbortSignal` through `executeChat()` so the LLM fetch request can be cancelled cooperatively
- Add HTTP abort support via an `AbortController` in the HTTP chat fallback path

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `websocket-connection`: Add `chat:abort` to the client-to-server message types and `chat:aborted` to the server-to-client message types in the JSON protocol requirement
- `websocket-chat-streaming`: Add abort handling during active generation — `chat:abort` stops the LLM stream, closes the upstream connection, and sends `chat:aborted` with the correlation `id`
- `chat-input`: Add a "Stop" button that appears during generation and sends `chat:abort` (or aborts the HTTP request); update `useChatApi` to support aborting in-flight requests

## Impact

- **Backend**: `writer/lib/chat-shared.ts` — `executeChat()` gains an `AbortSignal` parameter to cancel the LLM fetch; `writer/routes/ws.ts` — new `chat:abort` message handler; `writer/types.ts` — new message type definitions
- **Frontend**: `reader-src/src/components/ChatInput.vue` — new Stop button UI; `reader-src/src/composables/useChatApi.ts` — abort logic for both WS and HTTP paths; `reader-src/src/types/index.ts` — new message type definitions
- **Tests**: New backend and frontend tests for abort behavior
- **No breaking changes**: Existing send/resend flows are unaffected; the abort is purely additive
