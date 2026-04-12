## MODIFIED Requirements

### Requirement: Tokenized rendering output

After text transformations and markdown-to-HTML conversion, the pipeline SHALL split the result by placeholder positions and produce an array of `RenderToken` objects instead of a single HTML string. Each prose segment between placeholders SHALL become a `{ type: 'html', content: string }` token whose `content` is sanitized with `DOMPurify.sanitize()` using DOMPurify imported as an npm package dependency (via `import DOMPurify from 'dompurify'`) instead of a CDN global. The DOMPurify configuration SHALL preserve the existing `ADD_TAGS` and `ADD_ATTR` settings. The existing regex-based `<script>` tag removal SHALL be removed since DOMPurify handles script stripping comprehensively.

Each placeholder SHALL be reinserted as rendered HTML produced by the corresponding plugin's `frontend-render` hook handler. The rendered HTML is stored in `context.placeholderMap` (a `Map<string, string>` mapping placeholder comments to HTML strings) during `frontend-render` hook dispatch. After reinsertion, each placeholder's rendered HTML becomes part of the surrounding `html` token's `content` string. The core rendering pipeline SHALL NOT define or branch on plugin-specific token types (such as `status`, `options`, or `variable`) — plugin rendering is fully delegated to `frontend-render` hooks as described in the `plugin-hooks` spec.

The only non-HTML token type is `vento-error`, which represents template engine errors detected by the core renderer (not a plugin concern). The `RenderToken` union is therefore:
- `{ type: 'html', content: string }` — sanitized HTML segment (may contain plugin-rendered HTML after placeholder reinsertion), rendered via `v-html`
- `{ type: 'vento-error', data: VentoErrorData }` — rendered as `<VentoErrorCard v-bind="token.data" />`

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

### Requirement: Rendering output as RenderToken array
The rendering pipeline SHALL return a `RenderToken[]` array instead of a single HTML string. The pipeline SHALL NOT perform direct DOM manipulation (no `innerHTML` assignment). HTML prose segments (including plugin-rendered HTML after placeholder reinsertion) SHALL be rendered via `v-html` on individual `<div>` elements. Vento-error tokens SHALL be rendered as real Vue components with bound props. Plugin-specific blocks (status, options, variable) are rendered as HTML strings by plugins during `frontend-render` hook dispatch and embedded within `html` tokens — the core renderer does not instantiate Vue components for plugin content.

#### Scenario: Component renders token array
- **WHEN** a chapter is rendered by the pipeline
- **THEN** the Vue component SHALL iterate over the `RenderToken[]` array using `v-for`, rendering `{ type: 'html' }` tokens with `<div v-html="token.content"></div>` and `{ type: 'vento-error' }` tokens as `<VentoErrorCard>` components

#### Scenario: Plugin-rendered HTML is within html tokens
- **WHEN** a plugin's `frontend-render` handler produces a rendered options panel as HTML
- **THEN** that HTML SHALL appear within an `html` token's `content` string after placeholder reinsertion, not as a separate typed token

## REMOVED Requirements

### Requirement: Plugin tag handler registration API
**Reason**: This requirement described a separate registration API for tag handlers within the md-renderer. In the implementation, plugins register via the `frontend-render` hook from the `plugin-hooks` spec, mutating `context.text` and `context.placeholderMap` directly. There is no separate md-renderer registration API. The `plugin-hooks` spec is the authoritative source for plugin registration.
**Migration**: Plugin registration is fully described by the `plugin-hooks` spec's `frontend-render` hook stage. No code changes needed — the implementation already uses this pattern.
