# Vento Error Handling — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: VentoErrorCard component structure

The `VentoErrorCard.vue` component SHALL be implemented as a Vue 3 Single File Component using `<script setup lang="ts">`. The component SHALL define its props interface using `defineProps<T>()` with a TypeScript interface specifying `message: string`, `source?: string`, `line?: number`, and `suggestion?: string`. The component SHALL use scoped styles (`<style scoped>`) for its error card styling.

#### Scenario: Component uses script setup with TypeScript
- **WHEN** the `VentoErrorCard.vue` file is compiled by Vite
- **THEN** it SHALL contain `<script setup lang="ts">` and use `defineProps` with a TypeScript interface for type-safe prop definitions

#### Scenario: Component styling is scoped
- **WHEN** the `VentoErrorCard` component is rendered alongside other components
- **THEN** its error card styles SHALL NOT leak to other components due to `<style scoped>`
