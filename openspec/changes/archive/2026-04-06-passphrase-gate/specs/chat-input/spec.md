## MODIFIED Requirements

### Requirement: Submit behavior

When the user submits a message, the frontend SHALL POST the message to `/api/stories/:series/:name/chat` with the `X-Passphrase` header included via the shared `getAuthHeaders()` function from `passphrase-gate.js`. The submit button, resend button, and textarea SHALL be disabled during the request to prevent duplicate submissions. After a successful response, the frontend SHALL reload the chapter list and display the newly created chapter. The frontend SHALL NOT clear the textarea after a successful send; the user's message text SHALL remain in the textarea. On error, the frontend SHALL display the error message to the user and re-enable the input. The resend flow (DELETE last chapter then re-POST) SHALL also include the `X-Passphrase` header on both requests.

#### Scenario: Successful message submission
- **WHEN** the user types a message and clicks submit
- **THEN** the frontend SHALL POST to the chat endpoint with the `X-Passphrase` header, disable the input during the request, and reload chapters to display the new chapter after receiving a successful response

#### Scenario: Message retained after successful send
- **WHEN** a chat request completes successfully
- **THEN** the textarea SHALL retain the user's message text, allowing the user to resend or edit without retyping

#### Scenario: Input disabled during request
- **WHEN** a chat request is in progress
- **THEN** the textarea, submit button, and resend button SHALL be disabled and a loading indicator SHALL be visible

#### Scenario: Error during submission
- **WHEN** the chat API returns an error
- **THEN** the frontend SHALL display the error message, re-enable the textarea, submit button, and resend button, and preserve the user's message in the textarea

#### Scenario: Resend with passphrase header
- **WHEN** the user clicks the resend button
- **THEN** the DELETE request to remove the last chapter and the subsequent POST to re-send the message SHALL both include the `X-Passphrase` header
