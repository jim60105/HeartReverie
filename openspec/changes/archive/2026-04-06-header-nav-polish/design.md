# Header Nav Polish — Design

## Context

The MD Story Reader is a pure-frontend single-page app styled with Tailwind utility classes and CSS custom properties in a single `<style>` block in `index.html`. The current layout uses two sticky bars: a `<header>` at the top (folder picker + folder name) and a `<nav#chapter-nav>` at the bottom (prev/next buttons + progress). Navigation state is managed by `chapter-nav.js`, which references `els.chapterNav` to toggle the bottom bar's visibility. The sidebar (`#sidebar`) renders status panels via `status-bar.js`, which outputs `<details>` elements defaulting to collapsed. All CSS lives inline — there is no build step or preprocessor.

---

## Goals / Non-Goals

### Goals

- G1: Consolidate header and navigation into a single sticky bar at the top, eliminating the bottom `<nav#chapter-nav>` and reclaiming vertical reading space.
- G2: Style text selection (`::selection`) to match the love theme palette, replacing the browser default blue/white highlight.
- G3: Expand sidebar `<details>` sections by default so status info is immediately visible, and hide the sidebar scrollbar for a cleaner appearance.

### Non-Goals

- No changes to the rendering pipeline (`md-renderer.js`) or custom block parsing.
- No changes to body `background-color` (`#0f0a0c`).
- No changes to the file-reader, IndexedDB persistence, or folder picker logic.
- No changes to the two-column CSS Grid layout or sidebar positioning rules.
- No new JavaScript modules — all changes fit within existing files.

---

## Decisions

### D1 — Merge Navigation into Header

**Approach:** Restructure the `<header>` element to contain both the folder picker controls (left) and chapter navigation controls (right). Use Tailwind `flex` with `gap-2` and a spacer (`ml-auto` or `flex-grow`) to push nav controls to the right side. The layout becomes:

```
[📂 選擇資料夾] [folder-name]  ···spacer···  [← 上一章] [2 / 5] [下一章 →]
```

Remove `<nav id="chapter-nav">` from the DOM entirely. Move `btn-prev`, `chapter-progress`, and `btn-next` into `<header>` as direct children.

**Visibility toggling:** The nav controls (`btn-prev`, `chapter-progress`, `btn-next`) carry the `hidden` class by default. When `handleDirectorySelected()` succeeds and calls into `chapter-nav.js`, the module removes `hidden` from each control individually, replacing the previous `els.chapterNav.classList.remove('hidden')` pattern.

**Why individual visibility toggling instead of a wrapper `<div>`:**
A wrapper would add an extra nesting level inside the header flex container and complicate the `gap` spacing. Toggling `hidden` on three elements directly is simpler and avoids flex-within-flex layout issues. The three elements are always shown/hidden together, so there is no state divergence risk.

**JS changes (`chapter-nav.js`):**
- Remove `els.chapterNav` from the elements object and all references to it.
- Replace `els.chapterNav.classList.add('hidden')` / `.remove('hidden')` with toggling `hidden` on `els.btnPrev`, `els.chapterProgress`, and `els.btnNext` individually.
- The `initChapterNav()` function's `elements` parameter drops the `chapterNav` key.

**JS changes (`index.html` script block):**
- Remove `chapterNav: document.getElementById('chapter-nav')` from the `elements` object passed to `initChapterNav()`.

**`--header-height` update:**
The header now contains more elements but retains the same `py-1` padding and `px-3 py-1` button sizing. On a single-line layout the height remains ~34px. However, on narrow viewports with `flex-wrap`, the header may wrap to two lines. The existing `flex-wrap` class on the header already handles this. The `--header-height` variable does not need to change for the single-line case; the cached `headerOffset` in `chapter-nav.js` (read from `header.offsetHeight`) will naturally reflect any wrapping.

**Narrow-screen wrapping:** On mobile, the nav controls wrap below the folder picker row. This is acceptable — both rows remain compact (`py-1`) and the total height is still less than the previous header + bottom nav combined.

**HTML changes (`index.html`):**
- Add `btn-prev`, `chapter-progress`, `btn-next` elements inside `<header>`, after `#folder-name`, with a spacer element or `ml-auto` on the first nav control.
- Remove the entire `<nav id="chapter-nav">` block.

---

### D2 — Love-Themed Text Selection Styling

**Approach:** Add `::selection` and `::-moz-selection` pseudo-element rules to the `<style>` block in `index.html`. This is a CSS-only change with no JavaScript involvement.

**Colour choice:**

```css
::selection {
  background: rgba(180, 30, 60, 0.6);
  color: #fff;
}
::-moz-selection {
  background: rgba(180, 30, 60, 0.6);
  color: #fff;
}
```

The background `rgba(180, 30, 60, 0.6)` is a semi-transparent deep rose that sits between `--text-title` (`#e05070`) and `--border-color` (`$6d1a2a`) in tone, complementing the dark burgundy page background (`#0f0a0c`). White text ensures readability on the translucent rose highlight.

**Why `rgba` with alpha instead of a solid colour:**
A semi-transparent selection background lets the underlying dark background bleed through slightly, maintaining the moody aesthetic. A fully opaque pink would feel too jarring against the dark theme.

**Why duplicate `::selection` and `::-moz-selection`:**
Firefox requires the `-moz-` prefixed pseudo-element. The two rules cannot be combined into a single selector (browsers discard the entire rule if they encounter an unrecognised pseudo-element), so they must be separate declarations.

---

### D3 — Sidebar Details Expanded + Hidden Scrollbar

**Approach (expanded details):** In `status-bar.js`, add the `open` attribute to each `<details>` element when rendering the status panel. The current code:

```js
html += `<details class="fold-section status-details">`;
```

becomes:

```js
html += `<details class="fold-section status-details" open>`;
```

This applies to all `<details>` elements generated by the status bar renderer (outfit/穿着 and close-up/特寫 sections). Users can still manually collapse sections — the `open` attribute only sets the initial state.

**Why `open` attribute instead of JavaScript `el.open = true` post-render:**
The `open` attribute in the HTML output is the simplest approach — no timing dependency, no DOM query after render, no flash of collapsed-then-expanded content. It follows progressive enhancement: the HTML is correct from the moment it is injected.

**Approach (hidden scrollbar):** Add two CSS rules to the `<style>` block in `index.html`:

```css
#sidebar {
  scrollbar-width: none; /* Firefox */
}
#sidebar::-webkit-scrollbar {
  display: none; /* Chrome, Edge, Safari */
}
```

The sidebar retains `overflow-y: auto` and remains fully scrollable via mouse wheel, trackpad, or touch. Only the visual scrollbar chrome is hidden.

**Why `scrollbar-width: none` instead of the negative-margin/padding overflow technique:**
The `scrollbar-width: none` property (CSS Scrollbars Level 1) is supported in Firefox 64+, and the `::-webkit-scrollbar` pseudo-element covers all Chromium-based browsers and Safari. Together they cover >98% of browsers. The negative-margin technique is more complex, fragile with sticky positioning, and unnecessary given modern browser support.

**Why hide the scrollbar at all:**
The sidebar is a narrow panel; the scrollbar consumes proportionally significant horizontal space and adds visual noise. The panel content (status info) is short enough that users rarely need to scroll, and when they do, wheel/touch scrolling works without a visible scrollbar. This is a cosmetic improvement, not a functional change.

---

## Risks / Trade-offs

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Removing `<nav#chapter-nav>` is a breaking change for any code referencing `els.chapterNav`. If a future module adds a dependency on the bottom nav bar, it will fail. | The `chapterNav` element is only referenced in `chapter-nav.js` and the `elements` object in `index.html`. Both are updated in this change. A grep for `chapter-nav` and `chapterNav` across the codebase confirms no other references. |
| R2 | Header wrapping on narrow screens increases the sticky header height, pushing content further down. | The combined header (folder picker + nav controls) on two wrapped lines is still shorter than the previous header + bottom nav combined, so net vertical space is gained. The cached `headerOffset` reads `header.offsetHeight` dynamically and accounts for wrapping. |
| R3 | Hidden sidebar scrollbar removes a visual affordance that the panel is scrollable. Users may not realise there is more content below the fold. | The status panel content is typically short (fits in viewport). If content is long enough to scroll, the sticky positioning and content clipping at the bottom edge provide a visual cue. This is an accepted trade-off for cleaner aesthetics. |
| R4 | Expanding `<details>` by default increases the initial visual height of the status panel, potentially pushing close-up details below the fold on short viewports. | Users can collapse sections they don't need. The `open` attribute is the default, not a forced state. On mobile (single-column), the status panel is inline and scrollable with the page, so extra height is less impactful. |
| R5 | `::selection` styling is overridden if a browser extension or user stylesheet sets its own selection colours. | This is standard browser behaviour and not within our control. The rule uses standard pseudo-elements and will apply in the absence of overrides. |
