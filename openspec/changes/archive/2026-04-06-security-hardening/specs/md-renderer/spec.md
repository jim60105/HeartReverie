# Markdown Renderer

## MODIFIED Requirements

### Requirement: Placeholder reinsertion
After text transformations and markdown-to-HTML conversion, the pipeline SHALL replace placeholder tokens with the rendered output from specialist renderers (status bar HTML, options panel HTML, variable display HTML). After placeholder reinsertion, the final HTML SHALL be sanitized with `DOMPurify.sanitize()` before DOM insertion. The existing regex-based `<script>` tag removal SHALL be removed since DOMPurify handles script stripping comprehensively. The final output SHALL be a single sanitized HTML fragment ready for safe `innerHTML` assignment.

#### Scenario: Rendered blocks appear in correct positions
- **WHEN** a chapter contains prose, then a `<status>` block, then more prose, then an `<options>` block
- **THEN** the final HTML SHALL contain the prose HTML, followed by the rendered status bar, followed by more prose HTML, followed by the rendered options panel, in the original document order

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
