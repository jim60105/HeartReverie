# Status Bar

## Purpose

Detects, parses, and renders `<status>` blocks from chapter content into a styled character status panel with sections for basic info (基礎), outfit (服飾), and close-up details (特寫), featuring collapsible sections and graceful handling of partial data.

## Requirements

### Requirement: Status block detection and extraction
The renderer SHALL detect `<status>...</status>` blocks in the chapter content using a regex or parser. The entire block from opening to closing tag SHALL be extracted for structured parsing. The detection and extraction logic SHALL remain as a pure TypeScript utility function.

#### Scenario: Status block is present in chapter
- **WHEN** the chapter content contains a `<status>...</status>` block
- **THEN** the block SHALL be extracted and passed to the `StatusBar.vue` component for structured rendering

#### Scenario: No status block in chapter
- **WHEN** the chapter content does not contain a `<status>` block
- **THEN** no status panel SHALL be rendered and the chapter SHALL display without a status panel

### Requirement: Parsing the 基礎 (basic) section
The status bar parser SHALL be implemented as a pure TypeScript utility function that extracts the `基礎:` section containing a single pipe-delimited line in brackets: `[Name|Title|Description|Thought|Inventory]`. The parser SHALL return a typed interface (e.g., `StatusBasicInfo`) with fields for name, title, description, thought, and inventory.

#### Scenario: Full 基礎 section is parsed
- **WHEN** the status block contains `基礎:\n[蘭堂悠奈|放學後在商店街閒逛的優等生|午後的陽光...|被人認出來...|書包、手機]`
- **THEN** the parser SHALL return a typed object with name `蘭堂悠奈`, title `放學後在商店街閒逛的優等生`, description `午後的陽光...`, thought `被人認出來...`, and inventory `書包、手機`

### Requirement: Parsing the 服飾 (outfit) section
The status bar parser SHALL extract the `服飾:` section as a pure TypeScript utility function, returning a typed interface (e.g., `StatusOutfit`) with fields for clothing, footwear, legwear, and accessories.

#### Scenario: Full 服飾 section is parsed
- **WHEN** the status block contains `服飾:\n[深藍色西式制服(外套+襯衫+短裙)|黑色皮鞋|白色短襪|無]`
- **THEN** the parser SHALL return a typed object with clothing `深藍色西式制服(外套+襯衫+短裙)`, footwear `黑色皮鞋`, legwear `白色短襪`, and accessories `無`

### Requirement: Parsing the 特寫 (close-up) section
The status bar parser SHALL extract the `特寫:` section as a pure TypeScript utility function, returning an array of typed objects (e.g., `StatusCloseUp[]`) with body part and description fields.

#### Scenario: Multiple close-up entries are parsed
- **WHEN** the status block contains multiple close-up lines `[雙手|手指修長白皙...]` and `[頸部|制服領口扣到最上一顆...]`
- **THEN** the parser SHALL return an array of typed objects, each with bodyPart and description fields, in order

### Requirement: Styled status panel rendering
The parsed status data SHALL be rendered by the status plugin's `frontend.js` module as an HTML string during `frontend-render` hook dispatch. The plugin handler SHALL invoke its parser function, produce themed HTML, and store the result in `context.placeholderMap`. The main project SHALL NOT contain a `StatusBar.vue` component — all status parsing and rendering logic resides within `plugins/status/frontend.js`. On desktop viewports (min-width 768px), sidebar placement SHALL be handled by `ContentArea.vue`'s `watchPostEffect` which queries elements with the `.plugin-sidebar` CSS class and relocates them to the sidebar DOM node. The status plugin's rendered HTML SHALL include the `.plugin-sidebar` class on its root element to opt into this mechanism. On mobile viewports (below 768px), CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout, causing it to flow below the chapter content. The panel SHALL display the character name and title prominently. The scene description, inner thought, and inventory SHALL be visible.

#### Scenario: Status panel displays character identity
- **WHEN** the status plugin's `frontend-render` handler produces HTML for a `<status>` block
- **THEN** the rendered HTML SHALL show the character name as a heading or prominent label and the title directly associated with the name

#### Scenario: Status panel in sidebar on desktop
- **WHEN** the status plugin renders a panel with the `.plugin-sidebar` class and the viewport width is 768px or greater
- **THEN** `ContentArea.vue`'s `watchPostEffect` SHALL relocate the element to the sidebar DOM node, displaying it in a separate column to the right of the story content

#### Scenario: Status panel flows below content on mobile
- **WHEN** the status plugin renders a panel and the viewport width is below 768px
- **THEN** the panel SHALL still be relocated to the sidebar DOM node, but CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout so it flows below the chapter content

### Requirement: Collapsible sections for outfit and close-up
The 服飾 (outfit) and 特寫 (close-up) sections within `StatusBar.vue` SHALL be rendered as collapsible sections (e.g., using native `<details>/<summary>` elements or a Vue collapsible component). The sections SHALL include the `open` attribute by default so that sections are expanded on initial render. Users can still collapse them manually.

#### Scenario: Outfit section is collapsible and expanded by default
- **WHEN** the `StatusBar.vue` component renders with an outfit prop
- **THEN** the outfit details SHALL be inside a collapsible `<details>` element with a summary label (e.g., `穿着`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: Close-up section is collapsible and expanded by default
- **WHEN** the `StatusBar.vue` component renders with close-up props
- **THEN** the close-up details SHALL be inside a collapsible `<details>` element with a summary label (e.g., `特寫`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: User can manually collapse expanded sections
- **WHEN** a `<details>` section is rendered with the `open` attribute
- **THEN** the user SHALL be able to click the `<summary>` element to collapse the section, and click again to re-expand it

### Requirement: Handling partial or missing sections
The `StatusBar.vue` component SHALL gracefully handle status data where one or more sections (基礎, 服飾, 特寫) are missing via optional/nullable props. Only the present sections SHALL be rendered.

#### Scenario: Status block with only 基礎 section
- **WHEN** the `StatusBar.vue` component receives `basicInfo` but `outfit` is `null` and `closeUps` is empty
- **THEN** the panel SHALL render the basic character info and omit the outfit and close-up collapsible sections without errors

#### Scenario: Status block with empty fields
- **WHEN** a pipe-delimited field within a section is empty (e.g., `[Name||Description||]`)
- **THEN** the parser SHALL return empty strings for those fields and the component SHALL display present fields and leave empty fields blank or omit them gracefully

### Requirement: Plugin manifest and registration

The status-bar component's corresponding plugin SHALL use the existing plugin directory `plugins/status/` and its manifest. The plugin manifest SHALL declare:
- **name**: `status`
- **type**: `full-stack`
- **prompt fragment**: `status.md`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<status>` tag name. The handler SHALL extract `<status>` blocks from `context.text`, parse the block content, render themed HTML, and store the result in `context.placeholderMap`. All extraction, parsing, and rendering logic SHALL reside within `plugins/status/frontend.js`.
- **post-response hook**: The plugin SHALL register a `post-response` hook handler that invokes the `state-patches` binary.

During plugin initialization, the `status` plugin SHALL:
1. Register its `frontend-render` handler that extracts `<status>` blocks from `context.text`, parses them, renders HTML, and adds entries to `context.placeholderMap`
2. Register a `prompt-assembly` hook handler that reads and returns the `status.md` prompt fragment
3. Register a `post-response` hook handler that executes the state-patches binary

#### Scenario: Status plugin registers as a full-stack plugin
- **WHEN** the plugin system initializes the `status` plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `frontend-render` handler, register a `prompt-assembly` handler for `status.md`, and register a `post-response` hook handler

#### Scenario: Status plugin prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the `status` plugin SHALL return `{ name: 'status', content: <status.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Status tag rendered via plugin system
- **WHEN** the `frontend-render` hook is dispatched and `context.text` contains `<status>` blocks
- **THEN** the status plugin's handler SHALL extract the blocks, replace them with placeholder comments in `context.text`, and add `placeholder → renderedHTML` entries to `context.placeholderMap`

### Requirement: Post-response hook for state-patches

The `status` plugin SHALL register a `post-response` hook handler that replaces the hardcoded `state-patches` invocation. After each completed AI response, the hook system SHALL invoke registered `post-response` handlers in priority order. The handler SHALL execute the state-patches binary using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response. If the binary is not found, the handler SHALL log a warning and return without error.

The command SHALL be invoked with explicit arguments (not shell string) to prevent command injection, and no user-supplied input SHALL be interpolated into the command or its arguments.

#### Scenario: Post-response hook triggers state-patches
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the `status` plugin's hook handler SHALL execute the state-patches binary with explicit arguments and await its completion

#### Scenario: Apply-patches failure in hook does not fail response
- **WHEN** the `state-patches` command exits with a non-zero exit code during the post-response hook
- **THEN** the handler SHALL log a warning but SHALL NOT prevent the HTTP response from being returned

#### Scenario: Apply-patches binary not found in hook
- **WHEN** the `state-patches` binary does not exist at the expected path during the post-response hook
- **THEN** the handler SHALL log a warning and return without error, allowing the hook chain and HTTP response to proceed normally

### Requirement: Typed parser interfaces
The status bar parser SHALL define typed data structures for all parsed data: basic info (name, title, scene, thought, items), outfit (clothes, shoes, socks, accessories), and close-ups (part, description). These types reside within the plugin's code (`plugins/status/frontend.js`). The main project's `reader-src/src/types/index.ts` SHALL NOT contain plugin-specific type interfaces such as `StatusBarProps`, `CloseUpEntry`, or `ParsedStatus`.

#### Scenario: Parser returns structured data within the plugin
- **WHEN** the status plugin's parser processes a status block
- **THEN** it SHALL return a structured object with the parsed fields, used internally by the plugin's renderer to produce HTML

### Requirement: Sidebar placement via Vue architecture
The sidebar placement mechanism SHALL use a generic `.plugin-sidebar` CSS class convention. `ContentArea.vue` SHALL use a `watchPostEffect` to query all elements matching `.plugin-sidebar` within the content wrapper and relocate them to the sidebar DOM node via `appendChild`. This imperative DOM relocation is appropriate because plugin-rendered HTML arrives as raw strings via `v-html` — Vue's `<Teleport>` directive cannot be used since plugin content is not a Vue component. The `.plugin-sidebar` class is a convention any plugin can adopt. No plugin-specific class names (such as `.status-float`) SHALL be hardcoded in the main project's component code.

#### Scenario: Generic sidebar relocation
- **WHEN** any plugin renders HTML containing an element with the `.plugin-sidebar` class
- **THEN** `ContentArea.vue`'s `watchPostEffect` SHALL relocate that element to the sidebar, regardless of which plugin produced it

#### Scenario: No plugin-specific class names in main project
- **WHEN** inspecting `ContentArea.vue` source
- **THEN** no plugin-specific CSS class names (such as `.status-float`) SHALL appear in querySelector calls; only the generic `.plugin-sidebar` class SHALL be used
