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
The parsed status data SHALL be rendered by a `StatusBar.vue` component that accepts typed props (e.g., `basicInfo: StatusBasicInfo`, `outfit: StatusOutfit | null`, `closeUps: StatusCloseUp[]`). On desktop viewports (min-width 768px), sidebar placement SHALL be handled by Vue's `<Teleport to="#sidebar">` or by the parent layout component's template structure, replacing the former JavaScript DOM manipulation that moved the panel between `#content` and `#sidebar`. On mobile viewports (below 768px), the panel SHALL remain inline within the content flow. The panel SHALL display the character name and title prominently. The scene description, inner thought, and inventory SHALL be visible.

#### Scenario: Status panel displays character identity
- **WHEN** the `StatusBar.vue` component receives valid `basicInfo` props
- **THEN** the rendered panel SHALL show the character name as a heading or prominent label and the title directly associated with the name

#### Scenario: Status panel in sidebar on desktop
- **WHEN** the status block is parsed and the viewport width is 768px or greater
- **THEN** the `StatusBar.vue` component SHALL be rendered in the sidebar via Vue's `<Teleport>` or parent layout, displayed in a separate column to the right of the story content

#### Scenario: Status panel is inline on mobile
- **WHEN** the status block is parsed and the viewport width is below 768px
- **THEN** the `StatusBar.vue` component SHALL render inline within the content flow without teleportation

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
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<status>` tag name. In the Vue architecture, the handler SHALL invoke the TypeScript parser utility and return rendered HTML (or delegate to the `StatusBar.vue` component's rendering logic).
- **post-response hook**: The plugin SHALL register a `post-response` hook handler that invokes the `state-patches` binary.

During plugin initialization, the `status` plugin SHALL:
1. Register its `<status>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `status.md` prompt fragment
3. Register a `post-response` hook handler that executes the state-patches binary

#### Scenario: Status plugin registers as a full-stack plugin
- **WHEN** the plugin system initializes the `status` plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<status>` tag handler, register a `prompt-assembly` handler for `status.md`, and register a `post-response` hook handler

#### Scenario: Status plugin prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the `status` plugin SHALL return `{ name: 'status', content: <status.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Status tag rendered via plugin system
- **WHEN** the md-renderer encounters a `<status>` block during XML extraction
- **THEN** the block SHALL be passed to the `status` plugin's registered renderer, which SHALL use the TypeScript parser and produce the styled status panel output

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
The status bar parser SHALL define and export TypeScript interfaces for all parsed data: `StatusBasicInfo` (name, title, description, thought, inventory), `StatusOutfit` (clothing, footwear, legwear, accessories), `StatusCloseUp` (bodyPart, description), and `ParsedStatus` (basic, outfit, closeUps). These types SHALL be used by both the parser utility and the `StatusBar.vue` component props.

#### Scenario: Parser returns typed data
- **WHEN** the parser utility processes a status block
- **THEN** it SHALL return a `ParsedStatus` object with strongly-typed fields, usable as props for `StatusBar.vue`

### Requirement: Sidebar placement via Vue architecture
The `StatusBar.vue` component SHALL NOT perform direct DOM manipulation to move itself between `#content` and `#sidebar`. Sidebar placement SHALL be handled declaratively via Vue's `<Teleport>` directive or by the parent layout component's template conditionally rendering the component in the sidebar slot. Responsive behavior (desktop vs. mobile) SHALL be determined by a reactive viewport width ref or CSS media queries within the component's scoped styles.

#### Scenario: No imperative DOM relocation
- **WHEN** inspecting the `StatusBar.vue` component source
- **THEN** no calls to `appendChild`, `insertBefore`, `removeChild`, or other imperative DOM APIs SHALL exist for sidebar relocation; placement SHALL be declarative
