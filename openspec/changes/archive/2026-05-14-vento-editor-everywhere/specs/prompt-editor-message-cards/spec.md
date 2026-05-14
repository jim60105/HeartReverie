## MODIFIED Requirements

### Requirement: Message card component UI

The frontend SHALL provide a `PromptEditorMessageCard.vue` Single File Component rendered by `PromptEditor.vue` for each card in cards mode. Each card SHALL render in a visually distinct container with:

- A header row containing a "傳送者" (Sender) label, a `<select>` element bound via `v-model` to `card.role` whose options are exactly `system | user | assistant` (option text in zh-TW: "系統" / "使用者" / "助理"; underlying value is the English keyword), and the up/down/delete action buttons aligned to the right.
- A body editor: an instance of the shared `VentoCodeEditor.vue` component (the same component used by `/settings/template-editor` and `/settings/lore`). The editor SHALL be bound such that `update:source` propagates back into `card.body`. The editor SHALL be supplied with a variable catalog computed for the `kind: "prompt-message-body"` scope (the system-prompt catalog: `previous_context`, `user_input`, `isFirstRound`, `plugin_fragments`, every plugin-fragment-declared variable). The editor SHALL request lint diagnostics via the source-form lint request `{ kind: "prompt-message-body", role: <card.role>, source: <card.body> }`, so the backend wraps the body in `{{ message "<role>" }}` … `{{ /message }}` before parsing and the resulting diagnostics include nested-message errors (`vento.message-nested`). The editor SHALL expose the CodeMirror token highlighting and the theme-tokenised gutter colours described by the `template-editor` capability. A `<textarea>` SHALL NOT be used for the body — all body editing goes through the shared `VentoCodeEditor`. The `Mod-s` save shortcut SHALL be disabled in this mount (the card uses the existing autosave debounce, no explicit save action).
- An "插入變數" (Insert variable) helper above the editor: a small dropdown/button trigger that, when activated, displays the variable list (same catalog the editor uses for autocomplete) and on selection invokes the editor's exposed `insertAtCursor("{{ <name> }}")` method. After insertion the editor SHALL retain focus and the caret SHALL be positioned immediately after the inserted text.

The component SHALL emit named events (or use `defineModel`) for: role change, body change, request-up, request-down, request-delete. The parent (`PromptEditor.vue`) maintains the `cards` array.

#### Scenario: Card renders role select with three options

- **WHEN** a `PromptEditorMessageCard` renders for a card with `role: "user"`
- **THEN** the `<select>` SHALL contain exactly three `<option>` elements with values `"system"`, `"user"`, `"assistant"` and zh-TW labels, and the `<select>`'s value SHALL be `"user"`

#### Scenario: Editing role updates the card

- **WHEN** the user changes the `<select>` from `"user"` to `"assistant"`
- **THEN** the bound `card.role` SHALL update to `"assistant"` and the parent `cards` array SHALL reflect the change

#### Scenario: Editing body updates the card

- **WHEN** the user types text into the `VentoCodeEditor` mounted as the card body
- **THEN** the editor SHALL emit `update:source` and the bound `card.body` SHALL update accordingly

#### Scenario: Body editor surfaces vento.unknown-variable warnings

- **GIVEN** the variable catalog for `kind: "prompt-message-body"` does NOT include `nonsense_var`
- **WHEN** the user types `{{ nonsense_var }}` into the card body editor
- **THEN** the editor SHALL surface a CodeMirror lint diagnostic marking `nonsense_var` with the `vento.unknown-variable` rule

#### Scenario: Body editor catches nested message tags

- **WHEN** the user types `{{ message "user" }}foo{{ /message }}` into a system-role card body
- **THEN** the backend SHALL wrap the body in `{{ message "system" }}` … `{{ /message }}` and parse the combined source
- **AND** the editor SHALL surface a `vento.message-nested` diagnostic at the offset of the user-typed `{{ message }}` token (not at the synthetic wrapper)

#### Scenario: Catalog is fetched once per page, not per card

- **GIVEN** the prompt editor renders five `PromptEditorMessageCard` instances
- **WHEN** the page mounts
- **THEN** at most one `GET /api/templates/variables?kind=prompt-message-body` request SHALL be issued for the catalog
- **AND** every card SHALL receive the same `variables` prop reference

#### Scenario: Lint defers until first user edit or focus

- **WHEN** a fresh `PromptEditorMessageCard` mounts with non-empty `card.body`
- **THEN** no `POST /api/templates/lint` request SHALL be issued until either (a) the user edits the body OR (b) the editor receives keyboard focus

#### Scenario: Body editor highlights Vento syntax

- **WHEN** the card body contains `{{ if isFirstRound }}hello{{ /if }}`
- **THEN** the rendered editor SHALL apply the `ventoHighlightStyle` mapping — `if`/`/if` resolve to the keyword colour and `isFirstRound` resolves to the variable-name colour

#### Scenario: Insert-variable helper inserts via insertAtCursor

- **WHEN** the user places the editor caret at character offset N within `card.body` and selects a variable named `user_input` from the helper
- **THEN** the helper SHALL invoke the editor's exposed `insertAtCursor("{{ user_input }}")` method
- **AND** the editor content SHALL contain `{{ user_input }}` inserted at offset N (with everything before N preserved and everything from N onward pushed right), the caret SHALL be positioned immediately after the inserted text, AND focus SHALL remain on the editor

#### Scenario: Mod-s does NOT trigger inside the card body editor

- **WHEN** the editor has keyboard focus
- **AND** the user presses `Ctrl+S` (or `Cmd+S` on macOS)
- **THEN** the editor SHALL NOT emit `save-request` (since `enableSaveShortcut` is `false` for this mount)
- **AND** the browser's default `Ctrl+S` behaviour SHALL proceed unintercepted by the editor

#### Scenario: Up button disabled on first card

- **WHEN** a `PromptEditorMessageCard` renders as the first card in the list
- **THEN** the up button SHALL be disabled and SHALL have `aria-label="上移"`

#### Scenario: Down button disabled on last card

- **WHEN** a `PromptEditorMessageCard` renders as the last card in the list
- **THEN** the down button SHALL be disabled and SHALL have `aria-label="下移"`

## REMOVED Requirements

### Requirement: Card body textarea auto-resizes to content

**Reason**: The card body is no longer a `<textarea>`. It is now an instance of the shared `VentoCodeEditor.vue` (CodeMirror 6) component, which manages its own viewport sizing through CodeMirror's built-in line-aware layout. The bespoke `requestAnimationFrame` auto-resize logic and the three-line floor measured against `line-height` / padding / border no longer apply.

**Migration**: The shared editor SHALL render with a `min-height` corresponding to `minLines` (default `3`) and SHALL grow naturally as content is added up to `maxLines` (default `30`); beyond `maxLines` the editor's viewport scrolls internally. The "Body editor surfaces vento.unknown-variable warnings" and "Body editor highlights Vento syntax" scenarios above cover the new behaviour. Authors who previously relied on a textarea-shaped resize handle now get a CodeMirror viewport with line numbers and standard CodeMirror keybindings.
