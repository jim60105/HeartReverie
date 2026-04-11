# Options Panel

## Purpose

Detects, parses, and renders `<options>` blocks from chapter content into a 2×2 interactive button grid, supporting numbered option extraction, styled display, clipboard copy on click, and graceful handling of malformed input.

## Requirements

### Requirement: Options block detection and extraction
The renderer SHALL detect `<options>...</options>` blocks in the chapter content. The entire block from opening to closing tag SHALL be extracted for structured parsing. Options blocks SHALL only be rendered on the last chapter: when the current chapter is the last chapter in the story, the extracted block SHALL be passed to the options panel renderer as normal; when the current chapter is not the last chapter, the block SHALL be extracted but replaced with an empty placeholder (no visible output), preventing options from cluttering intermediate chapters.

#### Scenario: Options block is present in last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is the last chapter in the story
- **THEN** the block SHALL be extracted and passed to the options panel renderer for full display

#### Scenario: Options block is present in non-last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is not the last chapter in the story
- **THEN** the block SHALL be extracted from the content but replaced with an empty placeholder, producing no visible output

#### Scenario: No options block in chapter
- **WHEN** the chapter content does not contain an `<options>` block
- **THEN** no options panel SHALL be rendered for that chapter

### Requirement: Parsing numbered option items
The options parser SHALL extract exactly 4 numbered items from the block. Each item follows the format `N:【text】` or `N: 【text】` where N is 1 through 4. The parser SHALL strip the `【` and `】` bracket characters from the option text.

#### Scenario: Standard four options are parsed
- **WHEN** the options block contains lines `1:【Option A】`, `2:【Option B】`, `3:【Option C】`, `4:【Option D】`
- **THEN** the parser SHALL extract four items with text `Option A`, `Option B`, `Option C`, `Option D` respectively, with brackets removed

#### Scenario: Options with varied whitespace
- **WHEN** the options block contains `1: 【Option A】` (with extra space after colon)
- **THEN** the parser SHALL still correctly extract the option text `Option A`

### Requirement: 2×2 button grid layout
The four parsed options SHALL be rendered as a 2×2 grid of styled buttons. Options 1 and 2 SHALL appear in the first row, and options 3 and 4 in the second row.

#### Scenario: Four options render as 2×2 grid
- **WHEN** four options are parsed from the block
- **THEN** the renderer SHALL display them in a 2-column, 2-row grid layout where option 1 is top-left, option 2 is top-right, option 3 is bottom-left, and option 4 is bottom-right

### Requirement: Option button styling
Each option button SHALL be visually styled as a clickable button with clear borders, padding, and readable text. The option number SHALL be displayed alongside or within the button. The buttons SHALL have hover and active visual states.

#### Scenario: Buttons show option numbers
- **WHEN** the options panel is rendered
- **THEN** each button SHALL display its option number (1–4) along with the option text

#### Scenario: Buttons have interactive states
- **WHEN** the user hovers over an option button
- **THEN** the button SHALL visually indicate it is interactive (e.g., change background color or border)

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

### Requirement: Handling malformed options blocks
The renderer SHALL gracefully handle options blocks that contain fewer than 4 items or items that do not follow the expected format. Available items SHALL still be rendered.

#### Scenario: Options block with only 3 items
- **WHEN** the options block contains only items numbered 1 through 3
- **THEN** the renderer SHALL display the 3 available options and leave the fourth grid cell empty or hidden without causing errors

### Requirement: Plugin manifest and registration

The options-panel SHALL register itself as a full-stack plugin with the plugin system. The plugin manifest SHALL declare:
- **name**: `options-panel`
- **type**: `full-stack`
- **prompt fragment**: `options.md` — the plugin SHALL contribute its prompt fragment file via the `prompt-assembly` hook, returning `{ name: 'options-panel', content: <contents of options.md> }`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<options>` tag name, with the existing options panel renderer as the handler function
- **strip-tags hook**: The plugin SHALL declare `options` in its `promptStripTags` manifest field so that `<options>` tags are stripped from chapter content when building `previous_context` for the prompt

During plugin initialization, the options-panel plugin SHALL:
1. Register its `<options>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `options.md` prompt fragment

The existing detection, parsing, rendering, click behavior, event delegation, escapeHtml, and malformed-handling requirements remain unchanged — they are now invoked through the plugin system's `frontend-render` hook rather than hardcoded pipeline calls.

#### Scenario: Options-panel registers as a full-stack plugin
- **WHEN** the plugin system initializes the options-panel plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<options>` tag handler with the md-renderer, and register a `prompt-assembly` handler for `options.md`

#### Scenario: Options-panel prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the options-panel plugin SHALL return `{ name: 'options-panel', content: <options.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Options tag rendered via plugin system
- **WHEN** the md-renderer encounters an `<options>` block during XML extraction
- **THEN** the block SHALL be passed to the options-panel plugin's registered renderer, producing the same 2×2 button grid output as before

#### Scenario: Options tag stripped from previous context
- **WHEN** chapter content is processed for `previous_context` and contains `<options>...</options>` blocks
- **THEN** those blocks SHALL be stripped because the options-panel plugin declares `options` in its `promptStripTags` manifest field
