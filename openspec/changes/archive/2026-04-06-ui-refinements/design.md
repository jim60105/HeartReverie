# UI Refinements — Design

## Context

The MD Story Reader is a pure-frontend single-page app that loads `.md` chapter files via the File System Access API, runs them through a custom rendering pipeline (`md-renderer.js`), and injects the resulting HTML into `#content`. All CSS lives in a single `<style>` block in `index.html`; there is no build step or CSS preprocessor.

The rendering pipeline extracts three custom block types (`<status>`, `<options>`, `<UpdateVariable>`) before passing text to `marked.parse()`, then reinjects the rendered component HTML via placeholder tokens. Navigation state (`currentIndex`, `files[]`) is private to `chapter-nav.js` and is not directly accessible from other modules.

Five usability issues have been identified (see `proposal.md`). This document records the architectural decisions for addressing them.

---

## Goals / Non-Goals

### Goals

- G1: Status panel occupies a dedicated sidebar column beside prose on desktop so readers can reference character state without it interfering with the text flow.
- G2: Options block only appears on the last chapter — intermediate chapters show clean prose.
- G3: Navigating chapters scrolls to the correct reading position, below the sticky header.
- G4: Header and footer consume less vertical space.
- G5: Prose colours are refined with SillyTavern's neutral/grey tones while preserving the love-theme accent palette.

### Non-Goals

- No responsive "drawer" or "toggle" interaction for the status panel — simple grid column is sufficient.
- No changes to the rendering pipeline architecture — status panel relocation is done via post-render DOM manipulation.
- No changes to body `background-color` — it stays at `#0f0a0c`.
- No changes to the `<UpdateVariable>` display or parsing logic.
- No changes to file-reader.js, the folder picker, or the IndexedDB persistence layer.

---

## Decisions

### D1 — Two-Column Status Panel via CSS Grid

**Approach:** Replace the single-column `<main>` layout with a CSS Grid two-column layout. The left column contains `#content` (story prose) with the same `max-w-3xl` (48rem) max-width. The right column contains a sticky `<aside id="sidebar">` that takes the remaining width. After `renderChapter()` populates `#content`, a `moveStatusToSidebar()` function moves `.status-float` elements from `#content` to `#sidebar` via DOM manipulation.

**Why CSS Grid + JS relocation instead of `float: right`:**
The original float approach mixed the status panel into the text flow, causing prose to wrap around the panel. The user explicitly requested that the status panel NOT be mixed into the text content. A separate grid column achieves clean visual separation — the prose and status panel are in entirely different DOM containers.

**Why JS relocation instead of splitting the render pipeline:**
The rendering pipeline produces a single HTML string with all components inline. Splitting it to output status HTML separately would require significant refactoring of the placeholder/reinject mechanism. Moving DOM nodes after render is simpler, has no visual flash (happens synchronously before paint), and keeps the pipeline architecture unchanged.

**CSS changes (index.html `<style>`):**
- `.content-wrapper`: CSS Grid with `grid-template-columns: minmax(0, 48rem) 1fr`, centering the two-column layout with `max-width: 80rem; margin: 0 auto`.
- `#sidebar`: `position: sticky; top: calc(var(--header-height) + 8px); max-height: calc(100vh - var(--header-height) - 16px); overflow-y: auto`. Hidden when empty via `#sidebar:empty { display: none }`.
- `@media (max-width: 767px)`: Grid collapses to single column, sidebar becomes static.
- `.status-float`: No float rules — class retained as a selector hook but styling is handled by its container.

**HTML changes (index.html):**
- `<main>` loses `mx-auto max-w-3xl` and gains a child `<div class="content-wrapper">` wrapping `#content` and `<aside id="sidebar">`.

**JS changes (chapter-nav.js):**
- New `moveStatusToSidebar()` function: clears `#sidebar`, moves all `.status-float` elements from `#content` to `#sidebar`. Called after `render()` in `loadChapter()`.

---

### D2 — Conditional Options Rendering (Last-Chapter Gate)

**Approach:** Add an `isLastChapter` parameter to `renderChapter()`. When false, options blocks are still *extracted* (stripped from markdown) but their placeholder maps to an empty string instead of the rendered panel HTML.

**Why extract-but-hide, not skip-extraction:**
If we leave `<options>` tags in the markdown on non-last chapters, `marked.parse()` will try to render them as raw HTML (or escape them), producing garbled output. Extraction must always happen to keep the markdown clean. The conditional part is only whether the placeholder maps to rendered HTML or to `""`.

**Data flow for `isLastChapter`:**

1. `chapter-nav.js` — `loadChapter()` already has access to `state.currentIndex` and `state.files.length`. Compute `isLastChapter = (index === state.files.length - 1)`.
2. `render()` wrapper in `chapter-nav.js` — pass `isLastChapter` through to `renderChapter(raw, { isLastChapter })`.
3. `md-renderer.js` — `renderChapter(rawMarkdown, options = {})` passes `options.isLastChapter` to `extractOptionsBlocks()`.
4. `options-panel.js` — `extractOptionsBlocks(text, { render = true } = {})` — when `render` is false, each block entry gets `html: ''` instead of calling `renderOptionsPanel()`. The function signature stays backward-compatible (default `render: true`).

**Why an options object instead of a positional boolean:**
Using `{ isLastChapter }` / `{ render }` keeps the API extensible without breaking existing callers. The `render()` fallback in `chapter-nav.js` (the `marked.parse` path) doesn't need this flag since it never handled custom blocks anyway.

---

### D3 — Scroll-To-Top Offset Fix

**Approach:** Replace the current `els.content.scrollIntoView({ block: 'start' })` in `loadChapter()` with an offset-aware scroll that accounts for the sticky header.

**Implementation:** Use `window.scrollTo({ top: els.content.offsetTop - headerOffset, behavior: 'smooth' })`, where `headerOffset` is read once from `document.querySelector('header').offsetHeight` during `initChapterNav()` and cached.

**Why cache the header height:**
After D4 the header height is static (no dynamic resizing). Reading it once avoids layout thrashing on every navigation. If a future change makes the header height dynamic, this can be replaced with a live read.

**Why `offsetTop` instead of `getBoundingClientRect().top + scrollY`:**
`offsetTop` is relative to the offset parent and stable across scroll positions. `getBoundingClientRect` returns viewport-relative coordinates that depend on current scroll position, adding unnecessary complexity. Since `#content` is a direct child of `<main>` which is a direct child of `<body>`, `offsetTop` is reliable.

---

### D4 — Compact Header / Footer

**Approach:** Reduce vertical padding on the `<header>` and `<nav#chapter-nav>` elements from Tailwind's `py-3` (12px) to `py-1` (4px), horizontal padding from `px-4` to `px-3`, and button padding from `px-4 py-2` to `px-3 py-1`. Gap between header items from `gap-3` to `gap-2`.

**Why `py-1` and not `py-2`:**
`py-2` (8px) was tested but still felt too spacious. `py-1` (4px) with `px-3 py-1` buttons creates a minimal but still functional header bar. The buttons remain large enough for touch targets.

**Derived value:** After this change, header height ≈ 4px top + ~24px button + 4px bottom + 1px border = ~33px → set to `--header-height: 34px` for D1 and D3.

**Scope:** `py-3` → `py-1` on header/nav, `px-4` → `px-3` on header/nav, `px-4 py-2` → `px-3 py-1` on all buttons, `gap-3` → `gap-2` on header.

---

### D5 — Colour Merge (SillyTavern Neutral Tones)

**Approach:** Add new CSS custom properties and update existing ones in the `:root` block. Existing love-theme accent colours are preserved unchanged.

**Colour mapping:**

| SillyTavern token          | Value                        | CSS variable        | Action          |
|----------------------------|------------------------------|---------------------|-----------------|
| `main_text_color`          | `rgba(207, 207, 197, 1)`    | `--text-main`       | **Update** (currently `#f0c0cc`) |
| `italics_text_color`       | `rgba(145, 145, 145, 1)`    | `--text-italic`     | **New**         |
| `underline_text_color`     | `rgba(145, 145, 145, 1)`    | `--text-underline`  | **New**         |
| `quote_text_color`         | `rgba(198, 193, 151, 1)`    | `--text-quote`      | **New**         |
| `blur_tint_color`          | `rgba(29, 33, 40, 0.9)`     | `--reading-tint`    | **New** (defined but not applied to any element) |
| `chat_tint_color`          | `rgba(29, 33, 40, 0.9)`     | `--reading-tint`    | **New** (same as above, kept as variable only) |
| `shadow_color`             | `rgba(0, 0, 0, 0.9)`        | `--shadow-color`    | **New**         |
| `shadow_width: 2`          | `2px`                       | `--shadow-width`    | **New** (used in `text-shadow` on prose) |
| `border_color`             | `rgba(0, 0, 0, 1)`          | `--border-outer`    | **New**         |

**Prose typography rules (new in `<style>`):**

```
#content em      { color: var(--text-italic); }
#content u       { color: var(--text-underline); }
#content blockquote { color: var(--text-quote); border-left-color: var(--text-quote); }
#content p       { text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color); }
```

**Why update `--text-main`:**
The current `#f0c0cc` (pink-tinted) is part of the love theme accent palette, but for long-form prose reading, the SillyTavern neutral `rgba(207, 207, 197, 1)` (warm grey) is significantly easier on the eyes. Accent colours (`--text-name`, `--text-title`, `--text-label`) remain pink-toned for UI elements where the theme identity matters.

**Why keep accent colours unchanged:**
The `--text-name` (`#ff8aaa`), `--text-title` (`#e05070`), `--text-label` (`#ff7a96`), and all `--btn-*` / `--border-color` / `--panel-bg` values are structural to the love theme. Replacing them would lose the app's visual identity. The merge only touches prose readability colours.

**Body background preserved:**
The body `background-color` remains `#0f0a0c` (original love theme). The `blur_tint_color` and `chat_tint_color` values are used only for the `--reading-tint` CSS variable, not for the page background. The colour merge only affects text and tint variables.

---

## Risks / Trade-offs

| # | Risk | Mitigation |
|---|------|------------|
| R1 | JS DOM relocation of status panel may cause a brief flash if rendering is slow. | The `moveStatusToSidebar()` call is synchronous and happens before the browser paints the frame. No visible flash in practice. |
| R2 | Changing `--text-main` affects every element using it, including status panel values (`.stat-val`). | This is intentional — `.stat-val` text should also benefit from the readability improvement. Accent-coloured elements use their own variables (`--text-name`, `--text-label`) and are unaffected. |
| R3 | Cached header height in D3 becomes stale if the header wraps (e.g., very long folder name on narrow viewport). | The header uses `flex-wrap`, so wrapping can happen. Mitigation: truncate the folder name display (already has `truncate` class). If wrapping still occurs on very narrow screens, the scroll offset will be slightly off — acceptable degradation. |
| R4 | Hiding options on non-last chapters means if the author places options mid-story intentionally, they won't render. | This is the desired behaviour per the proposal — options are only meaningful on the last page. If a future story format needs mid-story options, the `isLastChapter` gate can be replaced with a more nuanced rule. |
