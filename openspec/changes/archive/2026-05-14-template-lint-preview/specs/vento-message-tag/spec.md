## ADDED Requirements

### Requirement: Parse-time multi-message errors map to vento.message-* lint diagnostics

The lint pipeline SHALL translate parse-time `SourceError` instances tagged with `multi-message:nested` and `multi-message:invalid-role` into lint diagnostics with rule IDs `vento.message-nested` and `vento.message-invalid-role` respectively. Runtime-only message-tag errors (`multi-message:no-user-message`, `multi-message:empty-message`) SHALL NOT be surfaced by the lint endpoint; they appear only when the preview endpoint actually renders the template.

#### Scenario: Nested message blocks become vento.message-nested

- **WHEN** the lint pipeline parses a source containing nested `{{ message }}` blocks
- **THEN** the response `diagnostics[]` contains a diagnostic with `ruleId === "vento.message-nested"`

#### Scenario: Invalid role becomes vento.message-invalid-role

- **WHEN** the lint pipeline parses a source containing `{{ message "bogus" }}...{{ /message }}`
- **THEN** the response `diagnostics[]` contains a diagnostic with `ruleId === "vento.message-invalid-role"`

#### Scenario: Runtime-only errors do not appear at lint time

- **WHEN** the lint pipeline parses a source that has no `{{ message "user" }}` block
- **THEN** the response `diagnostics[]` does NOT contain a `vento.no-user-message` diagnostic
- **AND** the diagnostic only appears on `POST /api/templates/preview` actual render
