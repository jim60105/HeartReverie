## MODIFIED Requirements

### Requirement: Options block detection and extraction
The renderer SHALL detect `<options>...</options>` blocks in the chapter content. The detection and extraction logic SHALL reside within the options plugin's `frontend.js` module, invoked during `frontend-render` hook dispatch. The main project SHALL NOT contain a separate options parser or extractor in `reader-src/`. Options blocks SHALL only be rendered on the last chapter: the plugin handler SHALL check `context.options.isLastChapter` — when true, the extracted block SHALL be rendered as HTML; when false, the block SHALL be extracted but replaced with an empty placeholder (no visible output).

#### Scenario: Options block is present in last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and `context.options.isLastChapter` is true
- **THEN** the plugin handler SHALL extract the block, render the full options display as HTML, and store it in `context.placeholderMap`

#### Scenario: Options block is present in non-last chapter
- **WHEN** the chapter content contains an `<options>...</options>` block and `context.options.isLastChapter` is false
- **THEN** the plugin handler SHALL extract the block but store an empty string in `context.placeholderMap`, producing no visible output

#### Scenario: No options block in chapter
- **WHEN** the chapter content does not contain an `<options>` block
- **THEN** the plugin handler SHALL make no changes to `context.text` or `context.placeholderMap` for options

### Requirement: 2×2 button grid layout
The options plugin's `frontend.js` SHALL render the four parsed options as a 2×2 grid of styled buttons using CSS Grid classes defined in the main project's `base.css`. Options 1 and 2 SHALL appear in the first row, and options 3 and 4 in the second row. The main project SHALL NOT contain an `OptionsPanel.vue` component — all rendering logic resides within `plugins/options/frontend.js`.

#### Scenario: Four options render as 2×2 grid
- **WHEN** four options are parsed by the plugin
- **THEN** the rendered HTML SHALL display them in a 2-column, 2-row grid layout where option 1 is top-left, option 2 is top-right, option 3 is bottom-left, and option 4 is bottom-right

### Requirement: Option button click behavior

Clicking an option button SHALL copy the option text to the clipboard AND dispatch a `CustomEvent` on `document` with type `option-selected` and the option text as detail. The options plugin's `frontend.js` SHALL use global DOM event delegation (listening on `document` for clicks on `[data-option-text]` buttons) to handle clicks. The main project's `MainLayout.vue` or `ChatInput.vue` SHALL listen for the `option-selected` custom event to append text to the chat input. The main project SHALL NOT contain an `OptionsPanel.vue` component with `defineEmits<{ optionSelected }>()` — since plugin-rendered HTML is injected via `v-html`, Vue component events are not available. DOM `CustomEvent` is the correct bridge pattern.

#### Scenario: Clicking an option copies text to clipboard and dispatches event
- **WHEN** the user clicks on an option button with `data-option-text` attribute
- **THEN** the plugin's global click handler SHALL copy the text to clipboard and dispatch a `document` `CustomEvent` with type `option-selected`

#### Scenario: Chat input receives option text via CustomEvent
- **WHEN** the `option-selected` custom event is dispatched on `document`
- **THEN** the main project's chat input listener SHALL append the option text to the chat textarea

### Requirement: Plugin manifest and registration

The options-panel component's corresponding plugin SHALL use the existing plugin directory `plugins/options/` and its manifest. The plugin manifest SHALL declare:
- **name**: `options`
- **type**: `full-stack`
- **prompt fragment**: `options.md`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<options>` tag name. The handler SHALL extract `<options>` blocks from `context.text`, parse them, render HTML (or empty string for non-last chapters), and store the result in `context.placeholderMap`. All extraction, parsing, and rendering logic SHALL reside within `plugins/options/frontend.js`.
- **strip-tags hook**: The plugin SHALL declare `options` in its `promptStripTags` manifest field.

During plugin initialization, the `options` plugin SHALL:
1. Register its `frontend-render` handler that extracts `<options>` blocks, parses them, renders HTML, and adds entries to `context.placeholderMap`
2. Register a `prompt-assembly` hook handler that reads and returns the `options.md` prompt fragment

#### Scenario: Options plugin registers as a full-stack plugin
- **WHEN** the plugin system initializes the `options` plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `frontend-render` handler, and register a `prompt-assembly` handler for `options.md`

#### Scenario: Options tag rendered via plugin system
- **WHEN** the `frontend-render` hook is dispatched and `context.text` contains `<options>` blocks
- **THEN** the options plugin's handler SHALL extract the blocks, replace them with placeholder comments in `context.text`, and add `placeholder → renderedHTML` entries to `context.placeholderMap`

### Requirement: Typed parser interface
The options parser SHALL define its data structures (option number and text) within the plugin's code (`plugins/options/frontend.js`). The main project's `reader-src/src/types/index.ts` SHALL NOT contain plugin-specific type interfaces such as `ParsedOption`, `OptionItem`, `OptionsPanelProps`, or `OptionsPanelEmits`.

#### Scenario: No plugin-specific option types in main project
- **WHEN** inspecting `reader-src/src/types/index.ts`
- **THEN** no option-panel-specific interfaces (such as `OptionItem`, `OptionsPanelProps`, `OptionsPanelEmits`) SHALL be defined

### Requirement: Component emits typed events

The options plugin SHALL NOT use Vue component emits for option selection. Since plugin-rendered HTML is injected via `v-html`, Vue component features (props, emits, scoped events) are not available. The plugin SHALL use DOM `CustomEvent` dispatch on `document` as the event bridge between plugin-rendered HTML and the Vue application. The main project SHALL NOT contain an `OptionsPanel.vue` component with `defineEmits<{ optionSelected }>()`.

#### Scenario: No Vue component emits for option selection
- **WHEN** inspecting `reader-src/src/components/`
- **THEN** no `OptionsPanel.vue` component with `defineEmits` SHALL exist — option selection events are handled via DOM `CustomEvent`, not Vue emits
