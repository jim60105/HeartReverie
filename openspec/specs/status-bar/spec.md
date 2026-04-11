# Status Bar

## Purpose

Detects, parses, and renders `<status>` blocks from chapter content into a styled character status panel with sections for basic info (基礎), outfit (服飾), and close-up details (特寫), featuring collapsible sections and graceful handling of partial data.

## Requirements

### Requirement: Status block detection and extraction
The renderer SHALL detect `<status>...</status>` blocks in the chapter content using a regex or parser. The entire block from opening to closing tag SHALL be extracted for structured parsing.

#### Scenario: Status block is present in chapter
- **WHEN** the chapter content contains a `<status>...</status>` block
- **THEN** the block SHALL be extracted and passed to the status bar renderer for structured parsing

#### Scenario: No status block in chapter
- **WHEN** the chapter content does not contain a `<status>` block
- **THEN** no status bar SHALL be rendered and the chapter SHALL display without a status panel

### Requirement: Parsing the 基礎 (basic) section
The status bar parser SHALL extract the `基礎:` section which contains a single pipe-delimited line in brackets: `[Name|Title|Description|Thought|Inventory]`. The parser SHALL extract the character name (first field), title (second field), scene description (third field), inner thought (fourth field), and inventory list (fifth field).

#### Scenario: Full 基礎 section is parsed
- **WHEN** the status block contains `基礎:\n[蘭堂悠奈|放學後在商店街閒逛的優等生|午後的陽光...|被人認出來...|書包、手機]`
- **THEN** the parser SHALL extract name as `蘭堂悠奈`, title as `放學後在商店街閒逛的優等生`, description as `午後的陽光...`, thought as `被人認出來...`, and inventory as `書包、手機`

### Requirement: Parsing the 服飾 (outfit) section
The status bar parser SHALL extract the `服飾:` section which contains a single pipe-delimited line in brackets: `[Clothing|Footwear|Legwear|Accessories]`. Each field represents a category of worn items.

#### Scenario: Full 服飾 section is parsed
- **WHEN** the status block contains `服飾:\n[深藍色西式制服(外套+襯衫+短裙)|黑色皮鞋|白色短襪|無]`
- **THEN** the parser SHALL extract clothing as `深藍色西式制服(外套+襯衫+短裙)`, footwear as `黑色皮鞋`, legwear as `白色短襪`, and accessories as `無`

### Requirement: Parsing the 特寫 (close-up) section
The status bar parser SHALL extract the `特寫:` section which contains one or more lines, each in brackets with pipe-delimited fields: `[BodyPart|Description]`. Each line represents a close-up detail of a body part.

#### Scenario: Multiple close-up entries are parsed
- **WHEN** the status block contains multiple close-up lines `[雙手|手指修長白皙...]` and `[頸部|制服領口扣到最上一顆...]`
- **THEN** the parser SHALL extract each entry as a body-part/description pair and present them in order

### Requirement: Styled status panel rendering
The parsed status data SHALL be rendered as a styled HTML panel with the CSS class `status-float`. On desktop viewports (min-width 768px), JavaScript SHALL move the panel from `#content` to the `#sidebar` element, placing it in a separate right column alongside the story content. The sidebar SHALL use `position: sticky` to keep the panel visible while scrolling. On mobile viewports (below 768px), the panel SHALL remain inline within the content flow. The panel SHALL display the character name and title prominently. The scene description and inner thought SHALL be visible. The inventory SHALL be listed.

#### Scenario: Status panel displays character identity
- **WHEN** the status block is parsed successfully
- **THEN** the rendered panel SHALL show the character name as a heading or prominent label and the title directly associated with the name

#### Scenario: Status panel in sidebar on desktop
- **WHEN** the status block is parsed and the viewport width is 768px or greater
- **THEN** the rendered panel SHALL be moved to the `#sidebar` element, displayed in a separate column to the right of the story content

#### Scenario: Status panel is inline on mobile
- **WHEN** the status block is parsed and the viewport width is below 768px
- **THEN** the rendered panel SHALL appear inline within the content flow

### Requirement: Collapsible sections for outfit and close-up
The 服飾 (outfit) and 特寫 (close-up) sections SHALL be rendered as collapsible sections (e.g., using `<details>/<summary>` elements) so that users can expand or collapse them. The `<details>` elements SHALL include the `open` attribute by default so that sections are expanded on initial render. Users can still collapse them manually.

#### Scenario: Outfit section is collapsible and expanded by default
- **WHEN** the status panel is rendered with a 服飾 section
- **THEN** the outfit details SHALL be inside a collapsible `<details>` element with a summary label indicating the section (e.g., `穿着`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: Close-up section is collapsible and expanded by default
- **WHEN** the status panel is rendered with a 特寫 section
- **THEN** the close-up details SHALL be inside a collapsible `<details>` element with a summary label indicating the section (e.g., `特寫`) and SHALL default to expanded (the `open` attribute SHALL be present)

#### Scenario: User can manually collapse expanded sections
- **WHEN** a `<details>` section is rendered with the `open` attribute
- **THEN** the user SHALL be able to click the `<summary>` element to collapse the section, and click again to re-expand it

### Requirement: Handling partial or missing sections
The status bar renderer SHALL gracefully handle status blocks where one or more sections (基礎, 服飾, 特寫) are missing. Only the present sections SHALL be rendered.

#### Scenario: Status block with only 基礎 section
- **WHEN** the status block contains only a `基礎:` section and no `服飾:` or `特寫:` sections
- **THEN** the panel SHALL render the basic character info and omit the outfit and close-up collapsible sections without errors

#### Scenario: Status block with empty fields
- **WHEN** a pipe-delimited field within a section is empty (e.g., `[Name||Description||]`)
- **THEN** the renderer SHALL display the present fields and leave empty fields blank or omit them gracefully

### Requirement: Plugin manifest and registration

The status-bar SHALL register itself as a full-stack plugin with the plugin system. The plugin manifest SHALL declare:
- **name**: `status-bar`
- **type**: `full-stack`
- **prompt fragment**: `status.md` — the plugin SHALL contribute its prompt fragment file via the `prompt-assembly` hook, returning `{ name: 'status-bar', content: <contents of status.md> }`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<status>` tag name, with the existing status bar renderer as the handler function
- **post-response hook**: The plugin SHALL register a `post-response` hook handler that invokes the `apply-patches` binary after each completed AI response (replacing the hardcoded invocation in `server.js`)

During plugin initialization, the status-bar plugin SHALL:
1. Register its `<status>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `status.md` prompt fragment
3. Register a `post-response` hook handler that executes `./plugins/apply-patches/rust/target/release/apply-patches playground` via `execFile`

The existing detection, parsing, rendering, collapsible sections, and partial data handling requirements remain unchanged — they are now invoked through the plugin system's `frontend-render` hook rather than hardcoded pipeline calls.

#### Scenario: Status-bar registers as a full-stack plugin
- **WHEN** the plugin system initializes the status-bar plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<status>` tag handler with the md-renderer, register a `prompt-assembly` handler for `status.md`, and register a `post-response` hook handler for apply-patches execution

#### Scenario: Status-bar prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the status-bar plugin SHALL return `{ name: 'status-bar', content: <status.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Status tag rendered via plugin system
- **WHEN** the md-renderer encounters a `<status>` block during XML extraction
- **THEN** the block SHALL be passed to the status-bar plugin's registered renderer, producing the same styled status panel output as before

### Requirement: Post-response hook for apply-patches

The status-bar plugin SHALL register a `post-response` hook handler that replaces the hardcoded `apply-patches` invocation previously in `server.js`. After each completed AI response, the hook system SHALL invoke registered `post-response` handlers in priority order. The status-bar plugin's handler SHALL execute `./plugins/apply-patches/rust/target/release/apply-patches playground` using `execFile` (not `exec`). The handler SHALL await completion before the hook chain continues. If the command exits with a non-zero status code or writes to stderr, the handler SHALL log a warning but SHALL NOT fail the hook chain or the HTTP response. If the `apply-patches` binary is not found, the handler SHALL log a warning and return without error.

The same `execFile` safety requirements from the `post-response-patch` spec apply: the command SHALL be invoked with explicit arguments (not shell string) to prevent command injection, and no user-supplied input SHALL be interpolated into the command or its arguments.

#### Scenario: Post-response hook triggers apply-patches
- **WHEN** the AI response stream completes and the `post-response` hook stage is invoked
- **THEN** the status-bar plugin's hook handler SHALL execute `execFile('./plugins/apply-patches/rust/target/release/apply-patches', ['playground'])` and await its completion

#### Scenario: Apply-patches failure in hook does not fail response
- **WHEN** the `apply-patches` command exits with a non-zero exit code during the post-response hook
- **THEN** the handler SHALL log a warning but SHALL NOT prevent the HTTP response from being returned with the chapter content

#### Scenario: Apply-patches binary not found in hook
- **WHEN** the `apply-patches` binary does not exist at the expected path during the post-response hook
- **THEN** the handler SHALL log a warning and return without error, allowing the hook chain and HTTP response to proceed normally
