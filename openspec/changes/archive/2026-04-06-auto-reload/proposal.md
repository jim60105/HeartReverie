## Why

During SillyTavern AI chat sessions, new story chapter files are written to disk in real-time. The reader currently requires a manual page refresh to detect new chapters. Adding automatic directory polling lets the reader detect and make new chapters navigable without user intervention, enabling a live reading experience alongside active AI writing sessions.

## What Changes

- Add a 1-second interval polling loop that re-scans the directory for new `.md` files and updates the file list when changes are detected
- When new files appear, update the chapter progress indicator and enable the "Next" button so the user can navigate to the new chapter
- Add a manual reload button (🔄) in the header for users to explicitly re-scan the directory
- Document in spec that file reading uses snapshot-based access (`getFile()`) with no persistent file locking, ensuring other applications can freely edit files

## Capabilities

### New Capabilities

- `auto-reload`: Automatic directory polling and manual reload button

### Modified Capabilities

- `file-reader`: Add non-blocking file access requirement (no file locking)
- `chapter-navigation`: Update navigation to handle dynamically growing file lists
