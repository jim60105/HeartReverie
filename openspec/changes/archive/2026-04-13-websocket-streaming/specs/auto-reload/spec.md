## MODIFIED Requirements

### Requirement: Automatic directory polling

The `useChapterNav()` composable SHALL poll the selected directory to detect new chapter files. In FSA mode (File System Access API), the polling interval SHALL be every 1 second. In Backend mode, the composable SHALL use WebSocket push notifications for chapter updates when a WebSocket connection is active, eliminating the need for HTTP polling. When the WebSocket connection is unavailable or disconnected, the composable SHALL fall back to the existing 3-second HTTP polling mechanism. When new `.md` files matching the chapter naming pattern are found (via either WebSocket push or polling), the internal reactive file list SHALL be updated and the navigation UI SHALL reflect the new chapter count without disrupting the current chapter being displayed. The polling logic SHALL be encapsulated within the composable using Vue's `onMounted()` / `onUnmounted()` lifecycle hooks for setup and teardown.

#### Scenario: New chapter file appears during reading
- **WHEN** the user is reading chapter 3 of 5 and a new file `006.md` is written to the directory by an external application
- **THEN** within the polling interval (1s for FSA, 3s for Backend polling fallback) or immediately via WebSocket push, the chapter progress indicator SHALL update to show "3 / 6" and the "Next" button SHALL remain enabled, without changing the displayed chapter content or scroll position

#### Scenario: Polling starts after directory selection
- **WHEN** a directory is successfully selected (either via picker or session restore)
- **THEN** the polling interval SHALL begin automatically (1s for FSA mode, 3s for Backend mode when WebSocket is disconnected)

#### Scenario: Previous polling stops on new directory selection
- **WHEN** the user selects a new directory while polling is active for a previous directory
- **THEN** the previous polling interval SHALL be stopped before starting a new one

#### Scenario: Polling lifecycle managed by composable
- **WHEN** the component using `useChapterNav()` is unmounted
- **THEN** the polling interval SHALL be automatically cleaned up via the composable's `onUnmounted()` hook, preventing memory leaks

#### Scenario: WebSocket replaces polling in backend mode
- **WHEN** the WebSocket connection is active and authenticated in backend mode
- **THEN** the composable SHALL stop the 3-second HTTP polling interval and rely on `chapters:updated` and `chapters:content` WebSocket messages for real-time updates

#### Scenario: Polling resumes on WebSocket disconnection
- **WHEN** the WebSocket connection is lost while in backend mode
- **THEN** the composable SHALL resume the 3-second HTTP polling mechanism within one polling cycle

### Requirement: Rate-limit backoff

When the backend returns a 429 (Too Many Requests) response, the polling interval SHALL increase using exponential backoff, capped at 30 seconds. On the next successful response, the interval SHALL reset to the base 3-second interval. The backoff state SHALL be managed as reactive state within the `useChapterNav()` composable. This requirement applies only to the HTTP polling fallback — WebSocket push notifications are not subject to rate limiting.

#### Scenario: 429 response triggers backoff
- **WHEN** `pollBackend` receives a 429 response
- **THEN** the polling interval SHALL double (up to a maximum of 30 seconds)

#### Scenario: Successful response resets interval
- **WHEN** `pollBackend` receives a successful response after backoff
- **THEN** the polling interval SHALL reset to 3 seconds

#### Scenario: WebSocket mode not affected by rate-limit backoff
- **WHEN** the WebSocket connection is active
- **THEN** the rate-limit backoff state SHALL be irrelevant because no HTTP polling requests are being made
