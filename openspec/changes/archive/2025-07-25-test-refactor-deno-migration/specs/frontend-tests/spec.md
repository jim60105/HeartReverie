## ADDED Requirements

### Requirement: Pure function tests for parsers
Unit tests SHALL cover all pure parser/renderer functions in the reader frontend: `escapeHtml()`, `extractStatusBlocks()`, `parseStatus()`, `renderStatusPanel()`, `extractOptionsBlocks()`, `parseOptions()`, `extractVariableBlocks()`, `renderVariableBlock()`, `renderVentoError()`.

#### Scenario: Status block extraction
- **WHEN** `extractStatusBlocks()` receives text containing a `<status>` XML block
- **THEN** it returns the extracted block content and the text with the block replaced by a placeholder

#### Scenario: Options parsing
- **WHEN** `parseOptions()` receives a raw options block string
- **THEN** it returns a structured array of option objects with text and metadata

#### Scenario: HTML escaping
- **WHEN** `escapeHtml()` receives a string with `<`, `>`, `&`, `"` characters
- **THEN** it returns the string with all special characters replaced by HTML entities

### Requirement: FrontendHookDispatcher tests
Unit tests SHALL cover the `FrontendHookDispatcher` class: registration, dispatch order, and priority sorting.

#### Scenario: Priority-ordered dispatch
- **WHEN** multiple handlers are registered for the same stage with different priorities
- **THEN** dispatch calls them in ascending priority order

#### Scenario: Context mutation
- **WHEN** a handler mutates the context object during dispatch
- **THEN** subsequent handlers receive the mutated context

### Requirement: Markdown rendering pipeline tests
Unit tests SHALL cover the `reinjectPlaceholders()` function.

#### Scenario: Placeholder reinsertion
- **WHEN** `reinjectPlaceholders()` receives HTML with comment placeholders and a map of extracted blocks
- **THEN** it replaces each placeholder with the corresponding block content
