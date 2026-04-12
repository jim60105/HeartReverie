# Vento Error Handling

## Purpose

Error boundary for Vento template rendering that catches template errors and surfaces structured, actionable feedback to the user instead of silent failures or generic HTTP 500 responses.

## Requirements

### Requirement: Error catching

The `renderSystemPrompt()` function SHALL wrap the Vento template rendering call in a try/catch block. Any error thrown by the Vento engine during template compilation or rendering SHALL be caught and processed into a structured error response rather than propagating as an unhandled exception.

#### Scenario: Template rendering error is caught
- **WHEN** the Vento engine throws an error during `renderSystemPrompt()` execution
- **THEN** the error SHALL be caught by the try/catch block and SHALL NOT propagate as an unhandled exception or crash the server process

#### Scenario: Successful rendering passes through
- **WHEN** the Vento template renders without errors
- **THEN** the `renderSystemPrompt()` function SHALL return the rendered string normally without triggering error handling

### Requirement: Error types

The error handling SHALL recognize and handle the following Vento template error types: missing variables (referenced variable not provided in template data), syntax errors (malformed `{{ }}` blocks or invalid Vento directives), include file not found (a `{{ include }}` directive references a file that does not exist), and type errors in template logic (e.g., iterating over a non-iterable value).

#### Scenario: Missing variable error
- **WHEN** the template references `{{ nonexistent_var }}` and `nonexistent_var` is not in the template data
- **THEN** the error handler SHALL identify this as a missing variable error and include the variable name in the structured error

#### Scenario: Syntax error in template
- **WHEN** the template contains a malformed block such as `{{ if unclosed`
- **THEN** the error handler SHALL identify this as a syntax error and include the approximate location in the structured error

#### Scenario: Include file not found
- **WHEN** the template contains `{{ include "./nonexistent-file.md" }}` and the file does not exist
- **THEN** the error handler SHALL identify this as an include-not-found error and include the missing file path in the structured error

#### Scenario: Type error in template logic
- **WHEN** the template contains `{{ for item of status_data }}` but `status_data` is a string instead of an iterable
- **THEN** the error handler SHALL identify this as a type error and include the variable name and expected type in the structured error

### Requirement: Structured error response

On template error, the error handler SHALL produce a structured error object containing: `message` (string, human-readable error description), `templateFile` (string, the path to the template file being rendered), `line` (number or null, the approximate line number where the error occurred if available from the Vento engine), `variable` (string or null, the variable name involved if applicable), and `suggestion` (string, a hint for how to fix the error). This structured error SHALL be used by both the API response and frontend display.

#### Scenario: Structured error for missing variable
- **WHEN** a missing variable error occurs for `custom_plugin_var` in `system.md`
- **THEN** the structured error SHALL contain `message` describing the missing variable, `templateFile` as `system.md`, `variable` as `custom_plugin_var`, and `suggestion` indicating to check if the plugin providing this variable is enabled

#### Scenario: Structured error for syntax error
- **WHEN** a syntax error occurs at approximately line 42 of the template
- **THEN** the structured error SHALL contain `message` describing the syntax issue, `templateFile` as the template path, `line` as `42`, `variable` as `null`, and `suggestion` hinting to check the Vento syntax at that line

#### Scenario: Line number unavailable
- **WHEN** the Vento engine does not provide line number information for an error
- **THEN** the `line` field SHALL be `null`

### Requirement: Frontend display

Template errors SHALL be surfaced to the user in the chat UI as a `VentoErrorCard.vue` Single File Component. The component SHALL accept typed props: `message` (string, required — human-readable error description), `source` (string, optional — the template file path where the error occurred), `line` (number, optional — the approximate line number of the error), and `suggestion` (string, optional — a hint for how to fix the error). The component SHALL accept the same data shape as the current `renderVentoError()` function. The error card SHALL be styled differently from normal chat messages (e.g., red/warning border, error icon) to be immediately recognizable using scoped component styles. The error card SHALL NOT silently swallow the error or show a generic "something went wrong" message.

#### Scenario: Error card rendered as Vue component
- **WHEN** the chat endpoint returns an HTTP 422 template error response
- **THEN** the frontend SHALL render a `<VentoErrorCard>` component in the chat area, passing the error details as typed props

#### Scenario: Error card accepts typed props
- **WHEN** `<VentoErrorCard>` is instantiated with `message="Missing variable: custom_var"`, `source="system.md"`, `:line="42"`, `suggestion="Check if the plugin is enabled"`
- **THEN** the component SHALL render all four fields in the error card UI

#### Scenario: Optional props omitted gracefully
- **WHEN** `<VentoErrorCard>` is instantiated with only `message="Unknown error"` and no `source`, `line`, or `suggestion` props
- **THEN** the component SHALL render the message and omit display of the missing optional fields without errors

#### Scenario: Error card shows actionable information
- **WHEN** the error card is displayed with a missing variable error
- **THEN** the card SHALL show the variable name (via `message`), the template file (via `source`), and the suggestion text so the user can take corrective action

#### Scenario: Error card does not block further interaction
- **WHEN** a template error is displayed
- **THEN** the chat input SHALL remain functional, allowing the user to correct the issue and retry

### Requirement: VentoErrorCard component structure

The `VentoErrorCard.vue` component SHALL be implemented as a Vue 3 Single File Component using `<script setup lang="ts">`. The component SHALL define its props interface using `defineProps<T>()` with a TypeScript interface specifying `message: string`, `source?: string`, `line?: number`, and `suggestion?: string`. The component SHALL use scoped styles (`<style scoped>`) for its error card styling.

#### Scenario: Component uses script setup with TypeScript
- **WHEN** the `VentoErrorCard.vue` file is compiled by Vite
- **THEN** it SHALL contain `<script setup lang="ts">` and use `defineProps` with a TypeScript interface for type-safe prop definitions

#### Scenario: Component styling is scoped
- **WHEN** the `VentoErrorCard` component is rendered alongside other components
- **THEN** its error card styles SHALL NOT leak to other components due to `<style scoped>`

### Requirement: API response

When the chat endpoint (`POST /api/stories/:series/:name/chat`) encounters a Vento template error during prompt construction, the server SHALL return HTTP 422 (Unprocessable Entity) with the structured error object as the JSON response body. The server SHALL NOT return HTTP 500 for template rendering errors. The server SHALL NOT create a new chapter file when a template error occurs.

#### Scenario: Template error returns HTTP 422
- **WHEN** a Vento template error occurs during a chat request
- **THEN** the server SHALL return HTTP 422 with the structured error JSON body

#### Scenario: No chapter file created on template error
- **WHEN** a template error prevents prompt construction
- **THEN** the server SHALL NOT create a new chapter `.md` file

#### Scenario: Template error distinguished from server error
- **WHEN** a template error occurs
- **THEN** the server SHALL return HTTP 422 (not HTTP 500), allowing the frontend to distinguish template errors from unexpected server failures

### Requirement: Graceful degradation

For non-fatal template issues such as undefined optional variables, the system SHALL consider providing a default value (e.g., empty string) and logging a warning rather than failing the entire render. The system SHALL distinguish between required variables (e.g., `scenario`, `previous_context`) whose absence is a fatal error, and optional variables (e.g., plugin-contributed variables) whose absence may be handled gracefully.

#### Scenario: Optional variable is undefined
- **WHEN** a plugin-contributed optional variable is not available (e.g., the plugin is disabled) but is referenced in the template
- **THEN** the renderer SHALL substitute a default empty string for the variable, log a warning identifying the missing variable and its source, and continue rendering

#### Scenario: Required variable is undefined
- **WHEN** a core required variable such as `scenario` is missing from the template data
- **THEN** the renderer SHALL treat this as a fatal error and produce a structured error response

#### Scenario: Warning logged for graceful fallback
- **WHEN** a non-fatal variable substitution occurs
- **THEN** the server SHALL log a warning including the variable name, its expected source (plugin name or core), and the default value used
