# Options Panel — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

### Requirement: Options block detection and extraction
The renderer SHALL detect `<options>...</options>` blocks in the chapter content. The detection and extraction logic SHALL remain as a pure TypeScript utility function. Options blocks SHALL only be rendered on the last chapter: when the current chapter is the last chapter, the extracted block SHALL be passed to the `OptionsPanel.vue` component; when the current chapter is not the last chapter, the block SHALL be extracted but replaced with an empty placeholder (no visible output).

#### Scenario: Options block is present in last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is the last chapter
- **THEN** the block SHALL be extracted and the `OptionsPanel.vue` component SHALL render the full options display

#### Scenario: Options block is present in non-last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and the current chapter is not the last chapter
- **THEN** the block SHALL be extracted but replaced with an empty placeholder, producing no visible output

#### Scenario: No options block in chapter
- **WHEN** the chapter content does not contain an `<options>` block
- **THEN** no options panel SHALL be rendered for that chapter

### Requirement: Parsing numbered option items
The options parser SHALL be implemented as a pure TypeScript utility function that extracts exactly 4 numbered items from the block. Each item follows the format `N:【text】` or `N: 【text】` where N is 1 through 4. The parser SHALL strip the `【` and `】` bracket characters and return a typed array (e.g., `ParsedOption[]` with `number` and `text` fields).

#### Scenario: Standard four options are parsed
- **WHEN** the options block contains lines `1:【Option A】`, `2:【Option B】`, `3:【Option C】`, `4:【Option D】`
- **THEN** the parser SHALL return a typed array of four items with text `Option A`, `Option B`, `Option C`, `Option D`

#### Scenario: Options with varied whitespace
- **WHEN** the options block contains `1: 【Option A】` (with extra space after colon)
- **THEN** the parser SHALL still correctly extract the option text `Option A`

### Requirement: 2×2 button grid layout
The `OptionsPanel.vue` component SHALL render the four parsed options as a 2×2 grid of styled buttons using CSS Grid or Flexbox in scoped component styles. Options 1 and 2 SHALL appear in the first row, and options 3 and 4 in the second row.

#### Scenario: Four options render as 2×2 grid
- **WHEN** four options are passed as props to `OptionsPanel.vue`
- **THEN** the component SHALL display them in a 2-column, 2-row grid layout where option 1 is top-left, option 2 is top-right, option 3 is bottom-left, and option 4 is bottom-right

### Requirement: Option button styling
Each option button within `OptionsPanel.vue` SHALL be visually styled as a clickable button with clear borders, padding, and readable text via scoped component styles. The option number SHALL be displayed alongside or within the button. The buttons SHALL have hover and active visual states.

#### Scenario: Buttons show option numbers
- **WHEN** the `OptionsPanel.vue` component is rendered
- **THEN** each button SHALL display its option number (1–4) along with the option text

#### Scenario: Buttons have interactive states
- **WHEN** the user hovers over an option button
- **THEN** the button SHALL visually indicate it is interactive (e.g., change background color or border)

### Requirement: Option button click behavior

Clicking an option button within `OptionsPanel.vue` SHALL copy the option text to the clipboard AND append the option text to the chat input. The component SHALL emit an event (e.g., `optionSelected`) with the option text, and the parent component SHALL use Vue's `provide`/`inject` pattern or a template ref to call the chat input's `appendText()` method. A brief visual feedback SHALL confirm the copy action. The former `window.__appendToInput` global bridge and direct module import of `appendToInput` SHALL both be eliminated in favor of the Vue component communication pattern.

#### Scenario: Clicking an option copies text to clipboard and appends to input
- **WHEN** the user clicks on option button 2 with text `走向藥妝店，想看看有沒有新出的商品`
- **THEN** the text SHALL be copied to the system clipboard, the component SHALL emit an `optionSelected` event, and the parent SHALL append the text to the chat input via Vue's component communication

#### Scenario: Clicking an option when chat input has existing content
- **WHEN** the chat textarea contains `先回家` and the user clicks an option with text `走向藥妝店`
- **THEN** the parent SHALL call the chat input's `appendText()`, resulting in `先回家\n走向藥妝店`, and the text `走向藥妝店` SHALL be copied to the clipboard

#### Scenario: Chat input component not available
- **WHEN** the chat input component is not mounted and the user clicks an option button
- **THEN** the clipboard copy SHALL still succeed and the missing component SHALL NOT cause an error

### Requirement: Option button click uses scoped event handling

The `OptionsPanel.vue` component SHALL use Vue's `@click` event bindings directly on each option button element within the component template. The former global event delegation pattern (attaching a listener to `#content`) SHALL be eliminated. No inline `onclick` attributes SHALL be used. CSP compliance is maintained because Vue's template event bindings compile to `addEventListener` calls, not inline handlers.

#### Scenario: Click on option button handled within component
- **WHEN** the user clicks on an option button inside the `OptionsPanel.vue` component
- **THEN** the component's `@click` handler on that button SHALL execute, copying the option text to the clipboard and emitting the `optionSelected` event

#### Scenario: No global event listener registered
- **WHEN** the `OptionsPanel.vue` component is mounted
- **THEN** no event listener SHALL be registered on `#content`, `document`, or any element outside the component's own template

#### Scenario: No inline onclick in rendered HTML
- **WHEN** the options panel HTML is rendered
- **THEN** the output SHALL NOT contain any `onclick` attributes on button elements

### Requirement: Shared escapeHtml utility

The options panel SHALL import `escapeHtml()` from a shared TypeScript utility module instead of defining its own local copy. The shared `escapeHtml()` function SHALL escape `&`, `<`, `>`, `"`, and `'` (single-quote → `&#39;`) to prevent attribute breakout XSS. The function SHALL have a TypeScript signature `escapeHtml(str: string): string`.

#### Scenario: Single-quote is escaped
- **WHEN** option text contains a single quote (e.g., `it's a test`)
- **THEN** `escapeHtml()` SHALL return `it&#39;s a test`

#### Scenario: All HTML special characters are escaped
- **WHEN** option text contains `<script>alert("xss")&'`
- **THEN** `escapeHtml()` SHALL return `&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;`

### Requirement: Handling malformed options blocks
The `OptionsPanel.vue` component SHALL gracefully handle options data with fewer than 4 items. Available items SHALL still be rendered in the grid. The component SHALL accept a typed prop (e.g., `options: ParsedOption[]`) and render only the items present.

#### Scenario: Options block with only 3 items
- **WHEN** the component receives only 3 parsed options
- **THEN** the component SHALL display the 3 available options and leave the fourth grid cell empty or hidden without causing errors

### Requirement: Plugin manifest and registration

The options-panel component's corresponding plugin SHALL use the existing plugin directory `plugins/options/` and its manifest. The plugin manifest SHALL declare:
- **name**: `options`
- **type**: `full-stack`
- **prompt fragment**: `options.md`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<options>` tag name. In the Vue architecture, the handler SHALL invoke the TypeScript parser utility and return rendered HTML (or delegate rendering to the `OptionsPanel.vue` component).
- **strip-tags hook**: The plugin SHALL declare `options` in its `promptStripTags` manifest field.

During plugin initialization, the `options` plugin SHALL:
1. Register its `<options>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `options.md` prompt fragment

#### Scenario: Options plugin registers as a full-stack plugin
- **WHEN** the plugin system initializes the `options` plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<options>` tag handler, and register a `prompt-assembly` handler for `options.md`

#### Scenario: Options plugin prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the `options` plugin SHALL return `{ name: 'options', content: <options.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Options tag rendered via plugin system
- **WHEN** the md-renderer encounters an `<options>` block during XML extraction
- **THEN** the block SHALL be passed to the `options` plugin's registered renderer, which SHALL use the TypeScript parser and produce the 2×2 button grid output

#### Scenario: Options tag stripped from previous context
- **WHEN** chapter content is processed for `previous_context` and contains `<options>...</options>` blocks
- **THEN** those blocks SHALL be stripped because the `options` plugin declares `options` in its `promptStripTags` manifest field

## ADDED Requirements

### Requirement: Typed parser interface
The options parser SHALL define and export a TypeScript interface `ParsedOption` with fields `number: number` and `text: string`. The parser function SHALL have the signature `parseOptions(block: string): ParsedOption[]`. The `OptionsPanel.vue` component SHALL accept `options: ParsedOption[]` as a typed prop.

#### Scenario: Parser returns typed array
- **WHEN** the parser processes an options block
- **THEN** it SHALL return a `ParsedOption[]` array usable directly as a prop for `OptionsPanel.vue`

### Requirement: Component emits typed events
The `OptionsPanel.vue` component SHALL define typed emits using `defineEmits<{ optionSelected: [text: string] }>()`. Parent components SHALL listen for this event to coordinate clipboard copy and chat input append actions.

#### Scenario: Parent handles option selection
- **WHEN** the user clicks an option button
- **THEN** the component SHALL emit a typed `optionSelected` event with the option text string, and the parent SHALL handle clipboard and chat input integration
