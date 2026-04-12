# Prompt Preview

## MODIFIED Requirements

### Requirement: Frontend panel

The reader UI SHALL include a `PromptPreview.vue` Single File Component for displaying the prompt preview. The component SHALL be rendered inline within `PromptEditorPage.vue` as part of a flex layout, conditionally toggled via `v-if` or `v-show`. The component SHALL NOT use fixed positioning (`left: 0`, `width: 33vw`) or be Teleported to an overlay. When triggered from the chat input context, the current message SHALL be sent as the request body. When triggered from the editor, the current textarea content SHALL be sent as a `template` override in the request body. The component SHALL NOT emit a `close` event — visibility is controlled by the parent `PromptEditorPage.vue` via a reactive toggle. No semi-transparent backdrop SHALL be rendered for the preview within the settings page. Series/story context for preview requests SHALL be obtained from `useChapterNav().getBackendContext()`.

#### Scenario: Preview rendered inline within editor page
- **WHEN** the user toggles the preview on within the prompt editor page
- **THEN** the `PromptPreview.vue` component SHALL render inline within `PromptEditorPage.vue`'s flex layout (e.g., side-by-side with or below the editor textarea), not as a fixed-position overlay

#### Scenario: Preview panel displays rendered prompt
- **WHEN** the preview component receives a successful response
- **THEN** it SHALL display the `prompt` text in a scrollable, readable format, show contributing plugin names from the `fragments` array, and display template variable metadata from the `variables` object

#### Scenario: Preview panel handles Vento template error
- **WHEN** the preview endpoint returns a 422 response with `{ type: "vento-error", ... }` (structured Vento template error)
- **THEN** the component SHALL detect the `vento-error` type, render the error details using the `VentoErrorCard.vue` component, and NOT display the prompt content area

#### Scenario: No fixed positioning or Teleport
- **WHEN** the `PromptPreview.vue` component styles are inspected
- **THEN** there SHALL be no `position: fixed`, no `left: 0`, no `width: 33vw`, and no use of Vue's `<Teleport>` directive

#### Scenario: No close emit or backdrop
- **WHEN** the `PromptPreview.vue` component is rendered within the settings page
- **THEN** it SHALL NOT emit a `close` event and SHALL NOT render a semi-transparent backdrop — visibility is managed by the parent component's reactive toggle

#### Scenario: Series/story context from composable
- **WHEN** the preview component sends a request to `POST /api/stories/:series/:name/preview-prompt`
- **THEN** the `:series` and `:name` path parameters SHALL be obtained from `useChapterNav().getBackendContext()` to ensure the preview uses the currently active story context
