## Why

Five usability and visual issues have been identified after initial deployment of the MD Story Reader:

1. The status bar (狀態欄) renders inline within the story prose, forcing readers to scroll past it to continue reading. It should float to the right so readers can reference character state while reading.
2. The `<options>` block renders on every chapter, cluttering intermediate pages. Options are only meaningful on the last page.
3. When navigating to the next chapter and auto-scrolling to top, the sticky `<header>` covers the first line of content — a scroll-offset bug.
4. The header and footer (chapter nav bar) occupy too much vertical space, reducing the reading area.
5. The colour palette needs refinement: merge SillyTavern's muted grey/gold tones into the existing love theme for better prose readability.

## What Changes

- Move the status panel to a right-side floating/sticky box that tracks its natural position in the content flow
- Conditionally render `<options>` blocks only when the current chapter is the last chapter in the story
- Fix scroll-to-top offset to account for the sticky header height
- Reduce header and footer (nav bar) vertical padding for a more compact UI
- Merge new colour values into the CSS custom properties: main text `rgba(207,207,197,1)`, italics `rgba(145,145,145,1)`, quotes `rgba(198,193,151,1)`, tint/shadow colours

## Capabilities

### New Capabilities
- `page-layout`: Floating right-side status panel layout, scroll-offset fix, compact header/footer sizing

### Modified Capabilities
- `status-bar`: Render output SHALL be wrapped in a right-floating sticky container instead of inline block
- `options-panel`: Rendering SHALL be conditional — only displayed on the last chapter
- `chapter-navigation`: Scroll-to-top SHALL offset by the header height; nav bar SHALL use reduced padding

## Impact

- **index.html**: CSS changes for floating layout, compact header/footer, updated colour variables
- **js/status-bar.js**: Rendered HTML may need wrapper class changes for float positioning
- **js/options-panel.js**: Needs chapter-position awareness (isLastChapter flag) to conditionally render
- **js/chapter-nav.js**: Scroll-to-top logic must account for header offset; nav bar padding reduced
- **js/md-renderer.js**: Must pass isLastChapter context to options-panel renderer
- **Dependencies**: None added or removed
