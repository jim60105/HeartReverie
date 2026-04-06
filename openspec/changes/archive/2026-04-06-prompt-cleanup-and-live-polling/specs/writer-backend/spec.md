# Writer Backend (MODIFIED)

## Purpose

Node.js Express server that serves the reader frontend, exposes REST API endpoints for story management, and proxies chat requests to OpenRouter with a faithful prompt construction pipeline.

## Requirements

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array following the exact structure defined in the design document. The system prompt SHALL be rendered by passing the content of `playground/:series/scenario.md` into the Vento template `playground/prompts/system.md` using the variable name `scenario`. Each existing chapter SHALL be included as a separate assistant message wrapped in `<previous_context>` tags. The user message SHALL be wrapped in `<inputs>` tags. On the first round (no existing chapter content), the user message SHALL be prefixed with hardcoded `<start_hints>` content. A system message containing the status file wrapped in `<status_current_variable>` tags and another system message with `after_user_message.md` content SHALL be appended after the user message.

Before including chapter content in `<previous_context>` messages, the server SHALL strip `<options>...</options>` and `<disclaimer>...</disclaimer>` tags and their enclosed content from the chapter text. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the messages array SHALL include the rendered system prompt, the user message prefixed with `<start_hints>` and wrapped in `<inputs>`, the status system message, and the after_user_message system message

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the messages array SHALL include the rendered system prompt, one assistant message per chapter wrapped in `<previous_context>` tags in numerical order, the user message wrapped in `<inputs>` tags without `<start_hints>`, the status system message, and the after_user_message system message

#### Scenario: Chapter with options and disclaimer tags
- **WHEN** a chapter's content contains `<options>...</options>` and/or `<disclaimer>...</disclaimer>` tags
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is wrapped in `<previous_context>`

#### Scenario: Chapter without options or disclaimer tags
- **WHEN** a chapter's content does not contain `<options>` or `<disclaimer>` tags
- **THEN** the chapter content SHALL be included in `<previous_context>` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `playground/prompts/system.md` with `{ scenario: <content of scenario.md> }` as the template data
