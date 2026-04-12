# Prompt Editor

## MODIFIED Requirements

### Requirement: Editor UI

The frontend SHALL provide a `PromptEditor.vue` Single File Component as the main editor widget for editing the system prompt template. The `PromptEditor.vue` component SHALL be rendered within a `PromptEditorPage.vue` routed component that fills the settings content area of `SettingsLayout`. The editor SHALL use a `<textarea>` bound via `v-model` to a reactive ref containing the raw Vento template content loaded from `GET /api/template`. The editor content SHALL fill the available width and height of the settings content area (no fixed `width: 33vw`). The component SHALL NOT include a close button or emit a `close` event — navigation away from the editor is handled by the settings sidebar or the back button. `PromptPreview` SHALL be rendered inline within `PromptEditorPage.vue` as a toggleable section in a flex layout (e.g., side-by-side or stacked), instead of as a separate Teleported overlay panel. Lazy DOM creation previously used in vanilla JS SHALL be replaced by Vue's conditional rendering (`v-if` or `v-show`) to control preview visibility within the page.

#### Scenario: View current template
- **WHEN** the user navigates to `/settings/prompt-editor`
- **THEN** the `PromptEditorPage.vue` route component SHALL render `PromptEditor.vue`, displaying the full Vento template content in a monospace textarea bound via `v-model`, loaded from `GET /api/template`

#### Scenario: Reset template
- **WHEN** the user clicks the "Reset" button in the editor
- **THEN** the component SHALL reload the template from the server, updating the `v-model` ref and discarding local edits

#### Scenario: Editor fills settings content area
- **WHEN** the prompt editor page is rendered within `SettingsLayout`
- **THEN** the editor SHALL expand to fill the available width and height of the settings content area, without fixed viewport-relative sizing (no `width: 33vw`)

#### Scenario: No close button or close emit
- **WHEN** the `PromptEditor.vue` component is inspected
- **THEN** it SHALL NOT contain a close button and SHALL NOT emit a `close` event — leaving the editor is done via sidebar navigation or the back button

#### Scenario: Inline preview toggle
- **WHEN** the user toggles the preview within the prompt editor page
- **THEN** `PromptPreview` SHALL appear inline in a flex layout alongside or below the editor textarea, not as a Teleported fixed-position overlay
