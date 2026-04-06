# Spec: chat-input

> Frontend chat input UI for submitting user messages to the story writer backend.

## ADDED Requirements

### Requirement: Input UI

The reader frontend SHALL display a chat input area below the rendered story content. The input area SHALL consist of a textarea for the user message and a submit button. The input area SHALL NOT be sticky or fixed-position; it SHALL scroll naturally with the page content below the story chapters.

#### Scenario: Input area placement
- **WHEN** the reader page is loaded with a story selected
- **THEN** a textarea and submit button SHALL be rendered below the story content, scrolling naturally with the page

#### Scenario: Input area without story
- **WHEN** no story is selected or loaded
- **THEN** the chat input area SHALL be hidden or disabled

### Requirement: Submit behavior

When the user submits a message, the frontend SHALL POST the message to `/api/stories/:series/:name/chat`. The submit button and textarea SHALL be disabled during the request to prevent duplicate submissions. After a successful response, the frontend SHALL reload the chapter list and display the newly created chapter. On error, the frontend SHALL display the error message to the user and re-enable the input.

#### Scenario: Successful message submission
- **WHEN** the user types a message and clicks submit
- **THEN** the frontend SHALL POST to the chat endpoint, disable the input during the request, and reload chapters to display the new chapter after receiving a successful response

#### Scenario: Input disabled during request
- **WHEN** a chat request is in progress
- **THEN** the textarea and submit button SHALL be disabled and a loading indicator SHALL be visible

#### Scenario: Error during submission
- **WHEN** the chat API returns an error
- **THEN** the frontend SHALL display the error message, re-enable the textarea and submit button, and preserve the user's message in the textarea

#### Scenario: Empty message prevention
- **WHEN** the user clicks submit with an empty or whitespace-only message
- **THEN** the frontend SHALL NOT send the request and SHALL indicate that a message is required
