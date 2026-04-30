# Markdown Renderer

## Purpose

Processes raw markdown chapter content through a multi-stage pipeline: XML block extraction, newline doubling, markdown-to-HTML conversion, hidden block removal, CJK text support, and placeholder reinsertion for specialist renderers. The pipeline preserves all Unicode quote characters verbatim — visual dialogue styling is delegated to plugins.

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

### Requirement: Quote character preservation

The renderer SHALL preserve every Unicode quote character emitted upstream (including but not limited to ASCII straight quotes `"`, curly quotes `"` `"`, guillemets `«` `»`, CJK corner quotes `「` `」`, half-width corner quotes `｢` `｣`, book title brackets `《` `》`, and the German low quote `„`) verbatim in the rendered HTML output. No stage of the rendering pipeline SHALL substitute one quote character for another. Visual styling of dialogue runs is the exclusive responsibility of plugins subscribing to the `chapter:render:after` hook.

#### Scenario: Original quote characters survive rendering
- **WHEN** a chapter's prose contains `「こんにちは」`, `«你好»`, `"Hello"`, `"World"`, `《書名》`, and `„unfinished`
- **THEN** the rendered HTML output SHALL contain those exact characters in the same positions and order; no quote character SHALL be substituted by any rendering stage

#### Scenario: Renderer ships no quote-substitution utility
- **WHEN** developers inspect `reader-src/src/lib/markdown-pipeline.ts`
- **THEN** the file SHALL NOT export a `normalizeQuotes` function (or any equivalent function whose effect is to rewrite Unicode quote characters into ASCII quotes), and `useMarkdownRenderer.renderChapter()` SHALL NOT call any such function during rendering

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

Each placeholder SHALL be reinserted as rendered HTML produced by the corresponding plugin's `frontend-render` hook handler. The rendered HTML is stored in `context.placeholderMap` (a `Map<string, string>` mapping placeholder comments to HTML strings) during `frontend-render` hook dispatch. After reinsertion, each placeholder's rendered HTML becomes part of the surrounding `html` token's `content` string. The core rendering pipeline SHALL NOT define or branch on plugin-specific token types (such as `status`, `options`, or `variable`) — plugin rendering is fully delegated to `frontend-render` hooks as described in the `plugin-hooks` spec.

The only non-HTML token type is `vento-error`, which represents template engine errors detected by the core renderer (not a plugin concern). The `RenderToken` union is therefore:
- `{ type: 'html', content: string }` — sanitized HTML segment (may contain plugin-rendered HTML after placeholder reinsertion), rendered via `v-html`
- `{ type: 'vento-error', data: VentoErrorCardProps }` — rendered as `<VentoErrorCard v-bind="token.data" />`

The parent component SHALL iterate over the token array using `v-for`, rendering HTML tokens with `v-html` on a `<div>` and vento-error tokens as `<VentoErrorCard>` Vue components with bound props.

#### Scenario: Rendered blocks appear in correct positions within HTML tokens
- **WHEN** a chapter contains prose, then a `<status>` block, then more prose, then an `<options>` block, and both tags have plugin-registered `frontend-render` handlers
- **THEN** the pipeline SHALL return a token array where plugin-rendered HTML is embedded within `html` tokens at the correct positions (the exact number of `html` tokens depends on whether adjacent plugin blocks merge into a single token)

#### Scenario: Plugin-rendered HTML is embedded via placeholderMap
- **WHEN** a `frontend-render` handler extracts a `<status>` block from `context.text` and adds a `placeholder → renderedHTML` entry to `context.placeholderMap`
- **THEN** the core pipeline SHALL reinsert the rendered HTML at the placeholder position and include it within the surrounding `html` token's content

#### Scenario: No plugin-specific token types exist
- **WHEN** the `RenderToken` type is inspected
- **THEN** it SHALL contain only `html` and `vento-error` variants — no `status`, `options`, `variable`, or other plugin-specific types SHALL be defined

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

### Requirement: npm package imports replace CDN globals
The rendering pipeline SHALL import `marked` and `dompurify` as npm package dependencies managed by the project's `package.json` (or `deno.json` import map). The former CDN script tags for `marked` and `DOMPurify` SHALL be removed from `index.html`. TypeScript type definitions SHALL be available for both packages.

#### Scenario: marked imported as npm package
- **WHEN** the rendering pipeline is initialized
- **THEN** `marked` SHALL be imported via `import { marked } from 'marked'` (or equivalent) and no `window.marked` global SHALL be referenced

#### Scenario: DOMPurify imported as npm package
- **WHEN** the rendering pipeline sanitizes HTML
- **THEN** `DOMPurify` SHALL be imported via `import DOMPurify from 'dompurify'` (or equivalent) and no `window.DOMPurify` global SHALL be referenced

### Requirement: Rendering output as RenderToken array
The rendering pipeline SHALL return a `RenderToken[]` array instead of a single HTML string. The pipeline SHALL NOT perform direct DOM manipulation (no `innerHTML` assignment). HTML prose segments (including plugin-rendered HTML after placeholder reinsertion) SHALL be rendered via `v-html` on individual `<div>` elements. Vento-error tokens SHALL be rendered as real Vue components with bound props. Plugin-specific blocks (status, options, variable) are rendered as HTML strings by plugins during `frontend-render` hook dispatch and embedded within `html` tokens — the core renderer does not instantiate Vue components for plugin content.

#### Scenario: Component renders token array
- **WHEN** a chapter is rendered by the pipeline
- **THEN** the Vue component SHALL iterate over the `RenderToken[]` array using `v-for`, rendering `{ type: 'html' }` tokens with `<div v-html="token.content"></div>` and `{ type: 'vento-error' }` tokens as `<VentoErrorCard>` components

#### Scenario: Plugin-rendered HTML is within html tokens
- **WHEN** a plugin's `frontend-render` handler produces a rendered options panel as HTML
- **THEN** that HTML SHALL appear within an `html` token's `content` string after placeholder reinsertion, not as a separate typed token

### Requirement: Plugin-settled ordering for renderChapter

`useMarkdownRenderer.renderChapter()` SHALL be invoked only by callers that have already verified plugin initialization has settled (`usePlugins().pluginsSettled.value === true`). The composable itself SHALL NOT block, await, or otherwise gate on plugin readiness; correctness is enforced by the caller (e.g. `ChapterContent.vue` mounted under a `v-if="pluginsSettled && currentContent"` guard in `ContentArea.vue`). When called with an empty `frontend-render` handler list (e.g. because plugin loading failed, or no plugins are installed), `renderChapter()` SHALL behave exactly as it does today: placeholders are not extracted and prose passes through markdown + DOMPurify.

#### Scenario: renderChapter is invoked only after plugins have settled
- **WHEN** the production reader is mounted with the readiness gate in place
- **THEN** every call to `renderChapter()` originating from `ChapterContent.vue` SHALL occur after `pluginsSettled.value` has flipped to `true`

#### Scenario: renderChapter still works without plugins
- **WHEN** `renderChapter()` is called and zero `frontend-render` handlers are registered
- **THEN** the function SHALL execute the existing "no plugins registered" path (no XML extraction, content passed through to markdown + DOMPurify) and return a valid `RenderToken[]` array

### Requirement: Token re-evaluation on input mutation

The `tokens` computed inside `ChapterContent.vue` SHALL re-evaluate whenever any of its tracked dependencies changes by Vue's reactivity rules: the markdown source backing `props.rawMarkdown` (i.e. `currentContent` in `useChapterNav`), `props.isLastChapter`, `chapters[currentIndex].stateDiff`, `pluginsReady.value`, and `renderEpoch.value` from `useChapterNav()`.

`useChapterNav()` SHALL ensure that whenever a chapter content value is committed by any load path — including the case where the new value is `===` (string-equal) to the existing `currentContent.value` — at least one of the following invalidations occurs:

- `currentContent` (a `shallowRef`) is invalidated via `triggerRef`, OR
- `renderEpoch` is incremented.

In practice the implementation SHALL do both, so that any computed or watch that reads either `currentContent` or `renderEpoch` re-runs. The contract is "the rendered chapter view is invalidated such that, the next time `ChapterContent` evaluates `tokens`, `renderChapter()` runs and `chapter:render:after` is dispatched for that render". The contract is not "fires exactly once" — Vue MAY skip evaluations when no consumer is mounted, and the spec tolerates that.

`renderEpoch` SHALL be monotonically non-decreasing and SHALL NOT be exposed for direct mutation outside `useChapterNav()`.

#### Scenario: Same-content reload still invalidates the rendered view
- **WHEN** a chapter is reloaded (e.g. after edit-save) and the new content is byte-identical to the previous `currentContent.value`
- **THEN** `useChapterNav()` SHALL invalidate the rendered view such that, when `ChapterContent` next renders, `renderChapter()` runs and `chapter:render:after` is dispatched at least once

#### Scenario: Different-content reload invalidates the rendered view
- **WHEN** a chapter is reloaded and the new content differs from the previous `currentContent.value`
- **THEN** `currentContent` SHALL be reassigned, `renderEpoch` SHALL be incremented, and the `tokens` computed in `ChapterContent.vue` SHALL re-evaluate at the next render

#### Scenario: pluginsReady transition triggers re-evaluation
- **WHEN** a component instance evaluated `tokens` while `pluginsReady.value === false`, and `pluginsReady.value` subsequently flips to `true`
- **THEN** the `tokens` computed SHALL re-evaluate at least once after the transition
