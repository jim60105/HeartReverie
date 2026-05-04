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

### Requirement: Continue button on the chat input

The `ChatInput.vue` component SHALL render a "Continue" (繼續) button alongside the existing Send / Resend / Stop buttons. The button SHALL be visible whenever a story is selected (the same gate that enables the textarea today).

The button SHALL be disabled when ANY of the following conditions hold:

1. The component prop `disabled` is `true` (no story selected, or parent-imposed disable).
2. The shared `isLoading` ref from `useChatApi()` is `true` — another generation is in flight on this client.
3. The chapter list is empty — the story has zero `NNN.md` files on disk. The component SHALL read this from a reactive `chapterCount` ref exposed by `useChapterNav()` (or the equivalent composable that owns the chapter list).
4. The latest chapter's content is whitespace-only — there is nothing to continue. The component SHALL read this from a reactive `latestChapterIsEmpty` ref exposed by the same composable.

When the user clicks the button (and it is enabled), the component SHALL invoke `useChatApi().continueLastChapter(series, story)` exactly once. The component SHALL NOT clear the textarea (the user's previous message text remains untouched). The component SHALL surface streaming progress through the existing `streamingContent` reactive ref and SHALL surface errors through the existing `errorMessage` reactive ref, identically to the Send flow.

The Stop button SHALL replace the Continue button (and the Send button) while `isLoading` is `true`, and clicking Stop SHALL invoke `abortCurrentRequest()` from `useChatApi()` — i.e. the same Stop button serves all three modes (send, resend, continue).

#### Scenario: Continue button hidden conditions

- **GIVEN** a reader page where no story is selected
- **WHEN** the user views the page
- **THEN** the chat input is hidden (existing behaviour); the Continue button is therefore not rendered

#### Scenario: Continue button disabled when no chapters

- **GIVEN** a story is selected but the story directory has zero chapter files
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be visible and SHALL have its native `disabled` attribute set to `true`

#### Scenario: Continue button disabled when latest chapter is empty

- **GIVEN** a story whose latest `NNN.md` file exists but contains only whitespace
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be visible and disabled, with the same opacity / cursor styling as other disabled chat buttons

#### Scenario: Continue button disabled while another generation is active

- **GIVEN** a chat send / resend / continue is currently in flight (`isLoading.value === true`)
- **WHEN** the chat input renders
- **THEN** the Continue button SHALL be disabled, the Send button SHALL be hidden and replaced by the Stop button, and the Resend button SHALL also be disabled (existing behaviour)

#### Scenario: Click invokes continueLastChapter

- **GIVEN** a story is selected, the chapter list is non-empty, the latest chapter has content, and no generation is active
- **WHEN** the user clicks the Continue button
- **THEN** the component SHALL call `useChatApi().continueLastChapter(series, story)` exactly once with the currently-loaded series and story names; SHALL NOT clear or modify the textarea; SHALL transition to `isLoading === true`; AND SHALL begin updating `streamingContent` from the streaming response

#### Scenario: Streaming preview shows continuation deltas

- **GIVEN** a continue request that streams three content deltas
- **WHEN** the deltas arrive
- **THEN** the existing `streamingContent` ref SHALL accumulate exactly the three deltas (in order), and the streaming preview block SHALL render them under the input card identically to the send flow

#### Scenario: Stop button aborts continue

- **GIVEN** a continue request is in flight (`isLoading.value === true`)
- **WHEN** the user clicks the Stop button
- **THEN** `abortCurrentRequest()` SHALL be invoked, dispatching `chat:abort` over WebSocket (or aborting the HTTP `AbortController` on fallback), AND the UI SHALL return to the idle state on receipt of `chat:aborted` (or HTTP 499)

### Requirement: useChatApi exposes continueLastChapter

The `useChatApi()` composable in `reader-src/src/composables/useChatApi.ts` SHALL export a new method `continueLastChapter(series: string, story: string): Promise<boolean>`. The method SHALL:

1. Refuse to start (resolve `false` and set `errorMessage` to a generic message) if `isLoading.value === true` already — defence in depth against double-click.
2. Dispatch `frontendHooks.dispatch("chat:send:before", …)` is NOT required (continue has no user-visible message to mutate); plugins relying on `chat:send:before` are not invoked for continue.
3. When `useWebSocket().isConnected.value && useWebSocket().isAuthenticated.value`, send `{ type: "chat:continue", id, series, story }` and subscribe to `chat:delta` / `chat:done` / `chat:error` / `chat:aborted` envelopes correlated by `id` — the same correlation logic the existing `sendMessage()` uses.
4. Otherwise (HTTP fallback), `POST /api/stories/:series/:name/chat/continue` with the existing auth headers from `useAuth().getAuthHeaders()`. Use a fresh `AbortController` and assign it to the module-scoped `httpAbortController` so the existing `abortCurrentRequest()` can cancel it.
5. On success (`chat:done` or HTTP 200), call `useUsage().pushRecord(usage)` with the returned record (or call `useUsage().load(series, story)` to reconcile when the response omits `usage`), and resolve `true`.
6. On error (`chat:error` or HTTP non-2xx), set `errorMessage.value` to a generic Traditional-Chinese message (e.g. `"繼續失敗"`); SHALL NOT expose the raw server `detail` text to the user. Dispatch `frontendHooks.dispatch("notification", { event: "chat:error", … })` with the same shape as the send path.
7. On abort (`chat:aborted` or HTTP 499 / `AbortError`), resolve `false` without setting `errorMessage`.

The `isLoading`, `streamingContent`, and `errorMessage` reactive refs SHALL be the same module-scoped refs already shared by `sendMessage()` and `resendMessage()` — no new refs are introduced.

#### Scenario: WS path sends chat:continue envelope

- **GIVEN** WebSocket is connected and authenticated
- **WHEN** `continueLastChapter("s1", "n1")` is invoked
- **THEN** the composable SHALL emit exactly one `{ type: "chat:continue", id: <uuid>, series: "s1", story: "n1" }` over the WebSocket, and SHALL NOT issue any HTTP request

#### Scenario: HTTP fallback POSTs to /chat/continue

- **GIVEN** WebSocket is disconnected
- **WHEN** `continueLastChapter("s1", "n1")` is invoked
- **THEN** the composable SHALL `POST` to `/api/stories/s1/n1/chat/continue` with the auth headers from `useAuth().getAuthHeaders()` and SHALL set `signal` on the fetch to a fresh `AbortController.signal`

#### Scenario: Streaming deltas update streamingContent

- **GIVEN** an in-flight continue request over WebSocket
- **WHEN** the server emits `{ type: "chat:delta", id, content: "看見店員微笑。" }`
- **THEN** the shared `streamingContent` ref SHALL be appended with exactly `"看見店員微笑。"`

#### Scenario: Error surfaces generic message

- **GIVEN** a continue request that fails with `chat:error` (or HTTP 502)
- **WHEN** the failure arrives
- **THEN** `errorMessage.value` SHALL be set to a generic Traditional-Chinese error string and SHALL NOT contain the raw server `detail` text; the function SHALL resolve `false`; AND `isLoading.value` SHALL be `false`

### Requirement: Chapter list composable exposes continue gating refs

The chapter list composable (`useChapterNav()` in `reader-src/src/composables/useChapterNav.ts`, or its equivalent) SHALL expose two reactive refs that the Continue button can read directly without re-fetching:

- `chapterCount: Ref<number>` — the number of chapter files currently known to the frontend (kept up-to-date by the existing polling / refresh flow).
- `latestChapterIsEmpty: Ref<boolean>` — `true` when the highest-numbered chapter has neither a `<user_message>` block content nor any non-whitespace prose remainder, mirroring the backend's `executeContinue()` refusal condition (refuse only when **both** parts are empty). Concretely: the ref SHALL be computed by running a client-side equivalent of `parseChapterForContinue()` on the chapter's loaded text and checking that **both** `userMessageText.trim() === ""` and `assistantPrefill.trim() === ""`. SHALL be `false` when `chapterCount === 0` (the gate-on-zero-chapters condition is owned by `chapterCount`, not by this ref). Aligning with backend semantics avoids the silent UX bug where the button enables but the backend refuses with `no-content`.

The refs SHALL update reactively whenever the chapter list refreshes (poll, manual reload, or post-`chat:done` reconciliation). No new fetch is required — the chapter content is already in scope for the existing chapter renderer.

#### Scenario: Refs reflect zero chapters

- **GIVEN** a freshly created story directory with no `NNN.md` files
- **WHEN** the composable initialises and finishes its first chapter list load
- **THEN** `chapterCount.value === 0` AND `latestChapterIsEmpty.value === false`

#### Scenario: Refs reflect a non-empty latest chapter

- **GIVEN** a story whose latest chapter contains the prose `"他走進店裡。"`
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === false`

#### Scenario: Refs reflect a chapter with only `<user_message>` (no prose)

- **GIVEN** a story whose latest chapter contains `<user_message>探索藥妝店</user_message>\n\n` followed by no prose
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === false` (continue is allowed because `userMessageText` is non-empty)

#### Scenario: Refs reflect an empty latest chapter

- **GIVEN** a story whose latest chapter file is whitespace-only OR contains only stripped-away plugin tags (no `<user_message>` body and no prose)
- **WHEN** the composable's chapter list reflects the on-disk state
- **THEN** `chapterCount.value > 0` AND `latestChapterIsEmpty.value === true`

