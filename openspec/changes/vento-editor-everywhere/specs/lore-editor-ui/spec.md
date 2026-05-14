## MODIFIED Requirements

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
