## Why

The current layout has a separate bottom navigation bar (`#chapter-nav`) that wastes vertical space and requires two sticky bars. The text selection highlight uses the browser's default blue/white colours, which clashes with the love theme. The sidebar status panel's `<details>` sections are collapsed by default and the sidebar scrollbar is visually distracting.

## What Changes

- **Merge navigation into header**: Remove the bottom `<nav#chapter-nav>` element entirely. Move the prev/next buttons and chapter progress indicator into the `<header>`, alongside the folder picker button. The header remains a single sticky bar at the top. Navigation controls are hidden until a story is loaded.
- **Love-themed text selection**: Add `::selection` and `::-moz-selection` CSS pseudo-element styles using the love theme palette (e.g., pink/rose accent background with appropriate text colour) so highlighted text matches the overall design.
- **Sidebar details expanded + hidden scrollbar**: Expand all `<details>` elements in the `<aside id="sidebar">` by default (add `open` attribute). Hide the sidebar scrollbar while keeping it scrollable using the negative-margin/padding overflow technique (or `scrollbar-width: none` + webkit scrollbar hide).

## Capabilities

### New Capabilities
- `text-selection`: CSS `::selection` styling rules for love-themed text highlight colours

### Modified Capabilities
- `page-layout`: Header now contains navigation controls; bottom nav bar removed; sidebar scrollbar hidden
- `chapter-navigation`: Navigation buttons moved from `#chapter-nav` to `<header>`; DOM references updated
- `status-bar`: `<details>` elements rendered with `open` attribute by default

## Impact

- `index.html`: Header HTML restructured to include nav buttons + progress; `<nav#chapter-nav>` removed; new `::selection` CSS rules; sidebar scrollbar-hide CSS
- `js/chapter-nav.js`: DOM element references updated (`btn-prev`, `btn-next`, `chapter-progress` now in header); `#chapter-nav` show/hide logic replaced with button visibility toggling; `--header-height` variable may need recalculation
- `js/status-bar.js`: Add `open` attribute to `<details>` elements in `renderStatusPanel()`
