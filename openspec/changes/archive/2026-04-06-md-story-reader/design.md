## Context

This project builds a **local, pure-frontend story reader** — a single web page that renders numbered markdown files (001.md, 002.md, …) stored in a local folder. These files contain Chinese/Japanese narrative prose interleaved with custom XML blocks (`<status>`, `<options>`, `<UpdateVariable>`, `<imgthink>`, `<disclaimer>`) that were previously rendered through SillyTavern's regex engine.

The goal is to eliminate the SillyTavern dependency for reading stories by migrating all **display-side** regex rules from `regex.json` into a purpose-built reader with chapter navigation. The reader must work entirely offline with no server — just open `index.html` in a browser.

---

## Goals / Non-Goals

**Goals:**

- Provide a single `index.html` entry point that loads ES modules for each concern
- Parse and render all display-relevant XML blocks with styling faithful to the existing "Dark Love Theme"
- Migrate only display-side regex rules from `regex.json` (rules where `promptOnly: false` and `markdownOnly: true` or applicable to display placement)
- Support chapter-by-chapter navigation through numbered markdown files
- Work offline in modern Chromium browsers (Chrome/Edge) with zero server dependencies
- Mobile-first responsive layout using Tailwind CSS via CDN

**Non-Goals:**

- No SillyTavern integration — the options panel renders display-only buttons (no `window.parent.document` references)
- No prompt-side regex rules — rules marked `promptOnly: true` are irrelevant to a read-only viewer
- No server, build step, or bundler — the app is a static HTML file with ES modules
- No editing or variable mutation — `<UpdateVariable>` blocks are displayed read-only
- No support for `變數初始值.yml`, `變數結構.js`, or `魔王大人的流行款/` — these are excluded from the reader scope
- No Firefox/Safari support for folder selection (File System Access API is Chromium-only)

---

## Decisions

### Single-file entry point with ES modules

The app ships as one `index.html` that loads JavaScript via `<script type="module">`. Each capability maps to a separate ES module file:

```
index.html              ← shell: folder picker, chapter nav, content container
js/file-reader.js       ← File System Access API, file listing/sorting
js/md-renderer.js       ← orchestrates the parsing pipeline, markdown→HTML
js/status-bar.js        ← <status> block parser + themed HTML builder
js/options-panel.js     ← <options> block parser + button grid builder
js/variable-display.js  ← <UpdateVariable> block parser + collapsible builder
js/chapter-nav.js       ← chapter state, prev/next navigation, URL hash sync
```

**Why ES modules instead of inline scripts:** Each module has a single responsibility and can be tested/developed independently. No bundler needed — browsers natively support `import`/`export`.

### Parsing pipeline — order of operations

The content transformation follows a strict pipeline. Order matters because some steps produce HTML that later steps must not corrupt, and XML extraction must happen before markdown rendering.

```
Raw markdown string
  │
  ├─ 1. Extract & render <status> blocks     → replaced with rendered HTML
  ├─ 2. Extract & render <options> blocks     → replaced with rendered HTML
  ├─ 3. Extract & render <UpdateVariable>     → replaced with collapsible HTML
  │      (both complete and incomplete forms)
  ├─ 4. Strip <imgthink>…</imgthink>          → removed entirely
  ├─ 5. Strip <disclaimer>…</disclaimer>      → removed entirely
  │
  ├─ 6. Quote normalisation                   → [""«»「」｢｣《》"] → "
  ├─ 7. Newline doubling                      → \n → \n\n
  │
  └─ 8. Markdown → HTML rendering             → prose text becomes formatted HTML
```

**Why extract XML before markdown?** Markdown parsers would mangle the XML tags or render them as raw text. By extracting structured blocks first and replacing them with placeholder markers (e.g. `<!--STATUS_BLOCK_0-->`), the markdown renderer only sees prose. After markdown rendering, placeholders are swapped back with the rendered HTML components.

**Why newline doubling before markdown?** The source files use single `\n` between paragraphs. Standard markdown requires `\n\n` for paragraph breaks. This matches the existing `regex.json` "newline" rule behaviour.

### Markdown rendering approach

Use a lightweight markdown library loaded via CDN (e.g. **marked**) rather than writing a custom parser. The story content uses basic markdown features (paragraphs, emphasis, quotes) — no need for a full-featured parser. The library is configured to produce safe HTML without sanitising away our injected component HTML.

### Status bar — Dark Love Theme migration

The status bar replicates the CSS custom properties and visual design from the existing `regex.json` "狀態欄" rule's HTML template. Key design elements preserved:

- **Color palette:** `--panel-bg: linear-gradient(145deg, #1a0810, #220c16)`, crimson borders (`#6d1a2a`), pink-toned text (`#f0c0cc`, `#ff8aaa`, `#e05070`)
- **Layout:** Character name/title header → collapsible "穿着" fold → collapsible "特寫" fold → scene/thought/items info section
- **Interactions:** Collapsible sections with animated fold/unfold (CSS `max-height` transition)

The CSS variables are defined once in `index.html`'s `<style>` block (or a shared CSS module) so both the status bar and options panel share the same theme tokens. This avoids the regex.json approach of embedding a full `<!DOCTYPE html>` document per component.

**Parsing the status format:** The `<status>` block follows a fixed structure:
```
基礎: [name|title|scene|thought|items]
服飾: [clothes|shoes|socks|accessories]
特寫: [part1|desc1] [part2|desc2] [part3|desc3]
```
The parser uses a regex to extract each section, then splits pipe-delimited values. Missing sections are handled gracefully (the block only renders sections that are present).

### Options panel — display-only buttons

The options panel parses `<options>` blocks containing 4 numbered items and renders them in a 2×2 CSS Grid. The button styling uses the same Dark Love Theme tokens. Unlike the SillyTavern version, buttons do not send text to a SillyTavern input field — instead, clicking a button copies the option text to the clipboard via `navigator.clipboard.writeText()`, providing a lightweight interaction without SillyTavern dependency.

**Parsing format:** Each option line matches `N:【text】` or `N: text` (flexible on brackets and colon style).

### UpdateVariable — two-form collapsible

Two patterns are handled, matching the existing regex.json rules:

1. **Incomplete** (`<UpdateVariable>` with no closing tag): Wrapped in `<details>` with summary "變數更新中" — indicates the AI was still generating
2. **Complete** (`<UpdateVariable>…</UpdateVariable>`): Wrapped in `<details>` with summary "變數更新詳情" — shows the full variable patch

Both render the inner content as preformatted text inside a collapsed `<details>` element. The incomplete form is matched first (greedy from tag to end-of-string), then the complete form.

### File reading and chapter state

The File System Access API (`window.showDirectoryPicker()`) provides a directory handle. On selection:

1. Iterate entries, filter for `.md` files matching the `\d+\.md` pattern (one or more leading digits)
2. Sort numerically by filename
3. Store the sorted `FileSystemFileHandle[]` list in module-level state
4. Load the first chapter

**State management** is kept minimal — no state library, no reactive framework. A simple module-scoped state object in `md-renderer.js` (or a dedicated `state.js`) holds:

```js
const state = {
  directoryHandle: null,   // FileSystemDirectoryHandle
  files: [],               // sorted FileSystemFileHandle[]
  currentIndex: 0,         // which chapter is displayed
  currentContent: ''       // raw markdown of current chapter
};
```

Chapter navigation (prev/next buttons) updates `currentIndex`, reads the file, and re-runs the parsing pipeline. The UI disables prev/next at boundaries.

### Styling approach

- **Tailwind CSS via CDN** (`<script src="https://cdn.tailwindcss.com">`) for layout, spacing, typography, and responsive utilities on the page shell (folder picker, navigation bar, content wrapper)
- **Custom CSS** (in a `<style>` block) for the Dark Love Theme component styling — the status bar and options panel use CSS custom properties that don't map well to Tailwind utility classes
- **Mobile-first:** Base styles target small screens; `sm:`/`md:` breakpoints add desktop enhancements (wider content area, larger fonts)

---

## Risks / Trade-offs

### File System Access API is Chromium-only

The `showDirectoryPicker()` API is not supported in Firefox or Safari. This is an accepted trade-off — the target audience uses Chrome/Edge. A fallback `<input type="file" webkitdirectory>` could be added later for broader support, but is not in scope.

### CDN dependency for Tailwind and markdown library

The app loads Tailwind CSS and a markdown parser from CDNs, which means it requires an internet connection on first load (browsers cache afterward). For true offline use, these libraries could be vendored into the project directory. This is a minor concern since the primary use case assumes at least occasional connectivity.

### No sanitisation of rendered HTML

The status bar and options panel inject raw HTML into the page. Since the source files are locally authored (not user-submitted from the internet), XSS is not a practical concern. The markdown renderer should still be configured to avoid executing arbitrary `<script>` tags from the source markdown.

### Parsing fragility with regex

The status block parser relies on a fixed format (`基礎:`, `服飾:`, `特寫:` sections with pipe-delimited values in brackets). If the AI model produces slightly different formatting, parsing may fail silently. The parser should degrade gracefully — rendering the raw text in a fallback block rather than showing nothing.

### Single-chapter rendering

Only one chapter is rendered at a time (not a continuous scroll of all chapters). This simplifies memory management and parsing but means users cannot search across chapters or scroll through the entire story. This matches the original SillyTavern experience where messages are displayed individually.
