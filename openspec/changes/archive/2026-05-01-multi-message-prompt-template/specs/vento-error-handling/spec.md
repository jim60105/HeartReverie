## MODIFIED Requirements

### Requirement: Error types

The error handling SHALL recognize and handle the following Vento template error types: missing variables (referenced variable not provided in template data), syntax errors (malformed `{{ }}` blocks or invalid Vento directives), include file not found (a `{{ include }}` directive references a file that does not exist), type errors in template logic (e.g., iterating over a non-iterable value), and the following multi-message-specific error variants raised by the `vento-message-tag` capability:
- `multi-message:invalid-role` — a `{{ message }}` tag resolved to a role outside `{"system", "user", "assistant"}`. String-literal roles raise this at compile time; identifier roles raise it at runtime.
- `multi-message:nested` — a `{{ message }}` opener appeared inside another `{{ message }}` body (detected at compile time during body-token scanning, regardless of whether the inner tag would execute at runtime).
- `multi-message:no-user-message` — the assembled `ChatMessage[]` contains no `user`-role message.
- `multi-message:assembly-corrupt` — `splitRenderedMessages()` encountered a sentinel whose captured numeric index was out-of-bounds, duplicate, or otherwise inconsistent with the per-render side-channel buffer (defensive guard against forged sentinels).

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

#### Scenario: Invalid message role
- **WHEN** a `{{ message }}` tag's role expression resolves to a value outside the allow-list `{"system", "user", "assistant"}`
- **THEN** the error handler SHALL surface this as a `multi-message:invalid-role` error with `message` describing the offending role value, `templateFile` set to the rendered template path, and `suggestion` instructing the user to use one of the three allowed roles

#### Scenario: Nested message blocks
- **WHEN** the template opens a `{{ message }}` block inside the body of another `{{ message }}` block
- **THEN** the error handler SHALL surface this as a `multi-message:nested` error with `message` describing the nesting violation and `suggestion` instructing the user to split the nested block out to the top level

#### Scenario: Missing user-role message
- **WHEN** the assembled `ChatMessage[]` contains no `user`-role element after a successful render
- **THEN** the error handler SHALL surface this as a `multi-message:no-user-message` error with `message` explaining that the template must emit at least one `{{ message "user" }}` block (or include `{{ user_input }}` inside one), `templateFile` set to the template path, and `suggestion` instructing the user to add a `{{ message "user" }}{{ user_input }}{{ /message }}` block (typically near the end of the template)
