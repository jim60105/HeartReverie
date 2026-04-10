# vento-prompt-template (New Spec)

## ADDED Requirements

### Requirement: Template variables

The system prompt template (`playground/prompts/system.md`) SHALL receive the following variables from the server:
- `scenario` (string): Content of `playground/:series/scenario.md`.
- `previous_context` (array of strings): Stripped chapter contents in numerical order. Each element has already been processed to remove `<options>`, `<disclaimer>`, and `<user_message>` tags.
- `user_input` (string): The raw user message.
- `status_data` (string): The status file content (from `current-status.yml` or `init-status.yml`). Named `status_data` to avoid conflict with the template-local `status` variable set via `{{ set status }}{{ include "./status.md" }}{{ /set }}`.
- `isFirstRound` (boolean): `true` when no chapters with non-empty content exist, `false` otherwise.

#### Scenario: All variables passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all five variables: `scenario`, `previous_context`, `user_input`, `status_data`, and `isFirstRound`

#### Scenario: previous_context is empty on first round
- **WHEN** `isFirstRound` is `true`
- **THEN** `previous_context` SHALL be an empty array

#### Scenario: previous_context contains stripped chapters
- **WHEN** chapters with content exist
- **THEN** `previous_context` SHALL contain one string per chapter, ordered numerically, with `<options>`, `<disclaimer>`, and `<user_message>` tags already removed

### Requirement: Template prompt structure

The `system.md` template SHALL use Vento syntax to control all prompt structure. The template SHALL iterate over the `previous_context` array and wrap each entry in `<previous_context>` tags. The template SHALL conditionally render `<start_hints>` content when `isFirstRound` is `true`. The template SHALL include `status_data` content wrapped in `<status_current_variable>` tags. The template SHALL incorporate the content previously delivered by `after_user_message.md` directly within the template.

#### Scenario: Previous context rendering
- **WHEN** `previous_context` contains chapter entries
- **THEN** the rendered template SHALL contain each chapter wrapped in `<previous_context>` tags in order

#### Scenario: First round start hints
- **WHEN** `isFirstRound` is `true`
- **THEN** the rendered template SHALL include `<start_hints>` content with writing guidance

#### Scenario: Subsequent round without start hints
- **WHEN** `isFirstRound` is `false`
- **THEN** the rendered template SHALL NOT include `<start_hints>` content

#### Scenario: Status variable rendering
- **WHEN** the template is rendered
- **THEN** the rendered output SHALL include the `status_data` content wrapped in `<status_current_variable>` tags

#### Scenario: after_user_message content consolidated
- **WHEN** the template is rendered
- **THEN** the rendered output SHALL include the content that was previously in `after_user_message.md`, rendered within the same template
