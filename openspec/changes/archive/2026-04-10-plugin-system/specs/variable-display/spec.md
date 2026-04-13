# Variable Display — Plugin System Delta

## ADDED Requirements

### Requirement: Plugin manifest and registration

The variable-display SHALL register itself as a frontend-only plugin with the plugin system. The plugin manifest SHALL declare:
- **name**: `variable-display`
- **type**: `frontend-only`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<UpdateVariable>` tag name, with the existing variable display renderer as the handler function

During plugin initialization, the variable-display plugin SHALL:
1. Register its `<UpdateVariable>` tag with the md-renderer's tag handler registration API as type `render`

The plugin SHALL NOT register any `prompt-assembly`, `post-response`, or `frontend-strip` hooks, as it is a frontend-only plugin that only renders extracted blocks.

The existing complete/incomplete block rendering, content display, multiple blocks handling, and default collapsed state requirements remain unchanged — they are now invoked through the plugin system's `frontend-render` hook rather than hardcoded pipeline calls.

#### Scenario: Variable-display registers as a frontend-only plugin
- **WHEN** the plugin system initializes the variable-display plugin
- **THEN** the plugin SHALL register its manifest with type `frontend-only` and register its `<UpdateVariable>` tag handler with the md-renderer's tag handler registration API

#### Scenario: UpdateVariable tag rendered via plugin system
- **WHEN** the md-renderer encounters an `<UpdateVariable>` block during XML extraction
- **THEN** the block SHALL be passed to the variable-display plugin's registered renderer, producing the same collapsible `<details>` output as before

#### Scenario: No backend hooks registered
- **WHEN** the variable-display plugin is initialized
- **THEN** it SHALL NOT register any `prompt-assembly`, `post-response`, or `frontend-strip` hook handlers
