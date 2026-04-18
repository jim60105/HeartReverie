# Chat Input

## Purpose

Frontend chat input UI for submitting user messages to the story writer backend.

## Requirements

### Requirement: Input UI

The reader frontend SHALL render a `ChatInput.vue` component below the story content. The component SHALL contain a textarea bound via `v-model` to a reactive ref for the user message and a submit button. The input area SHALL NOT be sticky or fixed-position; it SHALL scroll naturally with the page content below the story chapters. The component SHALL accept props for configuration (e.g., `series`, `storyName`) and SHALL emit events for actions rather than accepting callback functions.

#### Scenario: Input area placement
- **WHEN** the reader page is loaded with a story selected
- **THEN** the `ChatInput.vue` component SHALL render a textarea and submit button below the story content, scrolling naturally with the page

#### Scenario: Input area without story
- **WHEN** no story is selected or loaded
- **THEN** the chat input component SHALL be hidden or disabled via Vue directive

### Requirement: Submit behavior

When the user submits a message, the chat input component SHALL emit a `send` event with the message text. The parent component or a `useChatApi()` composable SHALL handle the actual API call. When a WebSocket connection is active, the composable SHALL send the message as `{ type: "chat:send", id, series, story, message }` over the WebSocket and process incoming `chat:delta` messages to update a reactive `streamingContent` ref in real time. When WebSocket is unavailable, the composable SHALL fall back to the existing `POST /api/stories/:series/:name/chat` HTTP endpoint with the `X-Passphrase` header. The submit button, resend button, and textarea SHALL be disabled during the request via a reactive `isLoading` ref. A Stop button SHALL replace the Send button while `isLoading` is `true`, allowing the user to abort the active generation. After a successful response (either `chat:done` WebSocket message or HTTP 200), the component SHALL emit a `sent` event so the parent can reload chapters. The frontend SHALL NOT clear the textarea after a successful send; the user's message text SHALL remain in the textarea. On error (either `chat:error` WebSocket message or HTTP error), the frontend SHALL display a generic error message (e.g., "發送失敗，請稍後再試") and SHALL NOT display raw server response text. The resend flow (DELETE last chapter then re-POST, or `chat:resend` via WebSocket) SHALL also include the `X-Passphrase` header on HTTP requests.

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
- **THEN** the textarea and resend button SHALL be disabled, the Send button SHALL be replaced by a Stop button, and a loading indicator SHALL be visible

#### Scenario: Stop button replaces Send during generation
- **WHEN** a chat request is in progress (`isLoading` is `true`)
- **THEN** the Send button SHALL be hidden and a Stop button (labeled "⏹ 停止") SHALL be displayed in its place

#### Scenario: Stop button aborts active generation
- **WHEN** the user clicks the Stop button during an active WebSocket generation
- **THEN** the composable's `abortCurrentRequest()` method SHALL be called, a `chat:abort` message SHALL be sent over WebSocket, and the UI SHALL return to the idle state after receiving `chat:aborted`

#### Scenario: Stop button aborts HTTP generation
- **WHEN** the user clicks the Stop button during an active HTTP chat request
- **THEN** the composable's `abortCurrentRequest()` method SHALL abort the HTTP fetch via `AbortController.abort()`, and the UI SHALL return to the idle state

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

### Requirement: Resend button

The `ChatInput.vue` component SHALL include a resend button (labeled "🔄 重送") alongside the send button. When clicked, the component SHALL emit a `resend` event with the current message text. The parent or API composable SHALL: (1) call `DELETE /api/stories/:series/:name/chapters/last`, then (2) POST the message via the chat endpoint. Both buttons SHALL be disabled during the resend operation via the shared `isLoading` reactive ref. After the resend completes, a `sent` event SHALL be emitted to reload chapters.

#### Scenario: Resend deletes last chapter and re-sends message
- **WHEN** the user clicks the resend button with a non-empty message
- **THEN** the component SHALL emit a `resend` event, the API composable SHALL first DELETE the last chapter then POST the message, and finally a `sent` event SHALL be emitted

#### Scenario: Resend with empty textarea
- **WHEN** the user clicks the resend button with an empty textarea
- **THEN** the component SHALL NOT emit a `resend` event and SHALL display an error indicating that a message is required

#### Scenario: Resend error handling
- **WHEN** the DELETE request or subsequent chat request fails during a resend
- **THEN** the component SHALL display the error message via a reactive ref and re-enable all input controls by setting `isLoading` to `false`

#### Scenario: Controls disabled during resend
- **WHEN** a resend operation is in progress (`isLoading` is `true`)
- **THEN** the textarea, send button, and resend button SHALL all be disabled with a loading indicator on the resend button

### Requirement: Append text to chat input programmatically

The `ChatInput.vue` component SHALL expose an `appendText(text: string)` method via `defineExpose()` or provide a reactive model that parent components and plugins can write to. If the textarea already contains content, a newline character (`\n`) SHALL be prepended before the appended text. If the textarea is empty, the text SHALL be inserted directly without a leading newline. Plugins (e.g., options-panel) SHALL interact with the chat input via Vue's `provide`/`inject` pattern or a template ref, replacing the former `appendToInput` module import.

#### Scenario: Appending to an empty textarea
- **WHEN** the chat textarea is empty and `appendText("走向藥妝店")` is called on the component
- **THEN** the textarea's `v-model` bound ref SHALL become `走向藥妝店` (no leading newline)

#### Scenario: Appending to a textarea with existing content
- **WHEN** the chat textarea contains `先回家` and `appendText("走向藥妝店")` is called
- **THEN** the textarea's `v-model` bound ref SHALL become `先回家\n走向藥妝店`

#### Scenario: Component not mounted
- **WHEN** `appendText(text)` is called but the `ChatInput.vue` component is not mounted
- **THEN** the operation SHALL do nothing and SHALL NOT throw an error

### Requirement: Enter key submits message

When the user presses Enter (without Shift) in the chat textarea, the component SHALL prevent the default newline insertion and trigger the same submit action as clicking the send button. This SHALL be implemented via a Vue `@keydown.enter.exact.prevent` event binding on the textarea.

#### Scenario: Enter submits message
- **WHEN** the user presses Enter without holding Shift in the chat textarea
- **THEN** the component SHALL prevent the default behavior via the Vue event modifier and invoke the send action

#### Scenario: Enter on empty textarea
- **WHEN** the user presses Enter without holding Shift and the textarea is empty or whitespace-only
- **THEN** the send action's empty-message validation SHALL execute (displaying an error) and no newline SHALL be inserted

### Requirement: Shift+Enter inserts newline

When the user presses Shift+Enter in the chat textarea, the component SHALL allow the default browser behavior, inserting a newline character into the textarea without triggering a submit.

#### Scenario: Shift+Enter inserts newline
- **WHEN** the user presses Shift+Enter in the chat textarea
- **THEN** the browser's default behavior SHALL occur, inserting a newline into the textarea content

### Requirement: Vue component event contract
The `ChatInput.vue` component SHALL define typed emits using `defineEmits<{ send: [message: string]; resend: [message: string]; sent: [] }>()`. Parent components SHALL listen for these events to orchestrate API calls and chapter reloading, replacing the former callback injection pattern.

#### Scenario: Parent receives typed events
- **WHEN** the user clicks the send button with a valid message
- **THEN** the component SHALL emit a typed `send` event with the message string, and the parent component SHALL receive it via `@send="handleSend"`

### Requirement: API logic in composable
All API calls (WebSocket messages, POST chat, DELETE chapter) SHALL be extracted into a `useChatApi()` composable or equivalent, keeping the `ChatInput.vue` component focused on UI concerns. The composable SHALL accept the WebSocket connection from a shared `useWebSocket` composable and fall back to HTTP with authentication headers from a shared auth composable when WebSocket is unavailable. The composable SHALL expose an `abortCurrentRequest()` method that sends `{ type: "chat:abort", id }` over WebSocket (when connected) or calls `AbortController.abort()` on the HTTP fetch (when using HTTP fallback). Module-level state SHALL track the current request ID and HTTP `AbortController` for abort coordination.

#### Scenario: Component does not call fetch or WebSocket directly
- **WHEN** inspecting the `ChatInput.vue` component source
- **THEN** no direct `fetch()`, `XMLHttpRequest`, or `WebSocket.send()` calls SHALL exist within the component; all API interactions SHALL be delegated to a composable or service layer

#### Scenario: Composable uses WebSocket when available
- **WHEN** `useChatApi()` is initialized and a WebSocket connection is active
- **THEN** the composable SHALL route chat send/resend through the WebSocket channel instead of HTTP

#### Scenario: Composable falls back to HTTP when WebSocket unavailable
- **WHEN** `useChatApi()` is initialized and no WebSocket connection is active
- **THEN** the composable SHALL use the existing HTTP endpoints for chat send/resend

#### Scenario: Composable exposes abort method
- **WHEN** `useChatApi()` is initialized
- **THEN** the composable SHALL return an `abortCurrentRequest()` method that the component can call to abort the active generation

#### Scenario: Abort via WebSocket sends abort message
- **WHEN** `abortCurrentRequest()` is called while a WebSocket generation is active
- **THEN** the composable SHALL send `{ type: "chat:abort", id }` over the WebSocket connection using the tracked request ID

#### Scenario: Abort via HTTP cancels fetch
- **WHEN** `abortCurrentRequest()` is called while an HTTP chat request is active
- **THEN** the composable SHALL call `abort()` on the HTTP `AbortController`, the fetch SHALL throw an `AbortError`, and the composable SHALL handle it silently without displaying an error message

#### Scenario: Abort when idle is no-op
- **WHEN** `abortCurrentRequest()` is called but no generation is active
- **THEN** the method SHALL return without side effects

### Requirement: Persist input text via sessionStorage

The `ChatInput.vue` component SHALL persist its textarea content to `sessionStorage` under a story-scoped key: `"heartreverie:chat-input:<series>:<story>"`. The component SHALL save the current textarea text to sessionStorage immediately before emitting a `send` or `resend` event. On component initialization (`<script setup>`), the component SHALL read from sessionStorage and populate the textarea's reactive ref with the stored value, or default to an empty string if no stored value exists. All sessionStorage access SHALL be wrapped in try/catch to gracefully handle restricted environments (falling back to empty string on read, silently failing on write).

#### Scenario: Text saved on send
- **WHEN** the user clicks the send button with a non-empty message
- **THEN** the component SHALL write the textarea content to `sessionStorage.setItem("heartreverie:chat-input:<series>:<story>", text)` before emitting the `send` event

#### Scenario: Text saved on resend
- **WHEN** the user clicks the resend button with a non-empty message
- **THEN** the component SHALL write the textarea content to `sessionStorage.setItem("heartreverie:chat-input:<series>:<story>", text)` before emitting the `resend` event

#### Scenario: Text restored on component mount
- **WHEN** the `ChatInput.vue` component is initialized (mounted or re-mounted)
- **THEN** the component SHALL read `sessionStorage.getItem("heartreverie:chat-input:<series>:<story>")` and set the textarea's reactive ref to the stored value

#### Scenario: No stored value on first mount
- **WHEN** the component is initialized and `sessionStorage.getItem(...)` returns `null`
- **THEN** the textarea's reactive ref SHALL default to an empty string

#### Scenario: Text survives component remount
- **WHEN** the user types a message, sends it, and the component is destroyed then recreated (e.g., due to chapter navigation toggling `v-if`)
- **THEN** the recreated component SHALL display the previously sent message text in the textarea

#### Scenario: Storage isolated per story
- **WHEN** the user sends "hello" in story A, then navigates to story B
- **THEN** story B's chat input SHALL NOT display "hello"; it SHALL display story B's own persisted value or an empty string

#### Scenario: Storage unavailable
- **WHEN** sessionStorage is unavailable or throws an error (e.g., private browsing restrictions)
- **THEN** the component SHALL render normally with an empty textarea and SHALL NOT throw or display an error
