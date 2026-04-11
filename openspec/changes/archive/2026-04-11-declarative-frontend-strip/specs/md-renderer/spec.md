# MD Renderer

## MODIFIED Requirements

### Requirement: Hidden XML block removal

Before rendering, the system SHALL remove hidden XML blocks from chapter content that are not intended for display. This removal SHALL be performed by applying compiled `displayStripTags` patterns collected from all loaded plugins. The patterns SHALL be compiled once during plugin initialization and applied during the strip phase of the rendering pipeline, after `frontend-render` hooks and before quote normalization.

The stripping logic SHALL NOT use the hook dispatch system. Instead, it SHALL directly apply the pre-compiled regex patterns to the text content.

#### Scenario: Declarative strip tag removal
- **WHEN** plugins declare `displayStripTags` patterns (e.g., `["disclaimer", "user_message", "imgthink", "chapter_summary"]`) and a chapter contains `<disclaimer>...</disclaimer>` blocks
- **THEN** the rendering pipeline SHALL remove all matching blocks before markdown parsing

#### Scenario: Regex-based strip tag removal
- **WHEN** a plugin declares a regex pattern in `displayStripTags` (e.g., `"/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"`) and a chapter contains `<T-task type="hidden">...</T-task>` blocks
- **THEN** the rendering pipeline SHALL apply the regex to remove matching blocks

#### Scenario: No strip patterns declared
- **WHEN** no loaded plugins declare `displayStripTags`
- **THEN** the rendering pipeline SHALL skip the strip phase and proceed directly to quote normalization

#### Scenario: Strip phase ordering in pipeline
- **WHEN** the rendering pipeline processes chapter content
- **THEN** the strip phase SHALL execute after `frontend-render` hook dispatch and before quote normalization, maintaining the existing pipeline order: extract → render → strip → normalize → markdown → reinsertion → sanitize

### Requirement: Rendering pipeline

The rendering pipeline SHALL process chapter content in the following order:
1. **Extract**: Extract XML blocks targeted by `frontend-render` plugins (e.g., `<status>`, `<options>`, `<UpdateVariable>`) and replace with HTML comment placeholders
2. **Render**: Dispatch `frontend-render` hooks to transform extracted blocks into HTML components
3. **Strip**: Apply compiled `displayStripTags` patterns to remove hidden XML blocks from the text
4. **Normalize**: Apply quote normalization and newline doubling for markdown compatibility
5. **Markdown**: Parse through `marked.parse()` to convert markdown to HTML
6. **Reinsertion**: Replace HTML comment placeholders with rendered HTML components
7. **Sanitize**: Run DOMPurify to sanitize the final HTML output

#### Scenario: Full pipeline with render and strip plugins
- **WHEN** a chapter contains `<status>` blocks (rendered by status plugin), `<disclaimer>` blocks (stripped by threshold-lord), and regular markdown
- **THEN** the pipeline SHALL extract `<status>`, render it via `frontend-render`, strip `<disclaimer>`, parse remaining markdown, reinsert rendered `<status>` HTML, and sanitize the result
