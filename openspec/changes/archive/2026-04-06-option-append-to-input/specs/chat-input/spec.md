## ADDED Requirements

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
