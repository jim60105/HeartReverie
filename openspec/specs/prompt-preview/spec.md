# Prompt Preview

## Purpose

API endpoint and frontend UI for previewing the fully rendered system prompt before sending to OpenRouter, with visibility into plugin contributions.

## Requirements

### Requirement: API endpoint

The server SHALL expose `POST /api/stories/:series/:name/preview-prompt` that accepts the same JSON body as the chat endpoint (`{ message }`) and returns the fully rendered system prompt WITHOUT sending the request to OpenRouter. The endpoint SHALL execute the full prompt construction pipeline including plugin `prompt-assembly` hooks, Vento template rendering, and chapter context assembly — producing an identical prompt to what the chat endpoint would send.

#### Scenario: Preview prompt for a story with existing chapters
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with `{ "message": "Continue the story" }` and the story has existing chapters
- **THEN** the server SHALL return HTTP 200 with the fully rendered system prompt, user message, plugin contributions, and template variables — without calling OpenRouter

#### Scenario: Preview prompt for a first-round story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with `{ "message": "Begin" }` and the story has no chapters with content
- **THEN** the server SHALL return HTTP 200 with the rendered prompt where `isFirstRound` is `true` and `previous_context` is empty

#### Scenario: Preview with missing story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with a non-existent series or story name
- **THEN** the server SHALL return HTTP 404

#### Scenario: Preview with missing message
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with an empty body or missing `message` field
- **THEN** the server SHALL return HTTP 400 with an error indicating the `message` field is required

### Requirement: Response format

The preview endpoint SHALL return a JSON response with the following structure: `systemPrompt` (string, the fully rendered system prompt text), `userMessage` (string, the raw user message), `pluginContributions` (array of objects, each with `plugin` (string, plugin name) and `section` (string, the contributed prompt fragment)), and `templateVariables` (object, the complete set of template variables passed to the Vento renderer including both core and plugin-provided variables).

#### Scenario: Response includes rendered system prompt
- **WHEN** the preview endpoint returns successfully
- **THEN** the `systemPrompt` field SHALL contain the complete rendered text identical to what would be sent as the system message to OpenRouter

#### Scenario: Response includes plugin contributions
- **WHEN** plugins contribute prompt fragments during `prompt-assembly`
- **THEN** the `pluginContributions` array SHALL contain one entry per contributing plugin, with the plugin's `name` and the `section` text it contributed

#### Scenario: Response includes template variables
- **WHEN** the preview endpoint renders the prompt
- **THEN** the `templateVariables` object SHALL include all variables passed to the Vento template, including `scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`, and any plugin-provided variables

#### Scenario: No plugin contributions
- **WHEN** no plugins contribute prompt fragments
- **THEN** the `pluginContributions` array SHALL be empty (`[]`)

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

### Requirement: Plugin contribution visibility

The prompt preview component SHALL display which plugins contributed which prompt sections. Each plugin contribution SHALL be visually labeled with the plugin name and its contributed section text, allowing the user to understand the composition of the final system prompt.

#### Scenario: Multiple plugin fragments displayed
- **WHEN** the preview response `fragments` array contains entries like `options`, `status`, and `writestyle`
- **THEN** the preview component SHALL display each fragment name as a label indicating which plugins contributed to the prompt

#### Scenario: Plugin fragments are distinguishable
- **WHEN** the preview component displays the rendered prompt alongside the `fragments` list
- **THEN** each plugin fragment name SHALL be visually distinguishable (e.g., as tags, badges, or a labeled list) from the prompt content area

#### Scenario: Template variable metadata displayed
- **WHEN** the preview response contains a `variables` object with `previous_context`, `isFirstRound`, etc.
- **THEN** the preview component SHALL display the variable metadata (e.g., chapter count, first-round flag) in a summary section above or alongside the prompt content

### Requirement: Typed response handling

The prompt preview component SHALL use TypeScript interfaces to type the API response from `POST /api/stories/:series/:name/preview-prompt`. The success response type SHALL define `prompt` (string — the fully rendered system prompt), `fragments` (string[] — list of plugin variable names that contributed to the prompt), `variables` (object with `scenario`, `previous_context`, `user_input`, `status_data`, and `isFirstRound` fields — template variable metadata), and `errors` (string[] — any non-fatal warnings). The 422 error response type SHALL define `type: "vento-error"` plus Vento-specific error fields (`message`, `position`, etc.). All response data access within the component SHALL be type-checked at compile time.

#### Scenario: Response is typed at compile time
- **WHEN** the `PromptPreview.vue` component processes the API response
- **THEN** the response SHALL be typed with a `PromptPreviewResponse` TypeScript interface defining `prompt`, `fragments`, `variables`, and `errors` fields, and all field accesses SHALL be compile-time checked

#### Scenario: Type-safe error response handling
- **WHEN** the endpoint returns a 422 status
- **THEN** the response SHALL be typed with a `VentoErrorResponse` interface defining `type: "vento-error"` and associated error detail fields, and the component SHALL use a type guard or status check to discriminate between success and error responses

#### Scenario: Type-safe fragment rendering
- **WHEN** the component iterates over `fragments` to render plugin contribution labels
- **THEN** each entry SHALL be typed as `string` (plugin variable name) and TypeScript SHALL enforce correct property access
