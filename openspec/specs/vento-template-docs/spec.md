# Vento Template Documentation

## Purpose

Specifies the requirements for user-facing documentation that explains the Vento template engine integration, available template variables, syntax usage, and the prompt construction pipeline design. Documentation is written in Traditional Chinese (正體中文).

## Requirements

### Requirement: Vento template documentation

Documentation SHALL be created under the `docs/` directory. All documentation content SHALL be written in Traditional Chinese (正體中文).

The documentation SHALL explain the Vento template engine, including what it is and how it is integrated into this project for prompt construction.

The documentation SHALL list all available template variables with their types and descriptions:
- `scenario` (string): the scenario content loaded from `playground/:series/scenario.md`.
- `previous_context` (array of strings): stripped chapter contents in numerical order.
- `user_input` (string): the raw user message.
- `status_data` (string): the status file content.
- `isFirstRound` (boolean): whether this is the first round with no existing chapter content.

The documentation SHALL explain how to use variables in Vento templates with syntax examples, including variable interpolation, iteration over arrays, and conditional rendering.

The documentation SHALL describe the prompt construction pipeline design, explaining how the messages array is constructed from the fully rendered system template and the raw user input.

#### Scenario: Documentation location and language
- **WHEN** the documentation is created
- **THEN** it SHALL reside under the `docs/` directory and SHALL be written entirely in Traditional Chinese (正體中文)

#### Scenario: Template variable reference
- **WHEN** a user reads the documentation
- **THEN** they SHALL find a complete listing of all available template variables (`scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`) with each variable's type and description

#### Scenario: Template syntax examples
- **WHEN** a user reads the documentation
- **THEN** they SHALL find syntax examples demonstrating Vento variable interpolation, array iteration (e.g., iterating over `previous_context`), and conditional rendering (e.g., rendering `<start_hints>` only when `isFirstRound` is true)

#### Scenario: Pipeline design explanation
- **WHEN** a user reads the documentation
- **THEN** they SHALL find an explanation of the prompt construction pipeline design, describing how the server passes all variables to the `system.md` template and constructs the final messages array as a system message plus a user message
