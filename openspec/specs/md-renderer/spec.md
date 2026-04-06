# Markdown Renderer

## Purpose

Processes raw markdown chapter content through a multi-stage pipeline: XML block extraction, quote normalisation, newline doubling, markdown-to-HTML conversion, hidden block removal, CJK text support, and placeholder reinsertion for specialist renderers.

## Requirements

### Requirement: XML block extraction before text processing
The rendering pipeline SHALL extract all recognized XML blocks (`<status>`, `<options>`, `<UpdateVariable>`, `<imgthink>`, `<disclaimer>`) from the raw markdown content before applying any text formatting. Extracted blocks SHALL be replaced with placeholder tokens so that text transformations do not corrupt XML content.

#### Scenario: Markdown with mixed prose and XML blocks
- **WHEN** a chapter contains prose text interspersed with `<status>`, `<options>`, and `<UpdateVariable>` blocks
- **THEN** the pipeline SHALL extract each XML block intact, leaving placeholder tokens in the prose, and pass extracted blocks to their respective specialist renderers

### Requirement: Quote character normalisation
After XML block extraction, the renderer SHALL normalise all quote-like characters in the prose text. The characters `"`, `"`, `«`, `»`, `「`, `」`, `｢`, `｣`, `《`, `》`, and `"` SHALL all be replaced with the standard ASCII double-quote character `"`.

#### Scenario: Prose contains mixed quote characters
- **WHEN** the prose text contains `「こんにちは」` and `«你好»` and `"Hello"`
- **THEN** all quote-like characters SHALL be replaced with `"`, producing `"こんにちは"`, `"你好"`, and `"Hello"`

### Requirement: Newline doubling for markdown rendering
The renderer SHALL double all single newline characters (`\n`) in the prose text to `\n\n` so that markdown renderers treat each line break as a paragraph break.

#### Scenario: Single newlines become paragraph breaks
- **WHEN** the prose text contains `Line one.\nLine two.\nLine three.`
- **THEN** the output SHALL contain `Line one.\n\nLine two.\n\nLine three.` before being passed to the markdown-to-HTML converter

### Requirement: Markdown-to-HTML conversion
The renderer SHALL convert the processed prose text from markdown format to HTML. Standard markdown features such as bold, italic, headings, and paragraphs MUST be supported.

#### Scenario: Markdown formatting is rendered as HTML
- **WHEN** the prose text contains `**bold text**` and `*italic text*`
- **THEN** the HTML output SHALL contain `<strong>bold text</strong>` and `<em>italic text</em>` respectively

### Requirement: Hidden XML block removal
The XML blocks `<imgthink>...</imgthink>` and `<disclaimer>...</disclaimer>` SHALL be completely removed from the rendered output. Their content MUST NOT be visible to the user in any form.

#### Scenario: imgthink block is hidden
- **WHEN** the chapter contains an `<imgthink>some internal note</imgthink>` block
- **THEN** the block and its content SHALL not appear in the rendered HTML output

#### Scenario: disclaimer block is hidden
- **WHEN** the chapter contains a `<disclaimer>disclaimer text</disclaimer>` block
- **THEN** the block and its content SHALL not appear in the rendered HTML output

### Requirement: Chinese and Japanese text rendering
The renderer SHALL correctly handle Chinese and Japanese Unicode characters throughout the entire processing pipeline. No text corruption or encoding issues SHALL occur with CJK content.

#### Scenario: CJK prose renders correctly
- **WHEN** the chapter prose contains mixed Chinese text `午後的陽光透過商店街` and Japanese text `こんにちは`
- **THEN** all characters SHALL render correctly in the HTML output without mojibake or character loss

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
