# Auto-Reload Polling (Delta)

Delta spec for the vue-typescript-refactor change.

## MODIFIED Requirements

### Requirement: Automatic directory polling

The `useChapterNav()` composable SHALL poll the selected directory to detect new chapter files. In FSA mode (File System Access API), the polling interval SHALL be every 1 second. In Backend mode, the polling interval SHALL be every 3 seconds. When new `.md` files matching the chapter naming pattern are found, the internal reactive file list SHALL be updated and the navigation UI SHALL reflect the new chapter count without disrupting the current chapter being displayed. The polling logic SHALL be encapsulated within the composable using Vue's `onMounted()` / `onUnmounted()` lifecycle hooks for setup and teardown instead of imperative `setInterval`/`clearInterval` managed by module-scoped state.

#### Scenario: New chapter file appears during reading
- **WHEN** the user is reading chapter 3 of 5 and a new file `006.md` is written to the directory by an external application
- **THEN** within the polling interval (1s for FSA, 3s for Backend), the chapter progress indicator SHALL update to show "3 / 6" and the "Next" button SHALL remain enabled, without changing the displayed chapter content or scroll position

#### Scenario: Polling starts after directory selection
- **WHEN** a directory is successfully selected (either via picker or session restore)
- **THEN** the polling interval SHALL begin automatically (1s for FSA mode, 3s for Backend mode)

#### Scenario: Previous polling stops on new directory selection
- **WHEN** the user selects a new directory while polling is active for a previous directory
- **THEN** the previous polling interval SHALL be stopped before starting a new one

#### Scenario: Polling lifecycle managed by composable
- **WHEN** the component using `useChapterNav()` is unmounted
- **THEN** the polling interval SHALL be automatically cleaned up via the composable's `onUnmounted()` hook, preventing memory leaks

### Requirement: Manual reload button

The application SHALL provide a reload button (🔄) in the header component that allows the user to manually re-scan the directory for new chapter files. The button click SHALL be wired via a Vue component event handler (e.g., `@click`) instead of an imperative DOM event listener added via `addEventListener`. The button SHALL be hidden until a story folder is loaded, controlled by Vue's conditional rendering (`v-show` or `v-if`).

#### Scenario: Reload button triggers directory re-scan
- **WHEN** the user clicks the reload button
- **THEN** the application SHALL immediately re-scan the directory for chapter files and update the file list and navigation UI

#### Scenario: Reload button hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the reload button SHALL not be visible in the header

#### Scenario: Reload button uses Vue event binding
- **WHEN** the reload button is rendered in the header component
- **THEN** its click handler SHALL be bound via `@click` directive in the Vue template instead of an imperative `addEventListener` call

### Requirement: Rate-limit backoff

When the backend returns a 429 (Too Many Requests) response, the polling interval SHALL increase using exponential backoff, capped at 30 seconds. On the next successful response, the interval SHALL reset to the base 3-second interval. The backoff state SHALL be managed as reactive state within the `useChapterNav()` composable.

#### Scenario: 429 response triggers backoff
- **WHEN** `pollBackend` receives a 429 response
- **THEN** the polling interval SHALL double (up to a maximum of 30 seconds)

#### Scenario: Successful response resets interval
- **WHEN** `pollBackend` receives a successful response after backoff
- **THEN** the polling interval SHALL reset to 3 seconds
