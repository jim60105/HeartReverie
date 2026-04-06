# File Reader

## Purpose

Handles client-side folder selection and markdown file discovery using the browser's File System Access API, including numeric file filtering, sorting, content reading, browser compatibility detection, and directory handle persistence.

## Requirements

### Requirement: Folder selection via File System Access API
The application SHALL provide a button that invokes `window.showDirectoryPicker()` to let the user select a local folder containing markdown story files. The application MUST NOT require a server or backend — all file access SHALL occur client-side through the browser's File System Access API.

#### Scenario: User selects a valid folder
- **WHEN** the user clicks the folder-selection button and picks a directory containing `.md` files
- **THEN** the application SHALL read the directory entries and identify all markdown files matching the numeric naming pattern

#### Scenario: User cancels the folder picker
- **WHEN** the user opens the directory picker dialog but cancels without selecting a folder
- **THEN** the application SHALL remain in its current state without errors and no files SHALL be loaded

### Requirement: Numeric markdown file filtering
The application SHALL only recognize files whose names match the pattern of one or more leading digits followed by `.md` (e.g., `001.md`, `02.md`, `1.md`). All other files in the selected directory SHALL be ignored.

#### Scenario: Directory contains mixed file types
- **WHEN** the selected folder contains `001.md`, `002.md`, `notes.txt`, `readme.md`, and `003.md`
- **THEN** only `001.md`, `002.md`, and `003.md` SHALL be recognized as chapter files; `notes.txt` and `readme.md` SHALL be ignored

#### Scenario: Directory contains no matching files
- **WHEN** the selected folder contains no files matching the numeric `.md` pattern
- **THEN** the application SHALL display an informative message indicating that no chapter files were found

### Requirement: Sorting by numeric order
The recognized markdown files SHALL be sorted in ascending numeric order based on the leading digits of their filenames. The sort MUST be numeric, not lexicographic.

#### Scenario: Files are sorted numerically
- **WHEN** the directory contains `1.md`, `002.md`, `10.md`, and `3.md`
- **THEN** the files SHALL be ordered as `1.md`, `002.md`, `3.md`, `10.md`

### Requirement: Reading file contents as text
The application SHALL read each recognized markdown file as UTF-8 text using the `FileSystemFileHandle.getFile()` and `File.text()` APIs.

#### Scenario: Reading a chapter file
- **WHEN** a chapter file is selected for display
- **THEN** the application SHALL read its full text content as a UTF-8 string and pass it to the rendering pipeline

### Requirement: Unsupported browser detection
The application SHALL detect whether the File System Access API (`window.showDirectoryPicker`) is available in the current browser. If not available, the application MUST display a clear error message indicating the required browser support.

#### Scenario: Browser does not support File System Access API
- **WHEN** the page is loaded in a browser that does not implement `window.showDirectoryPicker`
- **THEN** the application SHALL display a message informing the user that their browser is not supported and suggesting a compatible browser (e.g., Chrome, Edge)

### Requirement: Directory handle persistence
The application SHOULD persist the selected directory handle using IndexedDB so that the user can re-open the same folder without re-selecting it on subsequent visits. The application SHALL provide a UI affordance to restore the previous folder or select a new one.

#### Scenario: Returning user restores previous folder
- **WHEN** a user revisits the page and a previously stored directory handle exists
- **THEN** the application SHALL attempt to re-request permission via `handle.requestPermission()` and, upon grant, load the files from the stored directory

#### Scenario: Permission denied on restore
- **WHEN** the user revisits the page but denies the permission prompt for the stored directory handle
- **THEN** the application SHALL fall back to showing the folder-selection button without loading any files

### Requirement: Non-blocking file access
The file reading mechanism SHALL use snapshot-based access (via `FileSystemFileHandle.getFile()`) that does not hold persistent file locks. Other applications SHALL be able to freely read, write, and edit the same files while the reader has the directory open.

#### Scenario: External application can edit files while reader is open
- **WHEN** the reader has a directory open and is displaying a chapter
- **THEN** external applications SHALL be able to write to or modify any `.md` file in the directory without being blocked by the reader

#### Scenario: File content is read as a snapshot
- **WHEN** the reader loads a chapter file
- **THEN** the file content SHALL be read as a point-in-time snapshot (blob), and no file handle or lock SHALL be held after reading completes

### Requirement: Backend-driven file loading

The reader frontend SHALL support loading chapter files from the backend API (`/api/stories/:series/:name/chapters`) as an alternative to the existing File System Access (FSA) API chooser. When a story is selected via the story selector panel, the frontend SHALL fetch chapters through the backend API instead of requiring the user to pick a local directory. The existing FSA chooser MUST be preserved and SHALL continue to function as before.

#### Scenario: Load chapters from backend API
- **WHEN** a story is selected via the story selector panel
- **THEN** the frontend SHALL call `GET /api/stories/:series/:name/chapters` to list chapters, then fetch each chapter's content via `GET /api/stories/:series/:name/chapters/:number`, and render them in the reader view

#### Scenario: FSA chooser remains functional
- **WHEN** the user clicks the existing FSA directory chooser button
- **THEN** the frontend SHALL use the File System Access API to load chapter files from the local filesystem, exactly as it does today

#### Scenario: Switching between loading modes
- **WHEN** the user loads a story via the backend API and then uses the FSA chooser (or vice versa)
- **THEN** the frontend SHALL clear the previous content and load from the newly selected source without errors

#### Scenario: Backend API unavailable
- **WHEN** the backend API is unreachable or returns an error during chapter loading
- **THEN** the frontend SHALL display an error message and the FSA chooser SHALL remain available as a fallback
