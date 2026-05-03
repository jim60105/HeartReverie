## REMOVED Requirements

### Requirement: File System Access API folder selection

**Reason**: The folder-picker UI was removed in commit `4f3f91fe`, leaving the FSA codepath unreachable from production. The composable, its IndexedDB persistence layer, and every `mode === "fsa"` branch are now deleted; backend mode becomes the sole reader mode.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Numeric markdown file filtering

**Reason**: The numeric `.md` filtering rule lived inside `useFileReader()`. Backend chapter listing already enforces equivalent semantics through `GET /api/stories/:series/:name/chapters`, so no replacement requirement is needed in this capability.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Sorting by numeric order

**Reason**: Numeric sort lived inside `useFileReader()`. Backend chapter listing returns chapters already ordered by numeric chapter number, so no replacement requirement is needed in this capability.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Reading file contents as text

**Reason**: Snapshot-based file reads via `FileSystemFileHandle.getFile()` are gone with the FSA composable. Backend mode reads chapter content over HTTP/WebSocket and has its own freshness contract.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Unsupported browser detection

**Reason**: With FSA removed there is no longer a feature to detect support for. The frontend no longer relies on `window.showDirectoryPicker` or any other Secure-Context-only API.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Directory handle persistence

**Reason**: IndexedDB persistence (`storyReaderDB`) existed solely to restore a previously selected directory handle. With FSA gone there is nothing to persist; IndexedDB is no longer used anywhere in the project.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Non-blocking file access

**Reason**: The "snapshot, no file lock" guarantee was a property of the FSA path. Backend mode reads chapter content over HTTP and never holds OS-level file locks regardless.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Backend-driven file loading

**Reason**: This requirement existed to coexist with the FSA path. Backend mode is now the only mode and its behaviour is fully covered by `chapter-navigation` and `auto-reload` specs; restating it here is redundant.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Composable API contract

**Reason**: The `useFileReader()` composable is deleted entirely, including its `UseFileReaderReturn` type and every method (`openDirectory`, `restoreHandle`, `readFile`, `clearStoredHandle`).

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.

### Requirement: Singleton composable shared state preservation

**Reason**: The shared singleton refs (`directoryHandle`, `files`, `hasStoredHandle`, `isSupported`) only existed because `useFileReader()` existed. With the composable deleted, there is no shared FSA state to preserve.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is operationally harmless to the app because no remaining code reads it; users may clear site data to remove the stale `storyReaderDB` IndexedDB entry and any associated `FileSystemDirectoryHandle` permission grant.
