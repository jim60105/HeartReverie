## MODIFIED Requirements

### Requirement: Vento template documentation

Documentation SHALL be created under the `docs/` directory. All documentation content SHALL be written in Traditional Chinese (正體中文).

The documentation SHALL explain the Vento template engine, including what it is and how it is integrated into this project for prompt construction.

The documentation SHALL list all available template variables with their types and descriptions:
- `previous_context` (array of strings): stripped chapter contents in numerical order.
- `user_input` (string): the raw user message.
- `isFirstRound` (boolean): whether this is the first round with no existing chapter content.
- `plugin_fragments` (array of strings): plugin-contributed prompt fragment bodies, ordered by handler priority.
- `series_name` / `story_name` (string): identifiers of the active story.
- `lore_all` / `lore_<tag>` / `lore_tags`: lore-codex variables (see lore documentation).
- Plugin-provided dynamic variables (e.g. `status_data`).
- The `scenario` variable from earlier versions is no longer provided; lore variables replace it.

The documentation SHALL explain how to use variables in Vento templates with syntax examples, including variable interpolation, iteration over arrays, and conditional rendering.

The documentation SHALL describe the prompt construction pipeline design, explaining that the rendered template is the **single source of truth for the upstream `messages` array**: the server does NOT auto-append a user message outside the template, and the template MUST emit at least one `user`-role message via the `{{ message }}` tag. Top-level template content (outside any `{{ message }}` block) is treated as `system`-role content interleaved in lexical order.

The documentation SHALL include a dedicated section on the `{{ message }}` custom tag covering:
- Syntax: `{{ message "system" }}…{{ /message }}`, `{{ message "user" }}…{{ /message }}`, `{{ message "assistant" }}…{{ /message }}`, and the identifier-role variant `{{ message <ident> }}…{{ /message }}`.
- Allowed roles: exactly `system`, `user`, `assistant`. Invalid roles surface as a Vento error with type `multi-message:invalid-role`.
- Nesting is forbidden — the documentation SHALL state that nested `{{ message }}` blocks raise `multi-message:nested`.
- Ordering: messages and top-level segments interleave in source order; adjacent system messages are coalesced; adjacent same-role non-system messages are preserved as separate turns.
- A worked example showing a multi-turn template (persona system → few-shot user/assistant pair → live user turn).
- Plugin compatibility note: existing `prompt-assembly` plugin fragments continue to work; authors choose whether to wrap them in a role-tag block.

#### Scenario: Documentation location and language
- **WHEN** the documentation is created
- **THEN** it SHALL reside under the `docs/` directory and SHALL be written entirely in Traditional Chinese (正體中文)

#### Scenario: Template variable reference
- **WHEN** a user reads the documentation
- **THEN** they SHALL find a complete listing of all available template variables (`previous_context`, `user_input`, `isFirstRound`, `plugin_fragments`, `series_name`, `story_name`, lore variables, and plugin-dynamic variables) with each variable's type and description

#### Scenario: Template syntax examples
- **WHEN** a user reads the documentation
- **THEN** they SHALL find syntax examples demonstrating Vento variable interpolation, array iteration (e.g., iterating over `previous_context` and `plugin_fragments`), conditional rendering (e.g., rendering `<start_hints>` only when `isFirstRound` is true), and the `{{ message }}` custom tag

#### Scenario: Pipeline design explanation
- **WHEN** a user reads the documentation
- **THEN** they SHALL find an explanation that the rendered template is the authoritative source of the upstream `messages` array, that the template MUST emit at least one `user`-role message, and that the server no longer auto-appends a trailing user turn

#### Scenario: Multi-message tag reference section
- **WHEN** a user reads the documentation
- **THEN** they SHALL find a dedicated `{{ message }}` tag section covering syntax, allowed roles, nesting rule, ordering / coalescing semantics, error variants (`multi-message:invalid-role`, `multi-message:nested`, `multi-message:no-user-message`), and at least one worked multi-turn example
