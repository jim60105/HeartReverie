## MODIFIED Requirements

### Requirement: Frontend panel

The reader UI SHALL include a `PromptPreview.vue` Single File Component for displaying the prompt preview. The component SHALL be positioned at the left side of the viewport (`left: 0`) with `width: 33vw`. The component SHALL accept props for visibility state and SHALL use Vue's conditional rendering (`v-if` or `v-show`) instead of imperative lazy DOM creation. When triggered from the chat input, the current message SHALL be sent as the request body. When triggered from the editor, the current textarea content SHALL be sent as a `template` override in the request body. When either panel is open, a semi-transparent backdrop SHALL appear; clicking the backdrop SHALL close all panels. The component SHALL emit a `close` event (or dispatch a custom event) when dismissed, rather than using imperative DOM manipulation.

#### Scenario: Open preview panel before sending
- **WHEN** the user triggers the prompt preview action (e.g., clicks a preview button) with a message drafted in the chat input
- **THEN** the `PromptPreview.vue` component SHALL send a `POST /api/stories/:series/:name/preview-prompt` request with the drafted message and display the result in the side panel with a backdrop

#### Scenario: Preview panel displays rendered prompt
- **WHEN** the preview component receives a successful response
- **THEN** it SHALL display the `prompt` text in a scrollable, readable format, show contributing plugin names from the `fragments` array, and display template variable metadata from the `variables` object

#### Scenario: Preview panel handles Vento template error
- **WHEN** the preview endpoint returns a 422 response with `{ type: "vento-error", ... }` (structured Vento template error)
- **THEN** the component SHALL detect the `vento-error` type, render the error details using the `VentoErrorCard.vue` component, and NOT display the prompt content area

#### Scenario: Preview panel is dismissible
- **WHEN** the user closes the preview panel via close button or backdrop click
- **THEN** the component SHALL emit a `close` event, the panel SHALL close without affecting the chat input or message state, and the backdrop SHALL hide if no other panel is open

#### Scenario: Vue conditional rendering replaces lazy DOM creation
- **WHEN** the prompt preview panel has not been opened yet
- **THEN** the component SHALL use Vue's `v-if` or `v-show` directive for visibility control instead of imperatively creating and appending DOM elements on first use

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
