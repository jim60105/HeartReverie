# Chat Input

## MODIFIED Requirements

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
