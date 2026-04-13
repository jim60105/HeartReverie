## Context

The reader currently loads the file list once when a directory is selected. During a SillyTavern session, the AI writes new chapter files to disk in real-time. Users must refresh the page to see new chapters. The File System Access API's `getFile()` method returns a snapshot of the file (a `File` blob), so it never holds a file lock — other apps can freely edit files.

## Goals / Non-Goals

**Goals:**
- D1: Poll the directory every 1 second and update the file list when new `.md` files appear
- D2: When new files are detected, update nav state (progress indicator, Next button) without disrupting the current chapter being read
- D3: Add a visible reload button in the header for manual directory re-scan
- D4: Formally specify that file access is non-blocking (snapshot-based, no file locking)

**Non-Goals:**
- Auto-navigating to new chapters (user must explicitly click Next or use keyboard)
- Watching for file content changes in already-loaded chapters (only detecting new files)
- Detecting deleted files or file renames

## Decisions

### D1: Polling via `setInterval` at 1-second interval
Use `setInterval` to call `listChapterFiles()` every 1 second after a directory is loaded. Compare the new file count to the current count — if new files appear, update `state.files` and re-run `updateNavState()`. This is simpler and more compatible than the experimental `FileSystemObserver` API.

### D2: Non-disruptive update strategy
When new files are detected, only update the internal file list and nav UI. Do NOT re-render the current chapter or change scroll position. The user's reading experience is uninterrupted.

### D3: Reload button placement
Add a 🔄 button in the `<header>` next to the folder name, hidden until a directory is loaded. Clicking it re-scans the directory immediately (same as what the polling does, but on-demand).

### D4: Polling lifecycle
- Start polling when `handleDirectorySelected()` succeeds
- Stop any existing poll when a new directory is selected (prevent duplicates)
- No need to stop on page unload — the interval is cleared by garbage collection

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Performance from 1-second polling | `listChapterFiles()` only iterates directory entries — lightweight. No file content is read during polling. |
| Race condition between poll and manual nav | Poll only updates `state.files` and `updateNavState()` — loading a chapter reads from the updated list |
| Stale file handles after external rename/delete | Out of scope (Non-Goal). Handles may throw on access — existing silent error handling covers this. |
