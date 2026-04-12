# Display Strip Tags

## Purpose

Declarative frontend tag stripping via the `displayStripTags` manifest field, replacing the `frontend-strip` hook stage with a configuration-driven approach.

## Requirements

### Requirement: Declarative frontend strip tag support

The plugin system SHALL support a `displayStripTags` field in `plugin.json` manifests. This field SHALL be an optional array of strings following the same format as the existing `promptStripTags` field:

- Plain tag names (e.g., `"disclaimer"`) SHALL be auto-wrapped as the regex pattern `<tagName>[\s\S]*?</tagName>` with case-insensitive matching
- Regex pattern strings starting with `/` (e.g., `"/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"`) SHALL be parsed as regular expressions with the specified flags

The `usePlugins()` composable SHALL compile all `displayStripTags` patterns from all loaded plugins into a single combined regex during plugin initialization, replacing the previous `plugin-loader.js` module-scoped compilation. The compiled regex and the `applyDisplayStrip()` function SHALL be exposed as typed TypeScript exports from the composable. The `applyDisplayStrip()` function SHALL accept a `string` parameter and return a `string` with all matching blocks removed. This function SHALL be consumed by the markdown rendering composable/utility during the rendering pipeline's strip phase.

#### Scenario: Plain tag name in displayStripTags
- **WHEN** a plugin declares `"displayStripTags": ["disclaimer"]` in its `plugin.json`
- **THEN** the frontend rendering pipeline SHALL remove all `<disclaimer>...</disclaimer>` blocks (case-insensitive) from the rendered output

#### Scenario: Regex pattern in displayStripTags
- **WHEN** a plugin declares `"displayStripTags": ["/<T-task\\b[^>]+>[\\s\\S]*?<\\/T-task>/g"]` in its `plugin.json`
- **THEN** the frontend rendering pipeline SHALL remove all blocks matching the regex pattern from the rendered output

#### Scenario: Multiple plugins contribute displayStripTags
- **WHEN** plugin A declares `"displayStripTags": ["imgthink"]` and plugin B declares `"displayStripTags": ["disclaimer"]`
- **THEN** both `<imgthink>...</imgthink>` and `<disclaimer>...</disclaimer>` blocks SHALL be removed from the rendered output

#### Scenario: Plugin with no displayStripTags
- **WHEN** a plugin does not declare `displayStripTags` in its `plugin.json`
- **THEN** that plugin SHALL not contribute any frontend strip patterns

#### Scenario: Invalid regex in displayStripTags
- **WHEN** a plugin declares a `displayStripTags` entry with `/` prefix but invalid regex syntax
- **THEN** the frontend SHALL skip that entry without crashing and process remaining entries normally

#### Scenario: Unsafe regex in displayStripTags (ReDoS)
- **WHEN** a plugin declares a `displayStripTags` regex pattern that exhibits catastrophic backtracking
- **THEN** the frontend SHALL detect the unsafe pattern via a probe test during compilation and skip the entry with a console warning

#### Scenario: applyDisplayStrip is a typed TypeScript function
- **WHEN** the `applyDisplayStrip()` function is inspected
- **THEN** it SHALL have a TypeScript signature of `(content: string) => string` and SHALL be exported from the `usePlugins()` composable or a dedicated utility module

#### Scenario: Compilation occurs in usePlugins composable
- **WHEN** the `usePlugins()` composable initializes after fetching plugin metadata
- **THEN** it SHALL compile all `displayStripTags` patterns into a combined regex, replacing the previous module-scoped compilation in `plugin-loader.js`

### Requirement: Backend API exposes displayStripTags

The `GET /api/plugins` endpoint SHALL include the `displayStripTags` array from each plugin's manifest in the response metadata. The backend SHALL pass through the raw string array without validation or compilation.

#### Scenario: Plugin metadata includes displayStripTags
- **WHEN** the frontend fetches `GET /api/plugins`
- **THEN** each plugin object in the response SHALL include a `displayStripTags` field containing the array from the plugin's manifest (or an empty array if not declared)

#### Scenario: Backend passes through patterns without validation
- **WHEN** a plugin declares `displayStripTags` with any string values
- **THEN** the backend SHALL include them verbatim in the API response without attempting regex compilation or validation
