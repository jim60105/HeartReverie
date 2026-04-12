## MODIFIED Requirements

### Requirement: Auto-reload polling with content awareness

In backend mode, the `useChapterNav()` composable SHALL receive chapter updates via two channels:

1. **WebSocket push (primary)**: When a WebSocket connection is active, the composable SHALL process incoming `chapters:updated` and `chapters:content` messages to update reactive state in real time. On receiving `chapters:updated`, the composable SHALL update its `chapters` reactive ref to reflect the new chapter count. On receiving `chapters:content`, the composable SHALL update the cached content for the specified chapter, triggering a re-render if the user is viewing that chapter.

2. **HTTP polling (fallback)**: When the WebSocket connection is unavailable, the composable SHALL fall back to the existing 3-second polling mechanism that fetches the last chapter's content and compares it with the cached content.

Only the last chapter's content SHALL be fetched on each poll tick (not all chapters) to keep polling efficient.

The rendering pipeline SHALL strip `<user_message>…</user_message>` blocks and their enclosed content from chapter markdown before conversion to HTML.

#### Scenario: New chapter detected via WebSocket push
- **WHEN** the WebSocket delivers `{ type: "chapters:updated", series: "s1", story: "n1", count: 6 }` and the current chapter count is 5
- **THEN** the composable SHALL update its `chapters` reactive ref to reflect 6 chapters, triggering a full reload of chapter metadata from the backend

#### Scenario: Last chapter content updated via WebSocket push
- **WHEN** the WebSocket delivers `{ type: "chapters:content", series: "s1", story: "n1", chapter: 6, content: "新的內容" }` and the user is viewing chapter 6
- **THEN** the cached content SHALL be updated reactively and Vue's reactivity SHALL trigger a re-render showing the new content immediately (no 3-second delay)

#### Scenario: New chapter detected during HTTP polling fallback
- **WHEN** the WebSocket is disconnected and the polling mechanism detects that the chapter count has changed
- **THEN** the composable SHALL update its `chapters` reactive ref, triggering a full reload of all chapters from the backend

#### Scenario: Last chapter content changes during HTTP polling fallback
- **WHEN** the WebSocket is disconnected and the polling mechanism detects that the last chapter's content has changed compared to the cached version
- **THEN** the cached content SHALL be updated reactively and, if the user is currently viewing that chapter, Vue's reactivity SHALL trigger a re-render

#### Scenario: Content unchanged during polling
- **WHEN** the polling mechanism fetches the last chapter's content and it matches the cached version
- **THEN** no reactive update SHALL occur and the cached state SHALL remain unchanged

#### Scenario: User message hidden in rendered output
- **WHEN** a chapter's raw content contains a `<user_message>…</user_message>` block
- **THEN** the rendering pipeline SHALL remove the block and its content so that only the AI-generated story content is displayed to the reader

### Requirement: Vue composable API contract
The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<ChapterData[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), `currentContent` (Ref<string>), `mode` (Ref<"fsa" | "backend">), `folderName` (Ref<string>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, `loadFromFSA(dirHandle)`, `loadFromBackend(series, story, startChapter?)`, and `getBackendContext()`. The `next()` and `previous()` methods SHALL update `currentIndex`, which triggers a `watch` effect that calls `syncRoute()` to update the URL via `router.replace()` in backend mode. The `loadFromBackend(series, story, startChapter?)` method SHALL load chapter data from the backend API, set `currentIndex` to `startChapter` (clamped to valid range) or 0, and call `syncRoute()` to update the URL. Story-level navigation (e.g., from the story selector) SHALL use `navigateToStory()` in `useStorySelector` which calls `router.push()`, and the route watcher in `useChapterNav` SHALL react to load the new story. The `reloadToLast()` method SHALL reload chapters and update the route to the last chapter via `syncRoute()`. A module-level `loadToken` counter SHALL protect against stale results from concurrent loads. Additionally, `loadFromBackend` SHALL trigger a WebSocket `subscribe` message for the loaded story when a WebSocket connection is active.

#### Scenario: Composable returns typed reactive interface
- **WHEN** a Vue component calls `useChapterNav()`
- **THEN** the returned object SHALL contain typed reactive refs (`currentIndex`, `chapters`, `currentContent`, `mode`, `folderName`), computed properties (`totalChapters`, `isFirst`, `isLast`, `isLastChapter`), and methods (`next`, `previous`, `loadFromFSA`, `loadFromBackend`, `reloadToLast`, `getBackendContext`)

#### Scenario: reloadToLast navigates to the newest chapter
- **WHEN** the chat input component calls `reloadToLast()` after sending a message
- **THEN** the composable SHALL reload chapters from the current source (backend API or FSA), set `currentIndex` to the last chapter, and call `syncRoute()` to update the URL in backend mode

#### Scenario: Backend context available for prompt preview
- **WHEN** the prompt preview component calls `useChapterNav()`
- **THEN** it SHALL have access to `getBackendContext()` which returns `{ series, story, isBackendMode }` to construct API requests for prompt rendering

#### Scenario: next() updates route in backend mode
- **WHEN** the user clicks the Next button in backend mode viewing chapter 3 of 10
- **THEN** `next()` SHALL increment `currentIndex` to `3`, and the `watch(currentIndex)` effect SHALL call `syncRoute()` → `router.replace()` to update the URL to `/:series/:story/chapter/4`

#### Scenario: Story loading triggers via route watcher
- **WHEN** the story selector calls `navigateToStory('my-series', 'my-story')` which pushes to `/:series/:story`
- **THEN** the route watcher in `useChapterNav` SHALL detect the series/story params change and call `loadFromBackend()` to load the story's chapters

#### Scenario: Concurrent loads discard stale results
- **WHEN** `loadFromBackend()` is called twice in rapid succession (e.g., user switches stories quickly)
- **THEN** the first load's results SHALL be discarded via the `loadToken` counter, and only the second load's results SHALL be applied

#### Scenario: loadFromBackend subscribes via WebSocket
- **WHEN** `loadFromBackend('my-series', 'my-story')` is called and a WebSocket connection is active
- **THEN** the composable SHALL send `{ type: "subscribe", series: "my-series", story: "my-story" }` via the WebSocket to receive real-time chapter updates
