## MODIFIED Requirements

### Requirement: Automatic directory polling

The `useChapterNav()` composable SHALL receive chapter updates via two channels: WebSocket push notifications when a WebSocket connection is active, and a 3-second HTTP polling fallback when the WebSocket connection is unavailable or disconnected. When new `.md` files matching the chapter naming pattern are detected (via either WebSocket push or polling), the internal reactive file list SHALL be updated and the navigation UI SHALL reflect the new chapter count without disrupting the current chapter being displayed. The polling logic SHALL be encapsulated within the composable using Vue's `onMounted()` / `onUnmounted()` lifecycle hooks for setup and teardown.

#### Scenario: New chapter file appears during reading
- **WHEN** the user is reading chapter 3 of 5 and a new file `006.md` is written to the backend's story directory by an external process
- **THEN** within the 3-second HTTP polling fallback interval or immediately via WebSocket push, the chapter progress indicator SHALL update to show "3 / 6" and the "Next" button SHALL remain enabled, without changing the displayed chapter content or scroll position

#### Scenario: Polling starts after story load
- **WHEN** a backend story is successfully loaded
- **THEN** the WebSocket subscription SHALL begin immediately when a connection is active, and the 3-second HTTP polling fallback SHALL begin when no WebSocket connection is available

#### Scenario: Previous polling stops on new story selection
- **WHEN** the user selects a new story while polling is active for a previous story
- **THEN** the previous polling interval SHALL be stopped before starting a new one

#### Scenario: Polling lifecycle managed by composable
- **WHEN** the component using `useChapterNav()` is unmounted
- **THEN** the polling interval SHALL be automatically cleaned up via the composable's `onUnmounted()` hook, preventing memory leaks

#### Scenario: WebSocket replaces polling
- **WHEN** the WebSocket connection is active and authenticated
- **THEN** the composable SHALL stop the 3-second HTTP polling interval and rely on `chapters:updated` and `chapters:content` WebSocket messages for real-time updates

#### Scenario: Polling resumes on WebSocket disconnection
- **WHEN** the WebSocket connection is lost
- **THEN** the composable SHALL resume the 3-second HTTP polling mechanism within one polling cycle
