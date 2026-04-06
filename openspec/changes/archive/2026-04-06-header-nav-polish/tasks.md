# Header Nav Polish — Tasks

## 1. Merge Navigation into Header (HTML)

- [x] 1.1 In `index.html`, add a spacer element (e.g., `<span class="flex-grow"></span>`) after `#folder-name` inside `<header>`
- [x] 1.2 Move `btn-prev`, `chapter-progress`, and `btn-next` elements from `<nav#chapter-nav>` into `<header>`, after the spacer. Add `hidden` class to each by default.
- [x] 1.3 Remove the entire `<nav id="chapter-nav">` element and its `<!-- Bottom Navigation Bar -->` comment from `index.html`
- [x] 1.4 Remove any CSS rules specific to `#chapter-nav` (if any exist beyond Tailwind classes)

## 2. Merge Navigation into Header (JS)

- [x] 2.1 In `index.html` script block, remove `chapterNav: document.getElementById('chapter-nav')` from the `elements` object passed to `initChapterNav()`
- [x] 2.2 In `js/chapter-nav.js`, remove all references to `els.chapterNav` — replace `els.chapterNav.classList.remove('hidden')` with toggling `hidden` off `els.btnPrev`, `els.chapterProgress`, and `els.btnNext` individually
- [x] 2.3 In `js/chapter-nav.js`, replace `els.chapterNav.classList.add('hidden')` (in the empty files case) with adding `hidden` back to `els.btnPrev`, `els.chapterProgress`, and `els.btnNext`
- [x] 2.4 Verify the `--header-height` CSS variable and cached `headerOffset` still work correctly after the merge (adjust if needed)

## 3. Love-Themed Text Selection

- [x] 3.1 In `index.html` `<style>`, add `::selection { background: rgba(180, 30, 60, 0.6); color: #fff; }` rule
- [x] 3.2 In `index.html` `<style>`, add `::-moz-selection { background: rgba(180, 30, 60, 0.6); color: #fff; }` rule (separate declaration for Firefox)
- [x] 3.3 Verify text selection colour on prose text, header text, and sidebar text

## 4. Sidebar Details Expanded by Default

- [x] 4.1 In `js/status-bar.js`, add `open` attribute to the outfit (`穿着`) `<details>` element
- [x] 4.2 In `js/status-bar.js`, add `open` attribute to the close-up (`特寫`) `<details>` element
- [x] 4.3 Verify sections render expanded by default and can be manually collapsed by clicking summary

## 5. Hidden Sidebar Scrollbar

- [x] 5.1 In `index.html` `<style>`, add `scrollbar-width: none;` to the existing `#sidebar` rule
- [x] 5.2 In `index.html` `<style>`, add `#sidebar::-webkit-scrollbar { display: none; }` rule
- [x] 5.3 Verify sidebar remains scrollable via mouse wheel / touch despite hidden scrollbar

## 6. Integration & Verification

- [x] 6.1 Load a multi-chapter story; confirm header shows folder picker + nav controls together, no bottom nav bar
- [x] 6.2 Before loading a story, confirm nav controls (prev, progress, next) are hidden in header
- [x] 6.3 Navigate forward/backward; confirm buttons disable at boundaries correctly
- [x] 6.4 Confirm scroll-to-top offset still works after header merge
- [x] 6.5 Confirm text selection uses love-themed rose colours across all page areas
- [x] 6.6 Confirm sidebar details sections are expanded by default and collapsible
- [x] 6.7 Confirm sidebar scrollbar is hidden but content remains scrollable
- [x] 6.8 Verify on narrow viewport: header wraps gracefully with nav controls on second line
