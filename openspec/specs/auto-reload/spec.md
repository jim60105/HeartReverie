# Auto Reload

## Purpose

Provides automatic detection of new chapter files through directory polling and a manual reload button, enabling real-time updates when external applications write new content.

## Requirements

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
