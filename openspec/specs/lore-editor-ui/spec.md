# Lore Editor UI Specification

## Purpose

The Lore Editor UI provides a Vue 3 frontend interface for browsing, filtering, and editing lore passages within the HeartReverie interactive fiction engine. This component integrates with the core lore codex system and provides a user-friendly interface for managing narrative knowledge base entries organized by scope (global, series, story).
## Requirements
### Requirement: Passage Browser Display
The system SHALL display a browsable list of lore passages with their metadata including scope, tags, priority level, and enabled status.

#### Scenario: Display passage list with metadata
- **WHEN** user navigates to the lore browser view
- **THEN** the system displays all accessible passages showing filename, scope (global/series/story), tags as clickable badges, priority number, and enabled toggle status

#### Scenario: Empty state handling
- **WHEN** user navigates to lore browser and no passages exist in the selected scope
- **THEN** the system displays a helpful empty state message with an option to create the first passage

### Requirement: Tag-Based Filtering
The system SHALL provide interactive tag-based filtering to allow users to narrow down passages by their associated tags.

#### Scenario: Filter passages by clicking tag
- **WHEN** user clicks on a tag badge displayed on any passage card
- **THEN** the system filters the passage list to show only passages containing that tag and highlights the active filter

#### Scenario: Clear tag filters
- **WHEN** user has applied tag filters and clicks a clear filters button
- **THEN** the system removes all active filters and displays the complete passage list for the current scope

### Requirement: Scope Navigation
The system SHALL provide navigation between different lore scopes (global, series, story) with dynamic population based on the current story context.

#### Scenario: Switch between scope tabs
- **WHEN** user clicks on a different scope tab (global/series/story)
- **THEN** the system loads and displays passages from that scope, updating the URL route and maintaining any applied filters within the new scope

#### Scenario: Dynamic scope population
- **WHEN** user is working within a specific story context
- **THEN** the system populates series and story scope tabs with passages relevant to the current story's series and story ID

### Requirement: Passage Editor Interface

The system SHALL provide an editor interface for modifying passage frontmatter fields and Markdown / Vento content with real-time linting. The passage content field SHALL be an instance of the shared `VentoCodeEditor.vue` component (the same component used by `/settings/template-editor` and `/settings/prompt-editor`) — a plain `<textarea>` SHALL NOT be used for the content field. The editor SHALL request lint diagnostics via the source-form lint request `{ kind: "lore", scope, series?, story?, source }` (where `scope` is `global` / `series` / `story` per the loaded record). The editor SHALL receive its variable catalog from `GET /api/templates/variables?kind=lore&series=...&story=...` so the catalog matches the runtime lore render order: `lore_*` keys from `resolveLoreVariables()`, `series_name`, `story_name`, and nothing else (no plugin variables, no `user_input`). Diagnostics surface CodeMirror lint markers for `vento.unknown-variable`, `vento.parse-error`, `vento.message-nested`, and any other rule the backend emits for the `lore` kind. Frontmatter fields (tags, priority, enabled toggle) keep their existing input controls and SHALL NOT be wrapped in the Vento editor. For an unsaved new passage (no filename yet), the editor SHALL skip lint requests entirely (no spurious "missing path" diagnostics) until the user enters a valid filename; autocomplete and syntax highlighting remain active during this time.

#### Scenario: Edit passage frontmatter and Vento content

- **WHEN** user clicks on a passage card to open the editor
- **THEN** the system SHALL display editable frontmatter fields for tags (with autocomplete), priority (numeric input), and enabled status (toggle)
- **AND** the passage content area SHALL be rendered by the shared `VentoCodeEditor.vue` component bound to the passage's content string
- **AND** the editor SHALL apply Vento syntax highlighting and theme-tokenised gutter colours consistent with the Template Editor

#### Scenario: Content editor flags unknown lore variables

- **GIVEN** the current story does NOT have lore passages tagged `weapon`
- **WHEN** the user types `{{ lore_weapon }}` into the lore content editor
- **THEN** the editor SHALL surface a CodeMirror lint diagnostic with the `vento.unknown-variable` rule pointing at `lore_weapon`

#### Scenario: Content editor recognises resolved lore tags

- **GIVEN** the resolved lore tags for the current story include `character` and `scenario`
- **WHEN** the user types `{{ lore_character }}` into the lore content editor
- **THEN** no `vento.unknown-variable` diagnostic SHALL be emitted for `lore_character`

#### Scenario: Plugin-only variables are unknown in lore scope

- **GIVEN** a plugin declares a `think_before_reply` fragment variable
- **WHEN** the user types `{{ think_before_reply }}` or `{{ user_input }}` into the lore content editor
- **THEN** the editor SHALL surface a `vento.unknown-variable` diagnostic for each name (because these are NOT in the lore catalog)

#### Scenario: Unsaved new passage skips lint network calls

- **WHEN** the user clicks "Create new passage" and the editor mounts with `filename = ""`
- **THEN** no `POST /api/templates/lint` request SHALL be issued
- **AND** the editor still applies syntax highlighting and autocomplete from the cached lore catalog

#### Scenario: Validate frontmatter input

- **WHEN** user enters invalid data in frontmatter fields (e.g., non-numeric priority, malformed tags)
- **THEN** the system displays validation errors and prevents saving until all fields contain valid data

#### Scenario: Content editor exposes save button behaviour unchanged

- **WHEN** the user edits the lore content via the Vento editor and clicks the existing "儲存" button
- **THEN** the save flow SHALL behave exactly as it did with the prior textarea — `PUT /api/lore/{scope-prefix}/{path}` is called with the new content and the same success / failure surface

### Requirement: CRUD Operations
The system SHALL support creating new passages, saving changes to existing passages, and deleting passages through API calls to the backend lore-codex endpoints.

#### Scenario: Create new passage
- **WHEN** user clicks "Create New Passage" button and fills in required fields (filename, scope, content)
- **THEN** the system calls PUT /api/lore/{scope-prefix}/{filename} to create the passage and updates the browser list with the new entry

#### Scenario: Save passage changes
- **WHEN** user modifies a passage and clicks the save button
- **THEN** the system calls PUT /api/lore/{scope-prefix}/{path} with the updated content and frontmatter, showing success confirmation

#### Scenario: Delete passage with confirmation
- **WHEN** user clicks delete button on a passage
- **THEN** the system displays a confirmation dialog and, upon confirmation, calls DELETE /api/lore/{scope-prefix}/{path} and removes the passage from the browser list

### Requirement: Responsive Layout Design
The system SHALL provide a responsive user interface that adapts to different viewport sizes and maintains usability on both desktop and mobile devices.

#### Scenario: Desktop layout optimization
- **WHEN** user accesses the lore editor on a desktop viewport (>768px width)
- **THEN** the system displays passage cards in a multi-column grid with sidebar navigation and full-width editor panels

#### Scenario: Mobile layout adaptation
- **WHEN** user accesses the lore editor on a mobile viewport (<768px width)
- **THEN** the system stacks passage cards in a single column, collapses navigation into a hamburger menu, and provides touch-optimized editor controls

## Implementation Notes

- Core Vue components integrated into `reader-src/src/views/` and `reader-src/src/components/lore/`
- Registered as a core route in Vue Router (not a plugin frontend module — the plugin system lacks route extension points)
- UI text in Traditional Chinese (zh-TW) following project conventions
- Utilizes Tailwind CSS classes consistent with the existing frontend styling
- Built through Vite pipeline to `reader-dist/` directory
