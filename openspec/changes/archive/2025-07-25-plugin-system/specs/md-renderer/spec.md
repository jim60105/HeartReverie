# Markdown Renderer — Plugin System Delta

## MODIFIED Requirements

### Requirement: XML block extraction before text processing

The rendering pipeline SHALL extract all recognized XML blocks from the raw markdown content before applying any text formatting. The list of recognized tag names SHALL be determined dynamically from the plugin tag handler registry, rather than a hardcoded list. Each plugin that registers a `frontend-render` hook SHALL declare the tag names it handles (e.g., `status`, `options`, `UpdateVariable`). The pipeline SHALL query the registry for all registered tag names and extract matching blocks. Extracted blocks SHALL be replaced with placeholder tokens so that text transformations do not corrupt XML content.

If no plugins are registered, the pipeline SHALL extract no XML blocks and pass all content through as prose.

#### Scenario: Markdown with mixed prose and plugin-registered XML blocks
- **WHEN** a chapter contains prose text interspersed with XML blocks whose tag names are registered by plugins (e.g., `<status>`, `<options>`, `<UpdateVariable>`)
- **THEN** the pipeline SHALL extract each XML block intact, leaving placeholder tokens in the prose, and pass extracted blocks to their respective plugin-registered renderers

#### Scenario: Unregistered XML tags are not extracted
- **WHEN** a chapter contains an XML block with a tag name that no plugin has registered (e.g., `<custom-unknown>`)
- **THEN** the pipeline SHALL NOT extract that block and it SHALL be treated as prose content

#### Scenario: No plugins registered
- **WHEN** no plugins have registered `frontend-render` handlers
- **THEN** the pipeline SHALL extract no XML blocks and all content SHALL pass through text processing as prose

### Requirement: Hidden XML block removal

XML blocks registered in the `frontend-strip` hook stage SHALL be completely removed from the rendered output. Their content MUST NOT be visible to the user in any form. The list of tags to strip SHALL be determined dynamically from plugins that register `frontend-strip` handlers, rather than a hardcoded list of `<imgthink>` and `<disclaimer>`.

#### Scenario: Plugin-registered strip tag is hidden
- **WHEN** the chapter contains a block matching a tag registered in the `frontend-strip` hook (e.g., `<imgthink>some internal note</imgthink>`)
- **THEN** the block and its content SHALL not appear in the rendered HTML output

#### Scenario: Multiple plugins register strip tags
- **WHEN** multiple plugins register different tag names in the `frontend-strip` hook (e.g., one registers `imgthink`, another registers `disclaimer`)
- **THEN** all registered tags SHALL be stripped from the rendered output

#### Scenario: No strip tags registered
- **WHEN** no plugins have registered `frontend-strip` handlers
- **THEN** no tags SHALL be stripped and all content passes through to rendering

### Requirement: Placeholder reinsertion

After text transformations and markdown-to-HTML conversion, the pipeline SHALL replace placeholder tokens with the rendered output from plugin-registered renderers. The pipeline SHALL look up each placeholder's tag name in the plugin tag handler registry and invoke the corresponding plugin renderer to produce the HTML. After placeholder reinsertion, the final HTML SHALL be sanitized with `DOMPurify.sanitize()` before DOM insertion. The existing regex-based `<script>` tag removal SHALL be removed since DOMPurify handles script stripping comprehensively. The final output SHALL be a single sanitized HTML fragment ready for safe `innerHTML` assignment.

#### Scenario: Rendered blocks appear in correct positions
- **WHEN** a chapter contains prose, then a `<status>` block, then more prose, then an `<options>` block, and both tags have plugin-registered renderers
- **THEN** the final HTML SHALL contain the prose HTML, followed by the plugin-rendered status bar, followed by more prose HTML, followed by the plugin-rendered options panel, in the original document order

#### Scenario: Plugin renderer invoked for each extracted block
- **WHEN** a placeholder token is encountered during reinsertion
- **THEN** the pipeline SHALL look up the tag name in the plugin registry, invoke the registered renderer with the extracted block content, and insert the returned HTML at the placeholder position

#### Scenario: No renderer registered for extracted block
- **WHEN** a placeholder token references a tag name with no registered plugin renderer
- **THEN** the pipeline SHALL omit the block from the output and log a warning

#### Scenario: DOMPurify sanitizes final HTML
- **WHEN** the rendering pipeline has completed placeholder reinsertion and produces the final HTML string
- **THEN** `DOMPurify.sanitize()` SHALL be called on the complete HTML string before it is assigned to `innerHTML`

#### Scenario: XSS via event handler attributes is blocked
- **WHEN** chapter content contains `<img src=x onerror="alert(1)">` or `<div onmouseover="steal()">`
- **THEN** DOMPurify SHALL strip the event handler attributes, rendering the tags inert

#### Scenario: XSS via script tag is blocked
- **WHEN** chapter content contains `<script>alert(document.cookie)</script>`
- **THEN** DOMPurify SHALL remove the entire `<script>` element from the output

#### Scenario: Legitimate HTML preserved after sanitization
- **WHEN** chapter content contains safe HTML like `<strong>bold</strong>`, `<em>italic</em>`, `<p>paragraph</p>`
- **THEN** DOMPurify SHALL preserve these elements in the sanitized output

#### Scenario: Regex-based script removal is eliminated
- **WHEN** the rendering pipeline processes chapter content
- **THEN** no regex-based `<script>` stripping logic SHALL exist; DOMPurify handles all script removal

## ADDED Requirements

### Requirement: Plugin tag handler registration API

The markdown renderer SHALL expose a registration API that allows plugins to register tag handlers. The API SHALL accept the following registration parameters: `tagName` (string, the XML tag to handle), `type` (enum: `render` or `strip`), and `handler` (function, invoked with the extracted block content, returns rendered HTML; required for `render` type, not used for `strip` type). A plugin MAY register multiple tag names. Registrations SHALL be stored in an internal registry keyed by tag name.

The registration API SHALL be callable during plugin initialization (before any content is rendered). Duplicate tag name registrations SHALL log a warning and the later registration SHALL overwrite the earlier one.

#### Scenario: Plugin registers a render tag handler
- **WHEN** a plugin calls the registration API with `{ tagName: 'status', type: 'render', handler: renderStatusFn }`
- **THEN** the registry SHALL store the handler and the `<status>` tag SHALL be recognized during XML block extraction

#### Scenario: Plugin registers a strip tag handler
- **WHEN** a plugin calls the registration API with `{ tagName: 'imgthink', type: 'strip' }`
- **THEN** the registry SHALL store the strip entry and `<imgthink>` blocks SHALL be removed during hidden block removal

#### Scenario: Duplicate tag name registration
- **WHEN** two plugins register handlers for the same tag name
- **THEN** the renderer SHALL log a warning and the second registration SHALL overwrite the first

#### Scenario: Registration after rendering has started
- **WHEN** a plugin attempts to register a tag handler after the first render call has occurred
- **THEN** the registration SHALL still succeed and SHALL apply to subsequent render calls
