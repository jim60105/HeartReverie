# Options Panel — Plugin System Delta

## ADDED Requirements

### Requirement: Plugin manifest and registration

The options-panel SHALL register itself as a full-stack plugin with the plugin system. The plugin manifest SHALL declare:
- **name**: `options-panel`
- **type**: `full-stack`
- **prompt fragment**: `options.md` — the plugin SHALL contribute its prompt fragment file via the `prompt-assembly` hook, returning `{ name: 'options-panel', content: <contents of options.md> }`
- **frontend tag handler**: The plugin SHALL register a `frontend-render` handler for the `<options>` tag name, with the existing options panel renderer as the handler function
- **strip-tags hook**: The plugin SHALL register a `frontend-strip` handler declaring that `<options>` tags SHALL be stripped from chapter content when building `previous_context` for the prompt

During plugin initialization, the options-panel plugin SHALL:
1. Register its `<options>` tag with the md-renderer's tag handler registration API as type `render`
2. Register a `prompt-assembly` hook handler that reads and returns the `options.md` prompt fragment
3. Register a `frontend-strip` hook handler declaring `options` as a tag to strip from previous context

The existing detection, parsing, rendering, click behavior, event delegation, escapeHtml, and malformed-handling requirements remain unchanged — they are now invoked through the plugin system's `frontend-render` hook rather than hardcoded pipeline calls.

#### Scenario: Options-panel registers as a full-stack plugin
- **WHEN** the plugin system initializes the options-panel plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `<options>` tag handler with the md-renderer, register a `prompt-assembly` handler for `options.md`, and register a `frontend-strip` handler for the `options` tag

#### Scenario: Options-panel prompt fragment contributed
- **WHEN** the `prompt-assembly` hook is invoked during prompt construction
- **THEN** the options-panel plugin SHALL return `{ name: 'options-panel', content: <options.md content> }` to be included in the `plugin_prompts` array

#### Scenario: Options tag rendered via plugin system
- **WHEN** the md-renderer encounters an `<options>` block during XML extraction
- **THEN** the block SHALL be passed to the options-panel plugin's registered renderer, producing the same 2×2 button grid output as before

#### Scenario: Options tag stripped from previous context
- **WHEN** chapter content is processed for `previous_context` and contains `<options>...</options>` blocks
- **THEN** those blocks SHALL be stripped because the options-panel plugin registered the `options` tag in the `frontend-strip` hook
