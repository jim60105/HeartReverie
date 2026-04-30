## ADDED Requirements

### Requirement: Plugin manifest and assets

The repository SHALL ship a built-in plugin at `plugins/dialogue-colorize/` whose `plugin.json` declares:
- `"name": "dialogue-colorize"` (matching the directory name exactly).
- `"type": "frontend-only"` (the type already used by other frontend-module-with-CSS built-in plugins such as `response-notify`).
- `"frontendModule": "./frontend.js"` pointing at a frontend ES module that registers the `chapter:dom:ready` handler.
- `"frontendStyles"` containing at least `"./styles.css"`.
- No `tags`, no `displayStripTags`, no `promptFragments`, no `backendModule`.

The plugin directory SHALL contain `plugin.json`, `frontend.js`, `styles.css`, and `README.md` (Traditional Chinese user documentation).

#### Scenario: Plugin loads cleanly under standard plugin discovery
- **WHEN** the server boots with the default plugin directory and no `PLUGIN_DIR` override
- **THEN** the `PluginManager` SHALL discover `dialogue-colorize`, validate its manifest without error, register `./styles.css` for static serving at `/plugins/dialogue-colorize/styles.css`, and expose `./frontend.js` for the frontend module loader

#### Scenario: Manifest omits non-applicable fields
- **WHEN** an operator inspects `plugins/dialogue-colorize/plugin.json`
- **THEN** the file SHALL NOT declare `tags`, `displayStripTags`, `promptFragments`, or `backendModule`, and the loader SHALL still consider the plugin valid

### Requirement: DOM-preserving highlight contract

The plugin SHALL paint dialogue runs exclusively through the CSS Custom Highlight API (`CSS.highlights` registry + `Highlight` instances + `Range` objects). The plugin SHALL NOT mutate the DOM in any way: it SHALL NOT insert, remove, replace, or reorder elements; SHALL NOT modify text content of existing nodes; SHALL NOT call `innerHTML`, `outerHTML`, `textContent =`, `replaceWith`, or any equivalent mutation API on nodes inside the chapter container; SHALL NOT mutate `tok.content` of any `RenderToken`. The only state the plugin maintains is its own `Highlight` instances registered on `CSS.highlights` and a `WeakMap<HTMLElement, Range[]>` for cleanup bookkeeping.

#### Scenario: DOM tree is byte-identical before and after dispatch
- **WHEN** a chapter container's DOM tree is serialised via `container.outerHTML` before and after the plugin's `chapter:dom:ready` handler runs
- **THEN** the two serialisations SHALL be identical (no element insertions, no attribute changes, no text changes)

#### Scenario: Copy and paste yield original characters
- **WHEN** a user selects a coloured dialogue run (e.g., `「你好」`) in the rendered chapter and copies it to the clipboard
- **THEN** the clipboard contents SHALL be the original characters (`「你好」`) with no `<span>` wrappers or HTML entity replacements

### Requirement: Frontend hook subscription

The plugin's frontend module SHALL export a `register(hooks, context)` function that subscribes:
- exactly one handler to the `chapter:dom:ready` hook stage at default priority (`100`); and
- exactly one handler to the `chapter:dom:dispose` hook stage at default priority (`100`) that releases container-keyed range bookkeeping for the disposed container.

The signature SHALL match the dispatcher used by `usePlugins.ts` (`mod.register(frontendHooks, ctx)` where the first argument is the dispatcher itself). The plugin SHALL NOT subscribe to `chapter:render:after` and SHALL NOT modify any token's `.content`.

#### Scenario: Single handler registered on each correct stage
- **WHEN** the frontend bundle loads and `usePlugins` calls `mod.register(frontendHooks, …)`
- **THEN** the plugin SHALL call `hooks.register("chapter:dom:ready", handler)` exactly once AND `hooks.register("chapter:dom:dispose", handler)` exactly once, and SHALL NOT register on `chapter:render:after` or any other stage

#### Scenario: Dispose handler clears container ranges
- **WHEN** the plugin's `chapter:dom:dispose` handler is invoked with a previously-known container
- **THEN** the plugin SHALL remove every prior `Range` for that container from each suffix's `Highlight`, clear the WeakMap entry, and produce no further state for that container

### Requirement: Browser-support feature detection and fallback

At plugin module load time, the plugin SHALL feature-detect the CSS Custom Highlight API by checking that `globalThis.CSS` is an object with a `highlights` property AND that `globalThis.Highlight` is a constructor function. When the API is missing, the plugin's `register()` SHALL skip subscribing the handler and SHALL emit one informational log line via the `PluginRegisterContext.logger` indicating the no-op fallback is active. The plugin SHALL NOT throw, SHALL NOT block other plugins from loading, and SHALL NOT break rendering.

#### Scenario: API present — handler registers
- **WHEN** the plugin loads in a browser where `CSS.highlights` and `Highlight` are defined
- **THEN** the handler SHALL be registered on `chapter:dom:ready` and the plugin SHALL operate normally

#### Scenario: API absent — graceful no-op
- **WHEN** the plugin loads in a browser where `CSS.highlights` or `Highlight` is undefined
- **THEN** the plugin SHALL log one informational message (not warn or error), SHALL NOT register any hook handler, and the rendered chapter SHALL display correctly with original quote characters but without dialogue colour

### Requirement: Quote pair set, regex, and Highlight registry naming

The plugin SHALL recognise exactly the following quote pairs, mapped to the listed CSS class suffix and `CSS.highlights` registry name:

| Opener | Closer | Suffix | Registry name |
|--------|--------|--------|---------------|
| `"` (U+0022, ASCII straight) | `"` (U+0022) | `straight` | `dialogue-quote-straight` |
| `"` (U+201C) | `"` (U+201D) | `curly` | `dialogue-quote-curly` |
| `«` (U+00AB) | `»` (U+00BB) | `guillemet` | `dialogue-quote-guillemet` |
| `「` (U+300C) | `」` (U+300D) | `corner` | `dialogue-quote-corner` |
| `｢` (U+FF62) | `｣` (U+FF63) | `corner-half` | `dialogue-quote-corner-half` |
| `《` (U+300A) | `》` (U+300B) | `book` | `dialogue-quote-book` |

For symmetric pairs (ASCII straight only), the regex SHALL consume opener…body…closer with first-quote-is-opener convention (`/"([^"\n]+?)"/g`). For asymmetric pairs the regex SHALL be `/<open>([^<close>\n]+?)<close>/g`. Body length MUST be ≥1; empty pairs SHALL NOT produce a range. The German low quote `„` (U+201E), the white square brackets `『…』`, and any other Unicode quote not listed in the table SHALL NOT be highlighted (deferred to a future change).

#### Scenario: Each supported pair produces a range under its registry name
- **WHEN** an `html` chapter container's text contains every supported pair, e.g. `"a" "b" «c» 「d」 ｢e｣ 《f》` separated by spaces
- **THEN** each pair SHALL contribute one `Range` to the corresponding registry (`dialogue-quote-straight` … `dialogue-quote-book`); after the handler returns, each named `Highlight` SHALL contain the expected number of ranges

#### Scenario: Lone low quote produces no range
- **WHEN** the chapter contains `„unfinished` (U+201E, no closer)
- **THEN** no `Highlight` SHALL receive a range for that text and the original `„` SHALL render normally

#### Scenario: Empty pair body produces no range
- **WHEN** the chapter contains `「」` or `""` with no characters between opener and closer
- **THEN** no `Highlight` SHALL receive a range for that empty pair

### Requirement: Match resolution

The handler SHALL resolve overlapping candidate matches deterministically using leftmost-longest single-pass scanning: for each text node visited via the TreeWalker, collect every candidate match across all six pairs, sort by start index ascending and by length descending on ties, then sweep left-to-right keeping each match whose start is ≥ the previous kept match's end and discarding any that overlap.

#### Scenario: Two non-overlapping ASCII pairs both yield ranges
- **WHEN** a text node contains `"foo" bar "baz"`
- **THEN** the `dialogue-quote-straight` Highlight SHALL receive two ranges, one covering `"foo"` and one covering `"baz"`

#### Scenario: Nested pair of supported types yields outer-only range
- **WHEN** a text node contains `「outer "inner" outer」` (inner ASCII straight pair fully contained inside outer corner pair)
- **THEN** exactly one range SHALL be added to `dialogue-quote-corner` covering the entire `「outer "inner" outer」` run; the inner ASCII pair SHALL NOT produce its own range because its match overlaps the outer match

### Requirement: TreeWalker traversal and ancestor exclusion

The handler SHALL walk text nodes inside the dispatch context's `container` element via `document.createTreeWalker(container, NodeFilter.SHOW_TEXT, …)`. The TreeWalker filter SHALL skip text nodes whose ancestor chain (between the text node and the container, exclusive of the container itself) includes any of `<code>`, `<pre>`, `<kbd>`, or `<samp>`. The handler SHALL NOT use a regex over the container's `innerHTML` or any equivalent string-based scan that could inspect attribute values.

#### Scenario: Quote characters inside attribute values do not produce ranges
- **WHEN** the chapter container includes `<a href="?q=「foo」" title="say 「bar」">「baz」</a>`
- **THEN** the `dialogue-quote-corner` Highlight SHALL contain exactly one range covering the visible text `「baz」`; no range SHALL cover any portion of the `href` or `title` attribute strings

#### Scenario: Quote run that spans an element boundary does not yield a range
- **WHEN** the chapter container includes `「foo<br>bar」` (opener and closer in different text nodes)
- **THEN** no range SHALL be added to any Highlight for that pair (neither the opener-side text node nor the closer-side text node contains both opener and closer)

#### Scenario: Code blocks are excluded
- **WHEN** the chapter container includes `<p>外面「對話」</p><pre><code>"code with quotes"</code></pre>`
- **THEN** the visible text `「對話」` outside the code block SHALL contribute one range to `dialogue-quote-corner`; no range SHALL be added for the ASCII quotes inside the `<code>` element

### Requirement: Highlight registry lifecycle

The plugin SHALL maintain six module-scoped `Highlight` instances (one per suffix), created lazily on first dispatch and registered exactly once with `CSS.highlights.set(name, highlight)` per name. The plugin SHALL track per-container ranges via a `WeakMap<HTMLElement, Range[]>` keyed by the dispatch context's `container`. On every `chapter:dom:ready` dispatch:

1. Look up the WeakMap entry for `container`. For each previously-stored range, call `highlight.delete(range)` on the appropriate suffix's `Highlight` instance.
2. Walk the container with the TreeWalker, compute fresh ranges using the leftmost-longest rule, and add each one to the appropriate suffix's `Highlight` via `highlight.add(range)`.
3. Replace the WeakMap entry for `container` with the freshly-collected range list.

#### Scenario: Re-render of same container clears stale ranges
- **WHEN** a chapter is rendered, then the user edits and cancels (causing a render-epoch bump and a fresh dispatch with a new container reference) — OR the user edits a chapter and re-saves it (causing the same container to receive new tokens)
- **THEN** ranges from the prior dispatch SHALL be removed from the relevant `Highlight` instances before new ranges are added; the plugin SHALL NOT accumulate stale ranges that could paint detached or moved DOM positions

#### Scenario: Multiple chapter containers coexist
- **WHEN** the reader displays two chapters simultaneously (each with its own `ChapterContent` instance and its own dispatched `chapter:dom:ready`)
- **THEN** each container's ranges SHALL coexist in the same global `Highlight` instances; ranges from one container SHALL NOT be deleted when the other container is re-dispatched

### Requirement: CSS surface

`plugins/dialogue-colorize/styles.css` SHALL define `::highlight()` rules for every registry name listed in the pair table, applying `color: var(--dialogue-color, <theme-default>)`. The fallback colour SHALL pass WCAG AA contrast against the reader's main background. The CSS SHALL NOT use any `::highlight()` selector for unsupported pairs and SHALL NOT include element-tagged selectors that would assume a wrapper `<span>` exists.

#### Scenario: Default colour applies to all six registry names
- **WHEN** the plugin's CSS is loaded and any of the six registries has at least one range
- **THEN** the painted ranges SHALL receive a non-default text colour distinct from the surrounding paragraph colour

#### Scenario: Theme override via CSS custom property
- **WHEN** a downstream stylesheet sets `--dialogue-color: red` on `body` or any chapter ancestor element
- **THEN** painted ranges inside that element SHALL pick up the overridden colour without further CSS changes

### Requirement: Storage and wire-format invariance

Installing or uninstalling the plugin SHALL NOT change chapter `.md` file contents on disk, the prompt sent to the LLM, the JSON/Markdown/plain-text export output, or the chapter content streamed from the backend over WebSocket or SSE. The plugin's effect SHALL be confined to the painted highlights of the rendered chapter container in the reader UI.

#### Scenario: Disk content unchanged
- **WHEN** the user reads a chapter containing `「對話」`, then disables the plugin and reads it again
- **THEN** the underlying `.md` file SHALL contain `「對話」` byte-identical in both states

#### Scenario: Export output unchanged
- **WHEN** the user invokes story export (Markdown, JSON, or plain text) with the plugin enabled
- **THEN** the exported artefact SHALL contain the original quote characters with no `<span>` wrappers, no `<mark>` elements, and no other inserted markup
