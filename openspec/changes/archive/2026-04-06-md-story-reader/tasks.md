## 1. Project Setup & Shell

- [x] 1.1 Create `index.html` with HTML5 boilerplate, Tailwind CSS CDN (`<script src="https://cdn.tailwindcss.com">`), and marked.js CDN script tag
- [x] 1.2 Define Dark Love Theme CSS custom properties in a `<style>` block (panel-bg gradient, border colors `#6d1a2a`, text colors `#f0c0cc`/`#ff8aaa`/`#e05070`, collapsible transition styles)
- [x] 1.3 Add the page shell layout with Tailwind: folder-picker area, chapter navigation bar (prev/next buttons + progress indicator), and a content container `<div id="content">`
- [x] 1.4 Add `<script type="module">` entry point in `index.html` that imports from `js/` modules and wires up DOM event listeners (folder button click, prev/next click)
- [x] 1.5 Add unsupported-browser detection: check for `window.showDirectoryPicker` on load and display an error message if unavailable

## 2. File Reader Module

- [x] 2.1 Create `js/file-reader.js` exporting `pickDirectory()` that calls `window.showDirectoryPicker()` and returns a `FileSystemDirectoryHandle`; handle user cancellation gracefully (catch `AbortError`)
- [x] 2.2 Implement `listChapterFiles(dirHandle)` that iterates directory entries, filters filenames matching `/^\d+\.md$/`, and returns a `FileSystemFileHandle[]` sorted numerically by leading digits
- [x] 2.3 Implement `readFileContent(fileHandle)` that reads a file as UTF-8 text via `getFile()` then `text()`
- [x] 2.4 Display an informative message when no matching chapter files are found in the selected directory
- [x] 2.5 Implement directory handle persistence with IndexedDB: save handle on selection, restore on revisit, re-request permission via `handle.requestPermission()`, and fall back to folder-picker on denial

## 3. Markdown Rendering Pipeline

- [x] 3.1 Create `js/md-renderer.js` exporting `renderChapter(rawMarkdown)` that orchestrates the full pipeline and returns an HTML string
- [x] 3.2 Implement placeholder extraction framework: replace matched XML blocks with `<!--BLOCK_TYPE_N-->` tokens, store extracted content in a map, and provide `reinjectPlaceholders(html, map)` to swap them back after markdown conversion
- [x] 3.3 Integrate extraction calls in pipeline order: status → options → UpdateVariable → strip imgthink → strip disclaimer
- [x] 3.4 Implement quote normalisation: replace `"`, `"`, `«`, `»`, `「`, `」`, `｢`, `｣`, `《`, `》`, `"` with ASCII `"`
- [x] 3.5 Implement newline doubling: replace single `\n` with `\n\n` after XML extraction and quote normalisation
- [x] 3.6 Call `marked.parse()` on the processed prose text to convert markdown to HTML
- [x] 3.7 Reinsert rendered component HTML by replacing placeholder tokens in the final HTML output

## 4. Status Bar Parser & UI

- [x] 4.1 Create `js/status-bar.js` exporting `extractStatusBlocks(text)` that detects and extracts `<status>…</status>` blocks via regex, returning extracted content and placeholder-substituted text
- [x] 4.2 Implement `parseStatus(blockContent)` to parse the `基礎:` section — extract `[Name|Title|Description|Thought|Inventory]` pipe-delimited fields
- [x] 4.3 Parse the `服飾:` section — extract `[Clothing|Footwear|Legwear|Accessories]` pipe-delimited fields
- [x] 4.4 Parse the `特寫:` section — extract one or more `[BodyPart|Description]` lines
- [x] 4.5 Handle partial/missing sections and empty pipe fields gracefully (render only what is present)
- [x] 4.6 Implement `renderStatusPanel(parsedData)` returning themed HTML: character name/title header, scene description, inner thought, inventory list
- [x] 4.7 Render `穿着` (outfit) as a collapsible `<details>` section, defaulting to collapsed, with animated `max-height` CSS transition
- [x] 4.8 Render `特寫` (close-up) as a collapsible `<details>` section, defaulting to collapsed, listing body-part/description pairs

## 5. Options Panel Parser & UI

- [x] 5.1 Create `js/options-panel.js` exporting `extractOptionsBlocks(text)` that detects and extracts `<options>…</options>` blocks via regex
- [x] 5.2 Implement `parseOptions(blockContent)` to extract up to 4 items matching `N:【text】` or `N: text` format, stripping `【` `】` brackets
- [x] 5.3 Implement `renderOptionsPanel(items)` returning a 2×2 CSS Grid of styled buttons using Dark Love Theme tokens, each displaying option number and text
- [x] 5.4 Add hover/active visual states to option buttons
- [x] 5.5 Add click handler on each button to copy option text to clipboard via `navigator.clipboard.writeText()` with brief visual feedback (e.g., toast or button state change)
- [x] 5.6 Handle malformed options blocks with fewer than 4 items: render available items, leave remaining grid cells empty

## 6. Variable Display Parser & UI

- [x] 6.1 Create `js/variable-display.js` exporting `extractVariableBlocks(text)` that detects both complete (`<UpdateVariable>…</UpdateVariable>`) and incomplete (`<UpdateVariable>` with no closing tag) blocks
- [x] 6.2 Ensure incomplete form is matched first (greedy from tag to end-of-string), then complete form, per design spec ordering
- [x] 6.3 Implement `renderVariableBlock(content, isComplete)` returning a `<details>` element: summary `变量更新情况` for complete blocks, summary `变量更新中...` for incomplete blocks
- [x] 6.4 Display inner content (`<Analysis>` text and `<JSONPatch>` data) as readable preformatted text inside the details element
- [x] 6.5 Ensure all variable `<details>` elements default to collapsed (no `open` attribute)
- [x] 6.6 Handle multiple `<UpdateVariable>` blocks in a single chapter, rendering each independently in document order

## 7. Chapter Navigation & State

- [x] 7.1 Implement module-scoped state object tracking `directoryHandle`, `files[]`, `currentIndex`, and `currentContent`
- [x] 7.2 Wire folder selection to automatically load and render the first chapter (lowest numeric index)
- [x] 7.3 Implement "Next" button handler: increment `currentIndex`, read file, re-run pipeline, replace content in DOM
- [x] 7.4 Implement "Previous" button handler: decrement `currentIndex`, read file, re-run pipeline, replace content in DOM
- [x] 7.5 Disable "Previous" button on first chapter and "Next" button on last chapter with distinct visual styling
- [x] 7.6 Display chapter progress indicator (e.g., `2 / 5`) updated on every navigation
- [x] 7.7 Sync current chapter to URL hash (`#chapter=N`); on page load with hash, navigate to that chapter after folder selection
- [x] 7.8 Scroll viewport to top of content area on every chapter change

## 8. Integration, Responsive Design & Polish

- [x] 8.1 End-to-end test: open a folder with sample `.md` files containing `<status>`, `<options>`, `<UpdateVariable>`, `<imgthink>`, and `<disclaimer>` blocks and verify all render correctly in sequence
- [x] 8.2 Verify CJK (Chinese/Japanese) text renders correctly through the entire pipeline without encoding issues
- [x] 8.3 Verify mobile-first responsive layout: base styles for small screens, `sm:`/`md:` Tailwind breakpoints for wider content and larger fonts
- [x] 8.4 Verify the markdown renderer does not execute `<script>` tags from source markdown content
- [x] 8.5 Add graceful fallback for status block parsing failures: display raw block text instead of showing nothing
- [x] 8.6 Confirm CDN resources (Tailwind, marked.js) load correctly and the page functions after browser caching for offline re-use
- [x] 8.7 Final review: check all navigation boundaries, collapsible sections, clipboard copy, quote normalisation, and newline doubling work as specified
