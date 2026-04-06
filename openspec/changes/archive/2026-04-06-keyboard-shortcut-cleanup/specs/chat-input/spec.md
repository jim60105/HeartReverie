## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Ctrl+Enter keyboard shortcut

The chat input previously allowed Ctrl+Enter (or Cmd+Enter on macOS) as a keyboard shortcut to submit the message. This requirement is removed and replaced by the plain Enter key submit behavior.

**Reason**: Plain Enter is more intuitive for chat-style UIs and aligns with common conventions (Slack, Discord, ChatGPT).

**Migration**: Press Enter to submit; press Shift+Enter for newline.
