## MODIFIED Requirements

### Requirement: Submit behavior

When the user submits a message, the frontend SHALL POST the message to `/api/stories/:series/:name/chat`. The submit button, resend button, and textarea SHALL be disabled during the request to prevent duplicate submissions. After a successful response, the frontend SHALL reload the chapter list and display the newly created chapter. The frontend SHALL NOT clear the textarea after a successful send; the user's message text SHALL remain in the textarea. On error, the frontend SHALL display the error message to the user and re-enable the input.

#### Scenario: Successful message submission
- **WHEN** the user types a message and clicks submit
- **THEN** the frontend SHALL POST to the chat endpoint, disable the input during the request, and reload chapters to display the new chapter after receiving a successful response

#### Scenario: Message retained after successful send
- **WHEN** a chat request completes successfully
- **THEN** the textarea SHALL retain the user's message text, allowing the user to resend or edit without retyping

#### Scenario: Input disabled during request
- **WHEN** a chat request is in progress
- **THEN** the textarea, submit button, and resend button SHALL be disabled and a loading indicator SHALL be visible

#### Scenario: Error during submission
- **WHEN** the chat API returns an error
- **THEN** the frontend SHALL display the error message, re-enable the textarea, submit button, and resend button, and preserve the user's message in the textarea

#### Scenario: Empty message prevention
- **WHEN** the user clicks submit with an empty or whitespace-only message
- **THEN** the frontend SHALL NOT send the request and SHALL indicate that a message is required

## ADDED Requirements

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
