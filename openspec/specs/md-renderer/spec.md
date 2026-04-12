# Markdown Renderer

## Purpose

Processes raw markdown chapter content through a multi-stage pipeline: XML block extraction, quote normalisation, newline doubling, markdown-to-HTML conversion, hidden block removal, CJK text support, and placeholder reinsertion for specialist renderers.

## Requirements

### Requirement: XML block extraction before text processing

The rendering pipeline SHALL extract all recognized XML blocks from the raw markdown content before applying any text formatting. This logic SHALL be implemented as a `useMarkdownRenderer()` composable or a pure TypeScript utility function (e.g., `renderMarkdown()`). The list of recognized tag names SHALL be determined dynamically from the plugin tag handler registry. Each plugin that registers a `frontend-render` hook SHALL declare the tag names it handles. The pipeline SHALL query the registry for all registered tag names and extract matching blocks. Extracted blocks SHALL be replaced with placeholder tokens so that text transformations do not corrupt XML content.

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

### Requirement: Quote character normalisation
After XML block extraction, the renderer SHALL normalise all quote-like characters in the prose text. The characters `"`, `"`, `«`, `»`, `「`, `」`, `｢`, `｣`, `《`, `》`, and `"` SHALL all be replaced with the standard ASCII double-quote character `"`. This logic SHALL be implemented as a pure TypeScript utility function.

#### Scenario: Prose contains mixed quote characters
- **WHEN** the prose text contains `「こんにちは」` and `«你好»` and `"Hello"`
- **THEN** all quote-like characters SHALL be replaced with `"`, producing `"こんにちは"`, `"你好"`, and `"Hello"`

### Requirement: Newline doubling for markdown rendering
The renderer SHALL double all single newline characters (`\n`) in the prose text to `\n\n` so that markdown renderers treat each line break as a paragraph break. This logic SHALL be a pure TypeScript utility function.

#### Scenario: Single newlines become paragraph breaks
- **WHEN** the prose text contains `Line one.\nLine two.\nLine three.`
- **THEN** the output SHALL contain `Line one.\n\nLine two.\n\nLine three.` before being passed to the markdown-to-HTML converter

### Requirement: Markdown-to-HTML conversion
The renderer SHALL convert the processed prose text from markdown format to HTML using `marked` imported as an npm package dependency (via `import { marked } from 'marked'`) instead of a CDN global. Standard markdown features such as bold, italic, headings, and paragraphs MUST be supported.

#### Scenario: Markdown formatting is rendered as HTML
- **WHEN** the prose text contains `**bold text**` and `*italic text*`
- **THEN** the HTML output SHALL contain `<strong>bold text</strong>` and `<em>italic text</em>` respectively

### Requirement: Hidden XML block removal

XML blocks declared in a plugin's `displayStripTags` manifest field SHALL be completely removed from the rendered output. Their content MUST NOT be visible to the user in any form. The list of tags to strip SHALL be determined declaratively from plugin manifests via the `displayStripTags` field, rather than through hook handlers or a hardcoded list.

#### Scenario: Plugin-declared display strip tag is hidden
- **WHEN** the chapter contains a block matching a tag declared in a plugin's `displayStripTags` (e.g., `<imgthink>some internal note</imgthink>`)
- **THEN** the block and its content SHALL not appear in the rendered HTML output

#### Scenario: Multiple plugins declare display strip tags
- **WHEN** multiple plugins declare different tag names in `displayStripTags`
- **THEN** all declared tags SHALL be stripped from the rendered output

#### Scenario: No display strip tags declared
- **WHEN** no plugins have declared `displayStripTags` entries
- **THEN** no tags SHALL be stripped and all content passes through to rendering

### Requirement: Chinese and Japanese text rendering
The renderer SHALL correctly handle Chinese and Japanese Unicode characters throughout the entire processing pipeline. No text corruption or encoding issues SHALL occur with CJK content.

#### Scenario: CJK prose renders correctly
- **WHEN** the chapter prose contains mixed Chinese text `午後的陽光透過商店街` and Japanese text `こんにちは`
- **THEN** all characters SHALL render correctly in the HTML output without mojibake or character loss

### Requirement: Tokenized rendering output

After text transformations and markdown-to-HTML conversion, the pipeline SHALL split the result by placeholder positions and produce an array of `RenderToken` objects instead of a single HTML string. Each prose segment between placeholders SHALL become a `{ type: 'html', content: string }` token whose `content` is sanitized with `DOMPurify.sanitize()` using DOMPurify imported as an npm package dependency (via `import DOMPurify from 'dompurify'`) instead of a CDN global. The DOMPurify configuration SHALL preserve the existing `ADD_TAGS` and `ADD_ATTR` settings. The existing regex-based `<script>` tag removal SHALL be removed since DOMPurify handles script stripping comprehensively.

Each placeholder SHALL become a structured data token by looking up the tag name in the plugin tag handler registry and invoking the corresponding plugin parser to produce typed data. The token types SHALL be:
- `{ type: 'html', content: string }` — sanitized HTML segment rendered via `v-html`
- `{ type: 'status', data: StatusData }` — rendered as `<StatusBar :data="token.data" />`
- `{ type: 'options', data: OptionItem[] }` — rendered as `<OptionsPanel :items="token.data" />`
- `{ type: 'variable', data: { content: string, isComplete: boolean } }` — rendered as `<VariableDisplay />`
- `{ type: 'vento-error', data: VentoErrorData }` — rendered as `<VentoErrorCard />`

The parent component SHALL iterate over the token array using `v-for`, rendering HTML tokens with `v-html` on a `<div>` and custom block tokens as their respective Vue components with bound props. This enables Vue reactivity (events, props, emits) for custom blocks while keeping efficient HTML rendering for prose content.

#### Scenario: Rendered blocks appear in correct positions as tokens
- **WHEN** a chapter contains prose, then a `<status>` block, then more prose, then an `<options>` block, and both tags have plugin-registered renderers
- **THEN** the pipeline SHALL return a token array `[{ type: 'html', ... }, { type: 'status', ... }, { type: 'html', ... }, { type: 'options', ... }]` preserving the original document order

#### Scenario: Plugin parser invoked for each extracted block
- **WHEN** a placeholder is encountered during token construction
- **THEN** the pipeline SHALL look up the tag name in the plugin registry, invoke the registered parser with the extracted block content, and produce a typed data token (not HTML) at the placeholder position

#### Scenario: No renderer registered for extracted block
- **WHEN** a placeholder references a tag name with no registered plugin renderer
- **THEN** the pipeline SHALL omit the block from the token array and log a warning

#### Scenario: DOMPurify sanitizes HTML tokens
- **WHEN** the rendering pipeline produces HTML tokens from prose segments
- **THEN** `DOMPurify.sanitize()` SHALL be called with the existing `ADD_TAGS` and `ADD_ATTR` configuration on each HTML segment individually before it is included in the token array

#### Scenario: XSS via event handler attributes is blocked
- **WHEN** chapter content contains `<img src=x onerror="alert(1)">` or `<div onmouseover="steal()">`
- **THEN** DOMPurify SHALL strip the event handler attributes, rendering the tags inert

#### Scenario: XSS via script tag is blocked
- **WHEN** chapter content contains `<script>alert(document.cookie)</script>`
- **THEN** DOMPurify SHALL remove the entire `<script>` element from the output

#### Scenario: Legitimate HTML preserved after sanitization
- **WHEN** chapter content contains safe HTML like `<strong>bold</strong>`, `<em>italic</em>`, `<p>paragraph</p>`
- **THEN** DOMPurify SHALL preserve these elements in the sanitized HTML tokens

#### Scenario: Regex-based script removal is eliminated
- **WHEN** the rendering pipeline processes chapter content
- **THEN** no regex-based `<script>` stripping logic SHALL exist; DOMPurify handles all script removal

#### Scenario: Custom block tokens enable Vue component features
- **WHEN** the parent component renders a `{ type: 'options', data: [...] }` token
- **THEN** it SHALL instantiate `<OptionsPanel>` as a real Vue component with bound props and event listeners (e.g., `@optionSelected`), enabling full Vue reactivity that `v-html` cannot provide

### Requirement: Plugin tag handler registration API

The markdown renderer SHALL expose a registration API that allows plugins to register tag handlers. The API SHALL accept the following registration parameters: `tagName` (string), `type` (enum: `render` or `strip`), and `handler` (function; required for `render` type). For `render` type handlers, the handler function SHALL return a structured data object (parsed props) suitable for constructing a `RenderToken`, rather than an HTML string. A plugin MAY register multiple tag names. Registrations SHALL be stored in an internal registry keyed by tag name.

The registration API SHALL be callable during plugin initialization (before any content is rendered). Duplicate tag name registrations SHALL log a warning and the later registration SHALL overwrite the earlier one.

In the Vue architecture, this registry SHALL be accessible via the plugin composable or a shared module so that both the rendering pipeline and plugin initialization can interact with it.

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

### Requirement: npm package imports replace CDN globals
The rendering pipeline SHALL import `marked` and `dompurify` as npm package dependencies managed by the project's `package.json` (or `deno.json` import map). The former CDN script tags for `marked` and `DOMPurify` SHALL be removed from `index.html`. TypeScript type definitions SHALL be available for both packages.

#### Scenario: marked imported as npm package
- **WHEN** the rendering pipeline is initialized
- **THEN** `marked` SHALL be imported via `import { marked } from 'marked'` (or equivalent) and no `window.marked` global SHALL be referenced

#### Scenario: DOMPurify imported as npm package
- **WHEN** the rendering pipeline sanitizes HTML
- **THEN** `DOMPurify` SHALL be imported via `import DOMPurify from 'dompurify'` (or equivalent) and no `window.DOMPurify` global SHALL be referenced

### Requirement: Rendering output as RenderToken array
The rendering pipeline SHALL return a `RenderToken[]` array instead of a single HTML string. The pipeline SHALL NOT perform direct DOM manipulation (no `innerHTML` assignment). HTML prose segments SHALL be rendered via `v-html` on individual `<div>` elements, while custom block tokens SHALL be rendered as real Vue components with bound props and emits. This hybrid approach ensures prose content is efficiently rendered as HTML while custom blocks retain full Vue reactivity (event handling, props binding, scoped slots).

#### Scenario: Component renders token array
- **WHEN** a chapter is rendered by the pipeline
- **THEN** the Vue component SHALL iterate over the `RenderToken[]` array using `v-for`, rendering `{ type: 'html' }` tokens with `<div v-html="token.content"></div>` and custom block tokens as their corresponding Vue components (e.g., `<StatusBar>`, `<OptionsPanel>`)

#### Scenario: Vue events work on custom block components
- **WHEN** an `<OptionsPanel>` component is rendered from a `{ type: 'options' }` token
- **THEN** the parent component SHALL be able to listen for `@optionSelected` events emitted by the component, which would be impossible if the panel were injected as an HTML string via `v-html`
