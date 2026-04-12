## MODIFIED Requirements

### Requirement: Submit behavior

When the user submits a message, the chat input component SHALL emit a `send` event with the message text. The parent component or a `useChatApi()` composable SHALL handle the actual API call. When a WebSocket connection is active, the composable SHALL send the message as `{ type: "chat:send", id, series, story, message }` over the WebSocket and process incoming `chat:delta` messages to update a reactive `streamingContent` ref in real time. When WebSocket is unavailable, the composable SHALL fall back to the existing `POST /api/stories/:series/:name/chat` HTTP endpoint with the `X-Passphrase` header. The submit button, resend button, and textarea SHALL be disabled during the request via a reactive `isLoading` ref. After a successful response (either `chat:done` WebSocket message or HTTP 200), the component SHALL emit a `sent` event so the parent can reload chapters. The frontend SHALL NOT clear the textarea after a successful send; the user's message text SHALL remain in the textarea. On error (either `chat:error` WebSocket message or HTTP error), the frontend SHALL display a generic error message (e.g., "發送失敗，請稍後再試") and SHALL NOT display raw server response text. The resend flow (DELETE last chapter then re-POST, or `chat:resend` via WebSocket) SHALL also include the `X-Passphrase` header on HTTP requests.

#### Scenario: Successful message submission via WebSocket
- **WHEN** the user types a message, clicks submit, and WebSocket is connected
- **THEN** the composable SHALL send `{ type: "chat:send", id, series, story, message }` over WebSocket, receive streaming `chat:delta` messages updating the reactive `streamingContent` ref, and emit a `sent` event after receiving `chat:done`

#### Scenario: Successful message submission via HTTP fallback
- **WHEN** the user types a message, clicks submit, and WebSocket is disconnected
- **THEN** the composable SHALL POST to the chat endpoint with the `X-Passphrase` header, the component's `isLoading` ref SHALL disable inputs, and a `sent` event SHALL be emitted after a successful response

#### Scenario: Message retained after successful send
- **WHEN** a chat request completes successfully (via either channel)
- **THEN** the textarea's `v-model` bound ref SHALL retain the user's message text

#### Scenario: Input disabled during request
- **WHEN** a chat request is in progress (component's `isLoading` ref is `true`)
- **THEN** the textarea, submit button, and resend button SHALL be disabled via `:disabled="isLoading"` and a loading indicator SHALL be visible

#### Scenario: Error during WebSocket submission shows generic message
- **WHEN** the server sends `{ type: "chat:error", id, detail }` over WebSocket
- **THEN** the component SHALL display a generic, user-friendly error message via a reactive `errorMessage` ref and SHALL NOT expose the raw server error detail

#### Scenario: Error during HTTP submission shows generic message
- **WHEN** the chat HTTP API returns an error (e.g., HTTP 500)
- **THEN** the component SHALL display a generic, user-friendly error message via a reactive `errorMessage` ref and SHALL NOT expose the raw server error response

#### Scenario: Network error shows generic message
- **WHEN** a network error occurs during the chat request (either channel)
- **THEN** the component SHALL display a generic error message (e.g., "無法連線伺服器") via a reactive ref and SHALL NOT display technical error details

#### Scenario: Resend via WebSocket
- **WHEN** the user clicks the resend button and WebSocket is connected
- **THEN** the composable SHALL send `{ type: "chat:resend", id, series, story, message }` over WebSocket and process the streaming response identically to `chat:send`

#### Scenario: Resend via HTTP fallback with passphrase header
- **WHEN** the user clicks the resend button and WebSocket is disconnected
- **THEN** the component SHALL emit a `resend` event, and the API composable SHALL include the `X-Passphrase` header on both the DELETE and POST HTTP requests

#### Scenario: Empty message prevention
- **WHEN** the user clicks submit with an empty or whitespace-only message
- **THEN** the component SHALL NOT emit a `send` event and SHALL indicate that a message is required

### Requirement: API logic in composable
All API calls (WebSocket messages, POST chat, DELETE chapter) SHALL be extracted into a `useChatApi()` composable or equivalent, keeping the `ChatInput.vue` component focused on UI concerns. The composable SHALL accept the WebSocket connection from a shared `useWebSocket` composable and fall back to HTTP with authentication headers from a shared auth composable when WebSocket is unavailable.

#### Scenario: Component does not call fetch or WebSocket directly
- **WHEN** inspecting the `ChatInput.vue` component source
- **THEN** no direct `fetch()`, `XMLHttpRequest`, or `WebSocket.send()` calls SHALL exist within the component; all API interactions SHALL be delegated to a composable or service layer

#### Scenario: Composable uses WebSocket when available
- **WHEN** `useChatApi()` is initialized and a WebSocket connection is active
- **THEN** the composable SHALL route chat send/resend through the WebSocket channel instead of HTTP

#### Scenario: Composable falls back to HTTP when WebSocket unavailable
- **WHEN** `useChatApi()` is initialized and no WebSocket connection is active
- **THEN** the composable SHALL use the existing HTTP endpoints for chat send/resend
