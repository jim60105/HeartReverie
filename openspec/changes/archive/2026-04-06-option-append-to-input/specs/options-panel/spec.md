## MODIFIED Requirements

### Requirement: Option button click behavior

Since this is a standalone reader (no SillyTavern integration), clicking an option button SHALL copy the option text to the clipboard AND append the option text to the chat input textarea. A brief visual feedback (e.g., a toast notification or button state change) SHALL confirm the copy action. The append behavior SHALL use the global bridge function (`window.__appendToInput`) registered by the application wiring layer to insert text into the chat textarea.

#### Scenario: Clicking an option copies text to clipboard and appends to input

- **WHEN** the user clicks on option button 2 with text `走向藥妝店，想看看有沒有新出的商品`
- **THEN** the text `走向藥妝店，想看看有沒有新出的商品` SHALL be copied to the system clipboard, the same text SHALL be appended to the chat input textarea, and a visual confirmation SHALL be shown

#### Scenario: Clicking an option when chat input has existing content

- **WHEN** the chat textarea contains `先回家` and the user clicks an option with text `走向藥妝店`
- **THEN** the textarea value SHALL become `先回家\n走向藥妝店` and the text `走向藥妝店` SHALL be copied to the clipboard

#### Scenario: Append function not available

- **WHEN** the global bridge function `window.__appendToInput` is not registered and the user clicks an option button
- **THEN** the clipboard copy SHALL still succeed and the missing append function SHALL NOT cause an error
