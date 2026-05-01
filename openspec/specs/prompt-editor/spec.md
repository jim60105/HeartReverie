# Prompt Editor

## Purpose

Frontend system prompt template editor (編排器) for directly editing the Vento template text with variable insertion pills and live preview integration.

## Requirements

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

### Requirement: Variable insertion pills

The editor SHALL display clickable pills above the textarea showing all available Vento template variables. Clicking a pill SHALL insert the `{{ variable_name }}` reference at the current cursor position in the textarea via a component method. Pills SHALL be color-coded by source type: blue for core variables, green for plugin-contributed variables, and amber/gold for lore-contributed variables. The `scenario` variable SHALL NOT appear in the core pills (it was replaced by the lore codex system). Lore pills SHALL be dynamically fetched based on the current story context and SHALL update when the story context changes.

#### Scenario: Display variable pills with three color categories
- **WHEN** the `PromptEditor.vue` component loads with an active story context that has lore passages
- **THEN** it SHALL fetch variables from `GET /api/plugins/parameters` and render them as clickable pill buttons with blue for core, green for plugin, and amber/gold for lore variables

#### Scenario: Insert variable from pill
- **WHEN** the user clicks a variable pill
- **THEN** the component method SHALL insert `{{ variable_name }}` at the textarea cursor position and update the `v-model` ref accordingly

#### Scenario: scenario variable not present in pills
- **WHEN** the pills are rendered from the parameters endpoint response
- **THEN** no pill with the variable name `scenario` SHALL be displayed

#### Scenario: Lore pills update on story context change
- **WHEN** the user switches from story "quest" (with tags ["character", "world"]) to story "journey" (with tags ["location", "npc"])
- **THEN** the lore pills SHALL re-fetch from `GET /api/plugins/parameters` with the new story context and display `lore_all`, `lore_tags`, `lore_location`, and `lore_npc` instead of the previous lore variables

### Requirement: Lore variable discovery via parameters endpoint

The `GET /api/plugins/parameters` endpoint SHALL accept optional `series` and `story` query parameters. Lore variable inclusion follows a three-tier scope model based on which parameters are provided:
- **No parameters**: lore variables SHALL NOT be included in the response (preserving backward compatibility).
- **`series` only**: the endpoint SHALL include lore variables from global scope (`_lore/`) and series scope (`<series>/_lore/`), with source type `"lore"`.
- **`series` and `story`**: the endpoint SHALL include lore variables from all three scopes — global, series, and story (`<series>/<story>/_lore/`) — with source type `"lore"`.

In all cases where lore variables are included, `lore_all`, `lore_tags`, and all applicable `lore_<tag>` variables SHALL be present.

#### Scenario: Parameters endpoint returns lore variables with full story context
- **WHEN** a request is made to `GET /api/plugins/parameters?series=fantasy&story=quest` and the story has lore passages with tags ["character", "world"]
- **THEN** the response SHALL include lore variables from global, series, and story scopes — `lore_all`, `lore_tags`, `lore_character`, and `lore_world` with source type `"lore"`, in addition to existing core and plugin variables

#### Scenario: Parameters endpoint with series-only context returns global and series lore
- **WHEN** a request is made to `GET /api/plugins/parameters?series=fantasy` (without `story`) and the global scope has a passage tagged "rules" and the series scope has a passage tagged "world"
- **THEN** the response SHALL include lore variables from global and series scopes — `lore_all`, `lore_tags`, `lore_rules`, and `lore_world` with source type `"lore"` — but SHALL NOT include any story-scope lore variables

#### Scenario: Parameters endpoint without story context omits lore variables
- **WHEN** a request is made to `GET /api/plugins/parameters` without `series` or `story` query parameters
- **THEN** the response SHALL include only core and plugin variables, with no lore variables present

#### Scenario: Parameters endpoint with empty lore scope
- **WHEN** a request is made to `GET /api/plugins/parameters?series=empty&story=none` and no lore passages exist for that story context
- **THEN** the response SHALL include `lore_all` and `lore_tags` with source type `"lore"` (as they are always available) but no dynamic `lore_<tag>` variables

### Requirement: Frontend re-fetch on story context change

The frontend SHALL re-fetch parameters from `GET /api/plugins/parameters` whenever the active story context changes, passing the current `series` and `story` as query parameters. This ensures that lore pills reflect the lore passages available for the currently selected story. An `AbortController` SHALL be used to cancel any in-flight parameter request when the story context changes, preventing stale-response races where a slow earlier response overwrites a newer one.

#### Scenario: Re-fetch triggered on story selection
- **WHEN** the user selects a different story in the story selector
- **THEN** the prompt editor SHALL re-fetch `GET /api/plugins/parameters?series=<new_series>&story=<new_story>` and update the displayed pills accordingly

#### Scenario: Re-fetch clears stale lore pills
- **WHEN** the story context changes from a story with lore tags ["character", "world"] to one with tags ["location"]
- **THEN** the previous lore pills (`lore_character`, `lore_world`) SHALL be removed and replaced with the new lore pills (`lore_all`, `lore_tags`, `lore_location`)

#### Scenario: Rapid story switching aborts in-flight requests
- **WHEN** the user switches from story A to story B and then immediately to story C before the story-B request completes
- **THEN** the in-flight request for story B SHALL be aborted via `AbortController.abort()`, only the story C request SHALL complete, and the displayed pills SHALL reflect story C's lore variables

### Requirement: Live preview integration

Changes made in the prompt editor SHALL be previewable using the prompt preview endpoint. The editor SHALL provide a "Preview" action that sends the current `v-model` template text to `POST /api/stories/:series/:name/preview-prompt` (via the `template` body field) and displays the rendered result in the preview panel.

#### Scenario: Preview edited template
- **WHEN** the user clicks "Preview" in the editor
- **THEN** the component SHALL send the current `v-model` textarea content as `template` to the preview endpoint and display the rendered prompt in the preview panel

#### Scenario: Preview with custom message
- **WHEN** the user has typed a message in the chat input and triggers preview from the editor
- **THEN** the preview SHALL render the prompt using that message as `user_input`

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

### Requirement: PromptEditor component events

The `PromptEditor.vue` component SHALL NOT use `defineEmits` to declare a `close` event. The component SHALL NOT emit `close` — navigation is handled by router and settings sidebar. The component SHALL emit a `saved` event after a successful save operation to allow parent components (e.g., `PromptEditorPage.vue`) to react — such as reloading the preview panel.

#### Scenario: No close event
- **WHEN** the `PromptEditor.vue` component is inspected
- **THEN** it SHALL NOT contain `defineEmits` for a `close` event and SHALL NOT emit any `close` event

#### Scenario: Saved event emitted after save
- **WHEN** the `save()` method completes successfully
- **THEN** the component SHALL emit a `saved` event

### Requirement: Editor textarea is the sole scroll container for template text

Within `PromptEditor.vue`, `.editor-textarea` SHALL be the only scroll container for the template content. The toolbar (`.editor-toolbar`) and variable pills row SHALL remain pinned at the top of the editor pane and SHALL NOT scroll when the user scrolls the textarea content. The editor's outer flex chain (`.editor-root` → `.editor-textarea-wrap` → `<textarea class="editor-textarea">`) SHALL guarantee that overflow stops at the textarea: `.editor-textarea-wrap` SHALL declare `flex: 1; min-height: 0; overflow: hidden`, and `.editor-textarea` SHALL keep `width: 100%; height: 100%; resize: none`, allowing the native `<textarea>` element to manage its own internal scroll for long content.

The page itself (the `PromptEditorPage.vue` route component and its ancestors up to `.settings-layout`) SHALL NOT scroll as a result of long textarea content. Pasting or typing content longer than the viewport SHALL produce textarea-internal scroll only. This page-level guarantee depends on the `:has(.editor-page)` cap defined in `settings-page` and is verified by manual browser smoke (see Decision 6 in design.md).

#### Scenario: Editor textarea wrap declares clip rules in the source

- **WHEN** `PromptEditor.vue`'s scoped style block is read as text
- **THEN** the `.editor-textarea-wrap` rule SHALL declare `flex: 1`, `min-height: 0`, and `overflow: hidden`
- **AND** the `.editor-textarea` rule SHALL declare `width: 100%`, `height: 100%`, and `resize: none`

#### Scenario: Toolbar stays pinned when textarea content overflows (manual smoke)

- **WHEN** the textarea contains text longer than its visible height and the user scrolls inside the textarea in a real browser
- **THEN** the editor toolbar (`.editor-toolbar`, including the "儲存" / "預覽 Prompt" buttons and variable pills) SHALL remain visible and at the same position relative to the viewport
- **AND** the textarea SHALL scroll its own content internally
- **AND** this scenario is verified by manual browser smoke (Happy DOM does not perform real layout)

#### Scenario: Long template does not scroll the page (manual smoke)

- **WHEN** the user pastes a template that is many times taller than the viewport into the editor in a real browser
- **THEN** the document body's `scrollTop` SHALL remain `0` and the body SHALL produce no vertical scrollbar
- **AND** the only element that scrolls in response to the user dragging the scrollbar near the textarea SHALL be the `<textarea class="editor-textarea">` itself
- **AND** this scenario is verified by manual browser smoke

#### Scenario: Textarea scroll does not affect preview scroll (no JS sync)

- **GIVEN** the preview pane is open alongside the editor
- **WHEN** test code mutates the textarea's `scrollTop` programmatically
- **THEN** `.preview-content`'s `scrollTop` SHALL remain at its prior value (proving no JS scroll-sync handler exists)
- **AND** the converse SHALL also hold: mutating `.preview-content`'s `scrollTop` SHALL NOT change the textarea's `scrollTop`
