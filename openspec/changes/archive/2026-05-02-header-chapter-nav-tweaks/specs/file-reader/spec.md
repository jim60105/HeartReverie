## MODIFIED Requirements

### Requirement: File System Access API folder selection

The application SHALL retain a `useFileReader()` Vue composable that wraps `window.showDirectoryPicker()`, returning reactive refs for the directory handle, discovered files, and loading state. The File System Access API logic SHALL remain client-side and SHALL NOT require a server or backend for FSA mode. The application SHALL NOT render a UI button or link that invokes the directory picker; FSA mode SHALL therefore be unreachable from the default reader UI until a future change re-introduces an entry point. The composable's API surface (`isSupported`, `directoryHandle`, `openDirectory`, `readFile`) SHALL remain stable so a future re-introduction does not require re-implementing the FSA flow. The header's reload control (`🔄`) SHALL continue to call `useChapterNav().loadFromFSA(directoryHandle.value)` when `mode.value === "fsa"` so that any FSA session entered programmatically (tests, dev tooling, future feature) keeps a working reload path; the reload control SHALL NOT itself open the directory picker.

#### Scenario: Composable still exists and is importable

- **WHEN** a Vue component imports `useFileReader` from `@/composables/useFileReader`
- **THEN** the import SHALL resolve to a composable returning the same reactive refs (`isSupported`, `directoryHandle`, `openDirectory`, `readFile`, etc.) as before this change

#### Scenario: No folder-picker button rendered in default UI

- **WHEN** the default reader shell (`AppHeader.vue` and any other always-mounted component) renders
- **THEN** no button or link SHALL invoke `useFileReader().openDirectory()` from that shell

#### Scenario: FSA mode still functions when triggered programmatically

- **WHEN** code (e.g., a future feature, a test, or a developer tool) calls `useFileReader().openDirectory()` followed by `useChapterNav().loadFromFSA(handle)`
- **THEN** the existing FSA flow SHALL run unchanged — the composable, IndexedDB persistence, chapter loading paths, and the header reload control's FSA branch SHALL continue to function exactly as specified prior to this change
