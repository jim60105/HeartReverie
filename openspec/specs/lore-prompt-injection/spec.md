# Lore Prompt Injection Specification

## Purpose

Defines how lore passages are transformed into template variables for injection into the Vento system prompt template.

## Requirements

### Requirement: lore_all Variable Generation
The lore system SHALL provide a `lore_all` template variable that contains all in-scope, enabled lore passages concatenated with separator strings.

#### Scenario: Multiple passages concatenated
- **WHEN** there are 3 enabled passages with priorities [100, 80, 60] and content ["Alice bio", "World rules", "Plot setup"]
- **THEN** `lore_all` SHALL be "Alice bio\n\n---\n\n World rules\n\n---\n\nPlot setup" (sorted by priority descending)

#### Scenario: Single passage available
- **WHEN** there is 1 enabled passage with content "Only character description"
- **THEN** `lore_all` SHALL be "Only character description" (no separators)

#### Scenario: No passages in scope
- **WHEN** no lore passages are enabled or in-scope for the current story
- **THEN** `lore_all` SHALL be an empty string ""

### Requirement: Tag-Specific Variable Generation
The lore system SHALL provide template variables for each unique effective tag, with tag names **normalized** to valid identifiers: lowercased, hyphens and spaces replaced with underscores, non-alphanumeric/underscore characters removed. The variable name format is `lore_<normalized_tag>`. If two tags normalize to the same identifier, their passages are merged under that variable.

#### Scenario: Character and world tags available
- **WHEN** there are passages with effective tags ["character", "world"] and content ["Alice bio", "Magic system"]
- **THEN** template variables `lore_character` SHALL be "Alice bio" and `lore_world` SHALL be "Magic system"

#### Scenario: Hyphenated tag normalization
- **WHEN** passages have effective tag "comic-relief" with content ["Funny NPC"]
- **THEN** the template variable SHALL be `lore_comic_relief` (hyphen normalized to underscore)

#### Scenario: Multiple passages per tag
- **WHEN** there are 2 passages both tagged "character" with priorities [90, 70] and content ["Alice", "Bob"]
- **THEN** `lore_character` SHALL be "Alice\n\n---\n\nBob" (sorted by priority descending)

### Requirement: lore_tags Metadata Array
The lore system SHALL provide a `lore_tags` template variable containing an array of all unique effective tags found across in-scope passages.

#### Scenario: Multiple unique tags available
- **WHEN** in-scope passages have effective tags ["character", "world", "plot", "character"]
- **THEN** `lore_tags` SHALL be ["character", "world", "plot"] (unique tags only)

#### Scenario: No tags available
- **WHEN** no lore passages are in scope or all passages have no effective tags
- **THEN** `lore_tags` SHALL be an empty array []

### Requirement: Variable Namespacing
All lore-related template variables SHALL use the `lore_` prefix to prevent naming conflicts with other template variables.

#### Scenario: Namespace isolation
- **WHEN** lore passages have effective tags ["status", "config", "user"]
- **THEN** template variables SHALL be named `lore_status`, `lore_config`, `lore_user` (not conflicting with system variables)

#### Scenario: Reserved name handling
- **WHEN** effective tags include system-reserved names like "prompt" or "response"
- **THEN** variables SHALL be `lore_prompt` and `lore_response` (safely namespaced)

### Requirement: Prompt Integration
The lore retrieval engine in `writer/lib/lore.ts` SHALL be called directly by `renderSystemPrompt()` in `writer/lib/template.ts` with the active series and story context. The engine SHALL compute lore template variables and return them to be spread into the Vento template render context alongside existing variables.

#### Scenario: Variables computed at render time
- **WHEN** the system prompt is being rendered via `renderSystemPrompt()` with series "fantasy" and story "quest"
- **THEN** the lore retrieval engine SHALL be called with that context and lore variables SHALL be available in the Vento template context

#### Scenario: Variables integrated with existing variables
- **WHEN** the template is rendered with both existing template variables and lore variables
- **THEN** lore variables SHALL be merged with other template variables without conflicts

### Requirement: Empty Variable Safety
All `lore_*` template variables for tags **discovered during the current scope scan** SHALL be present in the template context as empty strings if no passages match. Tags not discovered in any scope are NOT guaranteed to have variables — referencing an undiscovered tag in a Vento template may produce an undefined variable error.

#### Scenario: Discovered tag with no matching passages in scope
- **WHEN** a tag "location" exists in global scope but no location-tagged passages are enabled for the current story scope
- **THEN** `lore_location` SHALL be an empty string "" (the tag was discovered, so the variable exists)

#### Scenario: Empty lore state
- **WHEN** no lore passages exist at all for the current story
- **THEN** `lore_all` SHALL be an empty string "" and `lore_tags` SHALL be an empty array []
