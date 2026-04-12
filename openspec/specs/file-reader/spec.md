# File Reader

## Purpose

Handles client-side folder selection and markdown file discovery using the browser's File System Access API, including numeric file filtering, sorting, content reading, browser compatibility detection, and directory handle persistence.

## Requirements

### Requirement: Folder selection via File System Access API
The application SHALL provide a UI element (button within a Vue component) that invokes `window.showDirectoryPicker()` to let the user select a local folder containing markdown story files. The File System Access API logic SHALL be encapsulated in a `useFileReader()` Vue composable that returns reactive refs for the directory handle, discovered files, and loading state. The application MUST NOT require a server or backend for FSA mode — all file access SHALL occur client-side through the browser's File System Access API.

#### Scenario: User selects a valid folder
- **WHEN** the user clicks the folder-selection button and picks a directory containing `.md` files
- **THEN** the `useFileReader()` composable SHALL update its reactive `files` ref with all markdown files matching the numeric naming pattern

#### Scenario: User cancels the folder picker
- **WHEN** the user opens the directory picker dialog but cancels without selecting a folder
- **THEN** the composable's reactive state SHALL remain unchanged, no errors SHALL occur, and no files SHALL be loaded

### Requirement: Numeric markdown file filtering
The `useFileReader()` composable SHALL only recognize files whose names match the pattern of one or more leading digits followed by `.md` (e.g., `001.md`, `02.md`, `1.md`). All other files in the selected directory SHALL be ignored. The filtering logic SHALL be implemented as a pure TypeScript utility function.

#### Scenario: Directory contains mixed file types
- **WHEN** the selected folder contains `001.md`, `002.md`, `notes.txt`, `readme.md`, and `003.md`
- **THEN** only `001.md`, `002.md`, and `003.md` SHALL be recognized as chapter files; `notes.txt` and `readme.md` SHALL be ignored

#### Scenario: Directory contains no matching files
- **WHEN** the selected folder contains no files matching the numeric `.md` pattern
- **THEN** the composable SHALL set a reactive state indicating no chapter files were found

### Requirement: Sorting by numeric order
The recognized markdown files SHALL be sorted in ascending numeric order based on the leading digits of their filenames. The sort MUST be numeric, not lexicographic. The sorting logic SHALL be a pure TypeScript utility function used by the composable.

#### Scenario: Files are sorted numerically
- **WHEN** the directory contains `1.md`, `002.md`, `10.md`, and `3.md`
- **THEN** the composable's `files` ref SHALL contain them in order: `1.md`, `002.md`, `3.md`, `10.md`

### Requirement: Reading file contents as text
The composable SHALL read each recognized markdown file as UTF-8 text using the `FileSystemFileHandle.getFile()` and `File.text()` APIs, returning the content through a reactive ref or an async method.

#### Scenario: Reading a chapter file
- **WHEN** a chapter file is selected for display
- **THEN** the composable SHALL read its full text content as a UTF-8 string and make it available via reactive state for the rendering pipeline

### Requirement: Unsupported browser detection
The `useFileReader()` composable SHALL detect whether the File System Access API (`window.showDirectoryPicker`) is available in the current browser. If not available, the composable SHALL set a reactive `isSupported` ref to `false`. The component using the composable MUST display a clear error message indicating the required browser support.

#### Scenario: Browser does not support File System Access API
- **WHEN** the page is loaded in a browser that does not implement `window.showDirectoryPicker`
- **THEN** the composable's `isSupported` ref SHALL be `false` and the component SHALL display a message informing the user that their browser is not supported

### Requirement: Directory handle persistence
The `useFileReader()` composable SHOULD persist the selected directory handle using IndexedDB so that the user can re-open the same folder without re-selecting it on subsequent visits. The composable SHALL expose a reactive `hasStoredHandle` ref and methods to restore or clear the persisted handle. The component SHALL provide a UI affordance to restore the previous folder or select a new one.

#### Scenario: Returning user restores previous folder
- **WHEN** a user revisits the page and the composable detects a stored directory handle in IndexedDB
- **THEN** the composable SHALL attempt to re-request permission via `handle.requestPermission()` and, upon grant, update its `files` reactive ref from the stored directory

#### Scenario: Permission denied on restore
- **WHEN** the user revisits the page but denies the permission prompt for the stored directory handle
- **THEN** the composable SHALL set `hasStoredHandle` to `false` and the component SHALL fall back to showing the folder-selection button

### Requirement: Non-blocking file access
The file reading mechanism SHALL use snapshot-based access (via `FileSystemFileHandle.getFile()`) that does not hold persistent file locks. Other applications SHALL be able to freely read, write, and edit the same files while the reader has the directory open.

#### Scenario: External application can edit files while reader is open
- **WHEN** the reader has a directory open and is displaying a chapter
- **THEN** external applications SHALL be able to write to or modify any `.md` file in the directory without being blocked by the reader

#### Scenario: File content is read as a snapshot
- **WHEN** the reader loads a chapter file via the composable
- **THEN** the file content SHALL be read as a point-in-time snapshot (blob), and no file handle or lock SHALL be held after reading completes

### Requirement: Backend-driven file loading

The reader frontend SHALL support loading chapter files from the backend API (`/api/stories/:series/:name/chapters`) as an alternative to the FSA API. When a story is selected via the story selector, the frontend SHALL fetch chapters through the backend API. This backend loading logic MAY reside in `useChapterNav()` or a separate `useBackendChapters()` composable. The existing FSA mode via `useFileReader()` MUST be preserved and SHALL continue to function as before.

#### Scenario: Load chapters from backend API
- **WHEN** a story is selected via the story selector component
- **THEN** the frontend SHALL call `GET /api/stories/:series/:name/chapters` to list chapters, then fetch each chapter's content, and update reactive state for rendering

#### Scenario: FSA chooser remains functional
- **WHEN** the user clicks the FSA directory chooser button
- **THEN** the `useFileReader()` composable SHALL use the File System Access API to load chapter files from the local filesystem

#### Scenario: Switching between loading modes
- **WHEN** the user loads a story via the backend API and then uses the FSA chooser (or vice versa)
- **THEN** the reactive state SHALL be cleared and reloaded from the newly selected source without errors

#### Scenario: Backend API unavailable
- **WHEN** the backend API is unreachable or returns an error during chapter loading
- **THEN** the frontend SHALL display an error message via reactive state and the FSA chooser SHALL remain available as a fallback

### Requirement: Composable API contract
The `useFileReader()` composable SHALL return a well-typed interface including at minimum: `isSupported` (Ref<boolean>), `directoryHandle` (Ref<FileSystemDirectoryHandle | null>), `files` (Ref<FileSystemFileHandle[]>), `hasStoredHandle` (Ref<boolean>), `openDirectory()` (async method), `restoreHandle()` (async method), `readFile(handle: FileSystemFileHandle): Promise<string>`, and `clearStoredHandle()`. All reactive state SHALL be encapsulated within the composable.

#### Scenario: Composable returns typed reactive interface
- **WHEN** a Vue component calls `useFileReader()`
- **THEN** the returned object SHALL contain typed reactive refs and methods as specified, and no module-level mutable state SHALL exist outside the composable

### Requirement: Singleton composable shared state preservation
The `useFileReader()` composable uses a shared singleton pattern (module-level refs). Because multiple components may share this state, individual component unmounts SHALL NOT clear shared reactive refs (`directoryHandle`, `files`, `hasStoredHandle`, `isSupported`). Clearing shared refs on one component's unmount would destroy state still in use by other components. IndexedDB persisted handles SHALL NOT be cleared on unmount. Shared state is only released when the entire Vue application is destroyed.

#### Scenario: Shared refs survive component unmount
- **WHEN** a component using `useFileReader()` is unmounted while another component still uses the same composable
- **THEN** the shared `directoryHandle` and `files` refs SHALL retain their current values and remain usable by the other component

#### Scenario: IndexedDB handle preserved across unmounts
- **WHEN** any component using `useFileReader()` is unmounted
- **THEN** the IndexedDB stored handle SHALL be preserved for session restoration
