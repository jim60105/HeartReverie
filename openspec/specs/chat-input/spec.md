# Chat Input

## Purpose

Frontend chat input UI for submitting user messages to the story writer backend.

## Requirements

### Requirement: Input UI

The reader frontend SHALL display a chat input area below the rendered story content. The input area SHALL consist of a textarea for the user message and a submit button. The input area SHALL NOT be sticky or fixed-position; it SHALL scroll naturally with the page content below the story chapters.

#### Scenario: Input area placement
- **WHEN** the reader page is loaded with a story selected
- **THEN** a textarea and submit button SHALL be rendered below the story content, scrolling naturally with the page

#### Scenario: Input area without story
- **WHEN** no story is selected or loaded
- **THEN** the chat input area SHALL be hidden or disabled

### Requirement: Submit behavior

When the user submits a message, the frontend SHALL POST the message to `/api/stories/:series/:name/chat` with the `X-Passphrase` header included via the shared `getAuthHeaders()` function from `passphrase-gate.js`. The submit button, resend button, and textarea SHALL be disabled during the request to prevent duplicate submissions. After a successful response, the frontend SHALL reload the chapter list and display the newly created chapter. The frontend SHALL NOT clear the textarea after a successful send; the user's message text SHALL remain in the textarea. On error, the frontend SHALL display a generic error message to the user (e.g., "發送失敗，請稍後再試" / "Send failed, please try again later") and SHALL NOT display raw server response text, error bodies, or stack traces. The resend flow (DELETE last chapter then re-POST) SHALL also include the `X-Passphrase` header on both requests.

#### Scenario: Successful message submission
- **WHEN** the user types a message and clicks submit
- **THEN** the frontend SHALL POST to the chat endpoint with the `X-Passphrase` header, disable the input during the request, and reload chapters to display the new chapter after receiving a successful response

#### Scenario: Message retained after successful send
- **WHEN** a chat request completes successfully
- **THEN** the textarea SHALL retain the user's message text, allowing the user to resend or edit without retyping

#### Scenario: Input disabled during request
- **WHEN** a chat request is in progress
- **THEN** the textarea, submit button, and resend button SHALL be disabled and a loading indicator SHALL be visible

#### Scenario: Error during submission shows generic message
- **WHEN** the chat API returns an error (e.g., HTTP 500 with `{ "error": "Chat request failed" }`)
- **THEN** the frontend SHALL display a generic, user-friendly error message and SHALL NOT expose the raw server error response text to the user

#### Scenario: Network error shows generic message
- **WHEN** a network error occurs during the chat request (e.g., timeout, connection refused)
- **THEN** the frontend SHALL display a generic error message (e.g., "無法連線伺服器" / "Cannot connect to server") and SHALL NOT display technical error details

#### Scenario: Resend with passphrase header
- **WHEN** the user clicks the resend button
- **THEN** the DELETE request to remove the last chapter and the subsequent POST to re-send the message SHALL both include the `X-Passphrase` header

#### Scenario: Empty message prevention
- **WHEN** the user clicks submit with an empty or whitespace-only message
- **THEN** the frontend SHALL NOT send the request and SHALL indicate that a message is required

### Requirement: Resend button

The chat input area SHALL include a resend button (labeled "🔄 重送") alongside the existing send button. When clicked, the resend button SHALL: (1) call `DELETE /api/stories/:series/:name/chapters/last` to remove the last chapter file, then (2) send the current textarea content via the existing chat endpoint to regenerate the chapter. Both buttons (send and resend) SHALL be disabled during the resend operation. After the resend completes, the `onSent` callback SHALL be invoked to reload chapters.

#### Scenario: Resend deletes last chapter and re-sends message
- **WHEN** the user clicks the resend button with a non-empty message in the textarea
- **THEN** the frontend SHALL first DELETE the last chapter, then POST the message to the chat endpoint, and finally reload chapters to display the regenerated response

#### Scenario: Resend with empty textarea
- **WHEN** the user clicks the resend button with an empty textarea
- **THEN** the frontend SHALL NOT perform any action and SHALL display an error indicating that a message is required

#### Scenario: Resend error handling
- **WHEN** the DELETE request or the subsequent chat request fails during a resend
- **THEN** the frontend SHALL display the error message and re-enable all input controls

#### Scenario: Controls disabled during resend
- **WHEN** a resend operation is in progress
- **THEN** the textarea, send button, and resend button SHALL all be disabled with a loading indicator on the resend button

### Requirement: Append text to chat input programmatically

The chat input module SHALL export an `appendToInput(text)` function that appends the given text to the chat textarea. If the textarea already contains content, a newline character (`\n`) SHALL be prepended before the appended text. If the textarea is empty, the text SHALL be inserted directly without a leading newline.

#### Scenario: Appending to an empty textarea

- **WHEN** the chat textarea is empty and `appendToInput("走向藥妝店")` is called
- **THEN** the textarea value SHALL become `走向藥妝店` (no leading newline)

#### Scenario: Appending to a textarea with existing content

- **WHEN** the chat textarea contains `先回家` and `appendToInput("走向藥妝店")` is called
- **THEN** the textarea value SHALL become `先回家\n走向藥妝店`

#### Scenario: Textarea element not initialised

- **WHEN** `appendToInput(text)` is called before `initChatInput` has been called (textarea is not available)
- **THEN** the function SHALL do nothing and SHALL NOT throw an error

### Requirement: Enter key submits message

When the user presses Enter (without Shift) in the chat textarea, the frontend SHALL prevent the default newline insertion and trigger the same submit action as clicking the send button.

#### Scenario: Enter submits message
- **WHEN** the user presses Enter without holding Shift in the chat textarea
- **THEN** the frontend SHALL prevent the default behavior and invoke the send action, identical to clicking the submit button

#### Scenario: Enter on empty textarea
- **WHEN** the user presses Enter without holding Shift and the textarea is empty or whitespace-only
- **THEN** the send action SHALL execute its existing empty-message validation (displaying an error), and no newline SHALL be inserted

### Requirement: Shift+Enter inserts newline

When the user presses Shift+Enter in the chat textarea, the frontend SHALL allow the default browser behavior, inserting a newline character into the textarea without triggering a submit.

#### Scenario: Shift+Enter inserts newline
- **WHEN** the user presses Shift+Enter in the chat textarea
- **THEN** the browser's default behavior SHALL occur, inserting a newline into the textarea content
