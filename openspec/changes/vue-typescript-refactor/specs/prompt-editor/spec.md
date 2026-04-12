# Prompt Editor — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

### Requirement: Editor UI

The frontend SHALL provide a `PromptEditor.vue` Single File Component as a fixed side-panel editor for editing the system prompt template. The editor SHALL use a `<textarea>` bound via `v-model` to a reactive ref containing the raw Vento template content loaded from `GET /api/template`. The editor panel SHALL be positioned at the right side of the viewport with `width: 33vw`. Lazy DOM creation previously used in vanilla JS SHALL be replaced by Vue's conditional rendering (`v-if` or `v-show`) to control panel visibility.

#### Scenario: View current template
- **WHEN** the user opens the prompt editor
- **THEN** the `PromptEditor.vue` component SHALL display the full Vento template content in a monospace textarea bound via `v-model`, loaded from `GET /api/template`

#### Scenario: Reset template
- **WHEN** the user clicks the "Reset" button in the editor
- **THEN** the component SHALL reload the template from the server, updating the `v-model` ref and discarding local edits

#### Scenario: Editor panel visibility via Vue conditional rendering
- **WHEN** the editor panel is toggled open or closed
- **THEN** the panel visibility SHALL be controlled by `v-if` or `v-show` on the component, replacing the previous lazy DOM creation pattern

### Requirement: Variable insertion pills

The editor SHALL display clickable pills above the textarea showing all available Vento template variables. Clicking a pill SHALL insert the `{{ variable_name }}` reference at the current cursor position in the textarea via a component method. Pills SHALL be color-coded: blue for core variables, green for plugin-contributed variables.

#### Scenario: Display variable pills
- **WHEN** the `PromptEditor.vue` component loads
- **THEN** it SHALL fetch variables from `GET /api/plugins/parameters` and render them as clickable pill buttons with color coding by source

#### Scenario: Insert variable from pill
- **WHEN** the user clicks a variable pill
- **THEN** the component method SHALL insert `{{ variable_name }}` at the textarea cursor position and update the `v-model` ref accordingly

### Requirement: Panel layout and backdrop

The preview panel SHALL be positioned at the left side (`left: 0`) and the editor panel at the right side (`right: 0`), both with `width: 33vw`. When either panel is visible, a semi-transparent backdrop SHALL be shown behind the panels. Clicking the backdrop SHALL close both panels. The `PromptEditor.vue` component SHALL fire a custom event (via `emit`) or a close callback when the user dismisses the panel, allowing the parent to coordinate backdrop and sibling panel state.

#### Scenario: Backdrop appears with panel
- **WHEN** the user opens the preview or editor panel
- **THEN** a semi-transparent backdrop SHALL appear behind the panels (z-index below panels, above page content)

#### Scenario: Click outside closes panels
- **WHEN** the user clicks on the backdrop (outside both panels)
- **THEN** both panels SHALL close and the backdrop SHALL hide

#### Scenario: Close emits event to parent
- **WHEN** the user closes the editor panel via its close button
- **THEN** the `PromptEditor.vue` component SHALL emit a `close` event, allowing the parent to update backdrop visibility and coordinate with the preview panel

### Requirement: Live preview integration

Changes made in the prompt editor SHALL be previewable using the prompt preview endpoint. The editor SHALL provide a "Preview" action that sends the current `v-model` template text to `POST /api/stories/:series/:name/preview-prompt` (via the `template` body field) and displays the rendered result in the preview panel.

#### Scenario: Preview edited template
- **WHEN** the user clicks "Preview" in the editor
- **THEN** the component SHALL send the current `v-model` textarea content as `template` to the preview endpoint and display the rendered prompt in the preview panel

#### Scenario: Preview with custom message
- **WHEN** the user has typed a message in the chat input and triggers preview from the editor
- **THEN** the preview SHALL render the prompt using that message as `user_input`

## ADDED Requirements

### Requirement: localStorage sync via composable

The `PromptEditor.vue` component SHALL synchronize the template text with `localStorage` via a composable that provides debounced persistence. The composable SHALL debounce writes to `localStorage` to avoid excessive storage operations during rapid typing. On component mount, the composable SHALL check `localStorage` for a previously saved draft and restore it if present. A diff-against-server mechanism SHALL be preserved to indicate when the local draft diverges from the server template.

#### Scenario: Debounced localStorage persistence
- **WHEN** the user types in the template textarea
- **THEN** the composable SHALL debounce and persist the current template text to `localStorage` after a short delay (e.g., 500ms)

#### Scenario: Draft restoration on mount
- **WHEN** the `PromptEditor.vue` component mounts and `localStorage` contains a saved template draft
- **THEN** the composable SHALL restore the draft into the `v-model` ref and indicate that a local draft is loaded

#### Scenario: Diff-against-server detection
- **WHEN** the local template text differs from the server-fetched template
- **THEN** the editor SHALL visually indicate the divergence (e.g., a "modified" badge) so the user knows local edits exist

### Requirement: PromptEditor component events

The `PromptEditor.vue` component SHALL use `defineEmits` to declare a typed `close` event. The component SHALL emit `close` when the user dismisses the editor panel, enabling the parent component to manage backdrop visibility and coordinate with sibling panels.

#### Scenario: Close event emitted on dismiss
- **WHEN** the user clicks the close button on the editor panel
- **THEN** the component SHALL emit `close` so the parent can hide the backdrop and update layout state

#### Scenario: Close event emitted on escape key
- **WHEN** the user presses the Escape key while the editor panel is focused
- **THEN** the component SHALL emit `close` for consistent dismissal behavior
