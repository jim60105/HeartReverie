# Tasks — fix-browser-console-errors

## 1. CSP connect-src update
- [x] 1.1 In `reader/index.html`, update the CSP meta tag's `connect-src` from `'self'` to `'self' https://cdn.jsdelivr.net`

## 2. Passphrase form wrapper
- [x] 2.1 In `reader/index.html`, wrap the passphrase `<input>` and its sibling `<div>` (containing error span + submit button) in a `<form id="passphrase-form">` element
- [x] 2.2 In `reader/js/passphrase-gate.js`, replace the button click listener and input keydown Enter listener with a single form `submit` event listener that calls `event.preventDefault()` then `handleSubmit()`

## 3. Stale FSA handle recovery
- [x] 3.1 In `reader/js/file-reader.js`, add an exported `clearDirectoryHandle()` function that deletes the stored handle from IndexedDB
- [x] 3.2 In `reader/js/chapter-nav.js`, wrap `handleDirectorySelected(restored)` inside `tryRestoreSession()` with try/catch; on error, call `clearDirectoryHandle()` to remove the stale entry
