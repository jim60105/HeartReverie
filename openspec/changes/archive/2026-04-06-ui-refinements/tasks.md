# UI Refinements — Tasks

## 1. Compact Header & Footer + Layout Foundation

- [x] 1.1 In `index.html`, change `<header>` padding from `py-3 px-4` to `py-1 px-3`, gap from `gap-3` to `gap-2` (per D4)
- [x] 1.2 In `index.html`, change `<nav#chapter-nav>` padding from `py-3 px-4` to `py-1 px-3` (per D4)
- [x] 1.3 In `index.html`, change all header/nav button padding from `px-4 py-2` to `px-3 py-1` (per D4)
- [x] 1.4 Update `--header-height` CSS custom property to `34px` to match the new compact header size (per D4)
- [x] 1.5 Verify header and footer render with reduced padding; buttons remain fully clickable on touch targets

## 2. Colour Variable Merge

- [x] 2.1 In `:root` CSS block, update `--text-main` from `#f0c0cc` to `rgba(207, 207, 197, 1)` (per D5 / page-layout spec)
- [x] 2.2 Add new CSS custom properties: `--text-italic: rgba(145, 145, 145, 1)`, `--text-underline: rgba(145, 145, 145, 1)`, `--text-quote: rgba(198, 193, 151, 1)` (per D5)
- [x] 2.3 Add new CSS custom properties: `--shadow-color: rgba(0, 0, 0, 0.9)`, `--shadow-width: 2px`, `--border-outer: rgba(0, 0, 0, 1)` (per D5)
- [x] 2.4 Keep `body` `background-color` at `#0f0a0c` (user explicitly rejected changing to SillyTavern's blue-grey)
- [x] 2.5 Add `--reading-tint: rgba(29, 33, 40, 0.9)` to `:root` as a variable definition only; do NOT apply it to any element's background (per user feedback)
- [x] 2.6 Add prose typography rules to `<style>`: `#content em { color: var(--text-italic); }`, `#content u { color: var(--text-underline); }`, `#content blockquote { color: var(--text-quote); border-left-color: var(--text-quote); }`, `#content p { text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color); }` (per D5)
- [x] 2.7 Verify accent colours (`--text-name`, `--text-title`, `--text-label`, `--btn-*`, `--border-color`, `--panel-bg`) are unchanged
- [x] 2.8 Visually confirm prose readability: body text, italics, underlines, blockquotes, and text-shadow render with the new values

## 3. Two-Column Status Panel (Grid Layout)

- [x] 3.1 In `index.html` `<style>`, add `.content-wrapper` CSS Grid rules: `grid-template-columns: minmax(0, 48rem) 1fr`, `max-width: 80rem`, `margin: 0 auto` (per D1)
- [x] 3.2 Add `@media (max-width: 767px)` override: grid collapses to single column, `#sidebar` becomes static (per D1)
- [x] 3.3 In `index.html`, add `<div class="content-wrapper">` wrapping `#content` and `<aside id="sidebar">` (per D1)
- [x] 3.4 In `js/status-bar.js`, add `status-float` to the class list of the wrapper `<div>` emitted by `renderStatusPanel()` as a selector hook (per D1)
- [x] 3.5 In `js/chapter-nav.js`, add `moveStatusToSidebar()` function that moves `.status-float` elements from `#content` to `#sidebar` after render (per D1)
- [x] 3.6 Verify on desktop (≥768px): status panel appears in sidebar column, separate from prose content; sidebar sticks on scroll
- [x] 3.7 Verify on mobile (<768px): sidebar hidden or collapsed, status panel remains in content flow

## 4. Conditional Options Rendering

- [x] 4.1 In `chapter-nav.js`, compute `isLastChapter = (index === state.files.length - 1)` inside `loadChapter()` (per D2)
- [x] 4.2 Pass `isLastChapter` from `chapter-nav.js` through to `renderChapter()` in `md-renderer.js` via an options object `{ isLastChapter }` (per D2)
- [x] 4.3 In `md-renderer.js`, forward `options.isLastChapter` to `extractOptionsBlocks()` as `{ render: options.isLastChapter }` (per D2)
- [x] 4.4 In `options-panel.js`, update `extractOptionsBlocks()` to accept `{ render = true }` option; when `render` is `false`, set each block entry's `html` to `''` instead of calling `renderOptionsPanel()` (per D2)
- [x] 4.5 Verify last chapter: options panel renders normally
- [x] 4.6 Verify non-last chapter with `<options>` block: block is extracted from markdown, no visible options output rendered

## 5. Scroll-to-Top Offset Fix

- [x] 5.1 In `chapter-nav.js` `initChapterNav()`, read and cache header height: `const headerOffset = document.querySelector('header').offsetHeight` (per D3)
- [x] 5.2 Replace `els.content.scrollIntoView({ block: 'start' })` with `window.scrollTo({ top: els.content.offsetTop - headerOffset, behavior: 'smooth' })` (per D3)
- [x] 5.3 Verify navigating chapters: first line of content is fully visible below the sticky header, not obscured

## 6. Integration & Visual Verification

- [x] 6.1 Load a multi-chapter story with `<status>`, `<options>`, and `<UpdateVariable>` blocks; confirm all five changes work together without visual regression
- [x] 6.2 Navigate forward and backward through chapters; confirm scroll offset is correct on every navigation
- [x] 6.3 Confirm options panel appears only on the last chapter and is absent on intermediate chapters
- [x] 6.4 Confirm status panel appears in sidebar column on desktop and collapses inline on mobile; sidebar sticks when scrolling long prose
- [x] 6.5 Confirm header/footer compaction does not clip buttons or text on narrow viewports
- [x] 6.6 Confirm colour changes: body background stays `#0f0a0c`, main text, italic, underline, blockquote, and text-shadow all match spec values
- [x] 6.7 Confirm `<UpdateVariable>` display is unaffected (non-goal: no changes to UpdateVariable)
