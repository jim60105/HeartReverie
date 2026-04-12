## MODIFIED Requirements

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
