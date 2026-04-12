## MODIFIED Requirements

### Requirement: localStorage sync via composable

The `usePromptEditor` composable SHALL persist the template through the backend `PUT /api/template` endpoint instead of `localStorage`. The composable SHALL track dirty state by comparing the current editor content against the last-saved version. The composable SHALL expose an `isDirty` computed ref and an async `save()` method that calls `PUT /api/template`. The composable SHALL expose an `isSaving` ref for loading state. On load, the composable SHALL fetch the template via `GET /api/template` and use the `source` field to determine whether a custom prompt is active. The `savedTemplate` computed SHALL be removed — the chat route reads from the server-side file directly, so the frontend no longer sends the template in the chat request body. The `localStorage` key `story-editor-template` SHALL no longer be read or written.

#### Scenario: Save via API
- **WHEN** the user clicks the "儲存" (Save) button in the editor
- **THEN** the composable SHALL call `PUT /api/template` with the current textarea content and update the last-saved snapshot on success

#### Scenario: Dirty state tracking
- **WHEN** the user modifies the textarea content so it differs from the last-saved version
- **THEN** the `isDirty` computed ref SHALL be `true` and the save button SHALL be enabled

#### Scenario: Clean state after save
- **WHEN** a save completes successfully
- **THEN** `isDirty` SHALL be `false` and `isSaving` SHALL be `false`

#### Scenario: Load detects custom vs default
- **WHEN** the composable fetches the template on mount
- **THEN** it SHALL use the `source` field from `GET /api/template` to set an `isCustom` ref indicating whether a custom prompt file exists

#### Scenario: Reset calls DELETE
- **WHEN** the user clicks "回復預設" (Reset to default)
- **THEN** the composable SHALL call `DELETE /api/template`, then re-fetch via `GET /api/template` to load `system.md` content

#### Scenario: No localStorage usage
- **WHEN** the composable code is inspected
- **THEN** it SHALL contain no references to `localStorage`, `STORAGE_KEY`, or `sessionStorage`

### Requirement: Editor UI

The frontend SHALL provide a `PromptEditor.vue` Single File Component as the main editor widget for editing the system prompt template. The `PromptEditor.vue` component SHALL be rendered within a `PromptEditorPage.vue` routed component that fills the settings content area of `SettingsLayout`. The editor SHALL use a `<textarea>` bound via `v-model` to a reactive ref containing the raw Vento template content loaded from `GET /api/template`. The editor content SHALL fill the available width and height of the settings content area (no fixed `width: 33vw`). The component SHALL NOT include a close button or emit a `close` event — navigation away from the editor is handled by the settings sidebar or the back button. `PromptPreview` SHALL be rendered inline within `PromptEditorPage.vue` as a toggleable section in a flex layout (e.g., side-by-side or stacked), instead of as a separate Teleported overlay panel. Lazy DOM creation previously used in vanilla JS SHALL be replaced by Vue's conditional rendering (`v-if` or `v-show`) to control preview visibility within the page. The editor toolbar SHALL include a "儲存" (Save) button that calls the composable's `save()` method. The save button SHALL be disabled when `isDirty` is `false` or `isSaving` is `true`. The save button SHALL display a loading indicator while `isSaving` is `true`. The editor toolbar SHALL include a "回復預設" (Reset to default) button that calls the composable's `resetTemplate()` method. The reset button SHALL be disabled when `isCustom` is `false` (no custom file to reset).

#### Scenario: View current template
- **WHEN** the user navigates to `/settings/prompt-editor`
- **THEN** the `PromptEditorPage.vue` route component SHALL render `PromptEditor.vue`, displaying the full Vento template content in a monospace textarea bound via `v-model`, loaded from `GET /api/template`

#### Scenario: Save button enabled when dirty
- **WHEN** the editor content differs from the last-saved version
- **THEN** the "儲存" button SHALL be enabled and clickable

#### Scenario: Save button disabled when clean
- **WHEN** the editor content matches the last-saved version
- **THEN** the "儲存" button SHALL be disabled

#### Scenario: Save button shows loading state
- **WHEN** a save operation is in progress
- **THEN** the "儲存" button SHALL be disabled and display a loading indicator

#### Scenario: Reset button disabled when no custom file
- **WHEN** the template source is `"default"` (no custom file exists)
- **THEN** the "回復預設" button SHALL be disabled

#### Scenario: Reset template
- **WHEN** the user clicks the "回復預設" button in the editor
- **THEN** the component SHALL call `DELETE /api/template`, re-fetch the template from the server, update the `v-model` ref with `system.md` content, and set `isCustom` to `false`

#### Scenario: Editor fills settings content area
- **WHEN** the prompt editor page is rendered within `SettingsLayout`
- **THEN** the editor SHALL expand to fill the available width and height of the settings content area, without fixed viewport-relative sizing (no `width: 33vw`)

#### Scenario: No close button or close emit
- **WHEN** the `PromptEditor.vue` component is inspected
- **THEN** it SHALL NOT contain a close button and SHALL NOT emit a `close` event — leaving the editor is done via sidebar navigation or the back button

#### Scenario: Inline preview toggle
- **WHEN** the user toggles the preview within the prompt editor page
- **THEN** `PromptPreview` SHALL appear inline in a flex layout alongside or below the editor textarea, not as a Teleported fixed-position overlay

#### Scenario: Preview reloads on save
- **WHEN** the user clicks the "儲存" (Save) button while the preview panel is open
- **THEN** the `PromptEditorPage.vue` component SHALL trigger `PromptPreview` to re-fetch the rendered prompt from the server, reflecting the newly saved template content

### Requirement: PromptEditor component events

The `PromptEditor.vue` component SHALL NOT use `defineEmits` to declare a `close` event. The component SHALL NOT emit `close` — navigation is handled by router and settings sidebar. The component SHALL emit a `saved` event after a successful save operation to allow parent components (e.g., `PromptEditorPage.vue`) to react — such as reloading the preview panel.

#### Scenario: No close event
- **WHEN** the `PromptEditor.vue` component is inspected
- **THEN** it SHALL NOT contain `defineEmits` for a `close` event and SHALL NOT emit any `close` event

#### Scenario: Saved event emitted after save
- **WHEN** the `save()` method completes successfully
- **THEN** the component SHALL emit a `saved` event

## REMOVED Requirements

### Requirement: Panel layout and backdrop

**Reason**: The prompt editor is now rendered within `SettingsLayout` as a routed page, not as a sliding panel with backdrop. Panel positioning (`left: 0`, `right: 0`, `width: 33vw`), backdrop, and close-on-click-outside are no longer applicable.

**Migration**: The editor is accessed via `/settings/prompt-editor` route. No panel or backdrop behavior exists.
