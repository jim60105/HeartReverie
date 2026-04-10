# writer-backend (Delta Spec)

## MODIFIED Requirements

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `scenario` (string, content of `playground/:series/scenario.md`), `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `status_data` (string, the status file content), and `isFirstRound` (boolean, true when no chapters with content exist). See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

The Vento template rendering call SHALL pass all variables to the `playground/prompts/system.md` template as `{ scenario, previous_context, user_input, status_data, isFirstRound }`.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The messages array SHALL be simplified to exactly two messages: a system message containing the fully rendered template output, followed by a user message containing the raw user input.

Before including chapter content in the `previous_context` array, the server SHALL strip `<options>...</options>`, `<disclaimer>...</disclaimer>`, and `<user_message>...</user_message>` tags and their enclosed content from the chapter text. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the server SHALL pass `previous_context` as an empty array, `user_input` as the raw user message, `status_data` as the status file content, and `isFirstRound` as `true` to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the server SHALL pass `previous_context` as an array of stripped chapter contents in numerical order, `user_input` as the raw user message, `status_data` as the status file content, and `isFirstRound` as `false` to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Chapter with options, disclaimer, and user_message tags
- **WHEN** a chapter's content contains `<options>...</options>`, `<disclaimer>...</disclaimer>`, and/or `<user_message>...</user_message>` tags
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain `<options>`, `<disclaimer>`, or `<user_message>` tags
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `playground/prompts/system.md` with `{ scenario, previous_context, user_input, status_data, isFirstRound }` as the template data

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message
