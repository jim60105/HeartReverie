## 1. Auto-reload polling

- [x] 1.1 Add `pollIntervalId` to module state in `chapter-nav.js`
- [x] 1.2 Create `pollDirectory()` function that calls `listChapterFiles()`, compares file count to `state.files.length`, and updates `state.files` + calls `updateNavState()` if new files are found
- [x] 1.3 Start polling via `setInterval(pollDirectory, 1000)` at the end of `handleDirectorySelected()`, storing the interval ID in `pollIntervalId`
- [x] 1.4 Clear any existing `pollIntervalId` at the start of `handleDirectorySelected()` to prevent duplicate polling on re-selection

## 2. Reload button

- [x] 2.1 Add a reload button (`🔄`) in `<header>` in `index.html`, with `hidden` class by default, ID `btn-reload`
- [x] 2.2 Style the reload button consistently with existing header buttons
- [x] 2.3 Wire `btn-reload` click to a new exported `handleReload()` function in `chapter-nav.js`
- [x] 2.4 Implement `handleReload()` to immediately call `pollDirectory()` (reuse the same logic)
- [x] 2.5 Show `btn-reload` (remove `hidden`) in `handleDirectorySelected()` alongside other nav buttons
- [x] 2.6 Pass `btnReload` element reference to `initChapterNav()` from the module script in `index.html`

## 3. Non-blocking file access verification

- [x] 3.1 Verify that `readFileContent()` in `file-reader.js` uses `getFile()` (snapshot-based, no lock) — document with a JSDoc comment confirming non-blocking behaviour

## 4. Validation

- [x] 4.1 Start dev server, load a story folder, verify polling detects new files added externally
- [x] 4.2 Verify the reload button appears after folder selection and triggers a re-scan
- [x] 4.3 Verify the current chapter display is not disrupted when new files are detected
