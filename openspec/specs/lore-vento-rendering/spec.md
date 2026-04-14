# Lore Vento Rendering

## Purpose

Defines how lore passage content is rendered through the Vento template engine before being used as template variable values, enabling inter-lore references and core variable usage within passages.

## Requirements

### Requirement: Vento rendering of lore passage content

Lore passage content SHALL be rendered through the Vento template engine before being used as template variable values. This enables passages to use Vento syntax (e.g., `{{ lore_character }}`, `{{ series_name }}`) to reference other lore variables and core template variables within their content.

#### Scenario: Lore passage references another lore variable
- **WHEN** a lore passage tagged "scenario" contains `{{ lore_character }}` in its content and a passage tagged "character" exists with content "Alice the Brave"
- **THEN** the rendered `lore_scenario` variable SHALL contain "Alice the Brave" in place of the `{{ lore_character }}` reference

#### Scenario: Lore passage references a core variable
- **WHEN** a lore passage contains `{{ series_name }}` in its content and the current series is "fantasy"
- **THEN** the rendered passage content SHALL contain "fantasy" in place of the `{{ series_name }}` reference

#### Scenario: Plain passage without Vento syntax
- **WHEN** a lore passage contains no Vento template syntax (no `{{ }}` references)
- **THEN** the passage content SHALL be returned unchanged, identical to pre-rendering behavior

### Requirement: Two-pass rendering strategy

A two-pass rendering strategy SHALL be used for lore variable generation:
1. **First pass**: Collect all passage bodies and generate an initial set of lore variable names and raw concatenated values (used as the rendering context snapshot).
2. **Second pass**: Render each **individual passage body** through the Vento template engine using an **immutable snapshot** of the first-pass lore variables plus core variables (such as `series_name` and `story_name`). The snapshot SHALL NOT be modified during iteration — every passage sees the same first-pass context regardless of rendering order.
3. **After rendering**: Re-generate lore variables (`lore_all`, `lore_<tag>`) by concatenating the individually-rendered passage bodies (with separators and priority sorting as before).

This approach ensures that lore passages can reference other lore variables and core variables while avoiding the need for complex dependency resolution. Rendering per-passage (rather than per-variable) ensures that each passage is rendered in isolation and cross-references resolve to the raw first-pass content.

#### Scenario: Two-pass produces correct inter-lore references via per-passage rendering
- **WHEN** passage A (tagged "scenario") contains `The world of {{ series_name }}: {{ lore_character }}` and passage B (tagged "character") contains "Alice the Brave" and the current series is "fantasy"
- **THEN** the first pass produces raw `lore_scenario` = `The world of {{ series_name }}: {{ lore_character }}` and raw `lore_character` = "Alice the Brave"; the second pass renders passage A's body individually using the immutable first-pass snapshot, resolving it to "The world of fantasy: Alice the Brave"; passage B's body renders unchanged; lore variables are then re-generated from the rendered passage bodies

#### Scenario: Circular reference handling with immutable snapshot
- **WHEN** passage A (tagged "alpha") contains `{{ lore_beta }}` and passage B (tagged "beta") contains `{{ lore_alpha }}`
- **THEN** during the second pass, both passages are rendered against the same immutable first-pass snapshot: passage A resolves `{{ lore_beta }}` to passage B's raw content `{{ lore_alpha }}`, and passage B resolves `{{ lore_alpha }}` to passage A's raw content `{{ lore_beta }}` — both sides see the other's raw first-pass content because the snapshot is never modified during iteration; the system SHALL NOT enter an infinite loop or raise an error

#### Scenario: Core variables available during second pass
- **WHEN** a lore passage contains `{{ story_name }}` and the current story is "quest"
- **THEN** the second pass SHALL resolve `{{ story_name }}` to "quest" because core variables are included in the rendering context

### Requirement: Graceful error handling for rendering failures

Rendering errors in individual lore passages SHALL NOT prevent other passages from rendering successfully. When a passage fails to render through Vento (e.g., due to syntax errors or undefined variable references), the system SHALL use the raw (unrendered) passage content as a fallback for that individual passage. After all passages have been rendered (or fallen back), lore variables SHALL be re-generated from the resulting passage bodies — mixing rendered and raw content as needed.

#### Scenario: Rendering error in one passage does not break others
- **WHEN** passage A contains invalid Vento syntax `{{ invalid( }}` and passage B contains valid content "World rules"
- **THEN** `lore_all` SHALL contain the raw content of passage A (with the invalid syntax preserved) concatenated with the correctly rendered content of passage B

#### Scenario: Undefined variable reference falls back to raw content
- **WHEN** a lore passage contains `{{ nonexistent_var }}` which is not defined in the rendering context
- **THEN** the system SHALL fall back to the raw passage content for that passage rather than propagating the error

#### Scenario: All passages fail to render
- **WHEN** all lore passages contain rendering errors
- **THEN** all passages SHALL fall back to their raw content, and the lore variables SHALL still be generated with raw content — the system SHALL NOT fail entirely
