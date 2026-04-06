# Options Panel

## MODIFIED Requirements

### Requirement: Option button click behavior

Since this is a standalone reader (no SillyTavern integration), clicking an option button SHALL copy the option text to the clipboard AND append the option text to the chat input textarea. A brief visual feedback (e.g., a toast notification or button state change) SHALL confirm the copy action. The append behavior SHALL use a direct module import of the `appendToInput` function from `chat-input.js` instead of the `window.__appendToInput` global bridge. The `window.__appendToInput` global bridge SHALL be removed.

#### Scenario: Clicking an option copies text to clipboard and appends to input

- **WHEN** the user clicks on option button 2 with text `走向藥妝店，想看看有沒有新出的商品`
- **THEN** the text `走向藥妝店，想看看有沒有新出的商品` SHALL be copied to the system clipboard, the same text SHALL be appended to the chat input textarea via the imported `appendToInput` function, and a visual confirmation SHALL be shown

#### Scenario: Clicking an option when chat input has existing content

- **WHEN** the chat textarea contains `先回家` and the user clicks an option with text `走向藥妝店`
- **THEN** the textarea value SHALL become `先回家\n走向藥妝店` and the text `走向藥妝店` SHALL be copied to the clipboard

#### Scenario: Append function not available

- **WHEN** the `appendToInput` function is not available (e.g., module failed to load) and the user clicks an option button
- **THEN** the clipboard copy SHALL still succeed and the missing function SHALL NOT cause an error

### Requirement: Option button click uses event delegation

The options panel SHALL NOT use inline `onclick` attributes on individual option buttons. Instead, a single event listener SHALL be attached to the `#content` container element using event delegation. The listener SHALL detect clicks on option buttons by checking the event target (or its closest ancestor) for a data attribute (e.g., `data-option-text`). This enables strict CSP compliance by eliminating inline event handlers.

#### Scenario: Click on option button detected via delegation
- **WHEN** the user clicks on an option button inside the rendered options panel
- **THEN** the `#content` container's delegated event listener SHALL detect the click, extract the option text from the button's `data-option-text` attribute, copy it to the clipboard, and append it to the chat input

#### Scenario: Click outside option buttons is ignored
- **WHEN** the user clicks on a non-option element inside `#content`
- **THEN** the delegated event listener SHALL not trigger any option-related behavior

#### Scenario: No inline onclick in rendered HTML
- **WHEN** the options panel HTML is rendered
- **THEN** the output SHALL NOT contain any `onclick` attributes on button elements

### Requirement: Shared escapeHtml utility

The options panel SHALL import `escapeHtml()` from a shared utility module (`reader/js/utils.js`) instead of defining its own local copy. The shared `escapeHtml()` function SHALL escape `&`, `<`, `>`, `"`, and `'` (single-quote → `&#39;`) to prevent attribute breakout XSS. All other modules that previously had their own `escapeHtml()` implementation SHALL also use this shared version.

#### Scenario: Single-quote is escaped
- **WHEN** option text contains a single quote (e.g., `it's a test`)
- **THEN** `escapeHtml()` SHALL return `it&#39;s a test`

#### Scenario: All HTML special characters are escaped
- **WHEN** option text contains `<script>alert("xss")&'`
- **THEN** `escapeHtml()` SHALL return `&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;`
