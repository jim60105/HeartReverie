# Chapter Navigation — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

### Requirement: Load first chapter on folder selection
When the user selects a folder and chapter files are successfully identified, the application SHALL automatically load and render the first chapter (lowest numeric index) without requiring additional user interaction. Navigation state SHALL be managed by a `useChapterNav()` Vue composable that exposes reactive refs (e.g., `currentIndex`, `chapters`, `totalChapters`). The composable SHALL replace the former module-scoped `state` object.

#### Scenario: First chapter loads automatically
- **WHEN** the user selects a folder containing `001.md`, `002.md`, and `003.md`
- **THEN** the `useChapterNav()` composable SHALL set its `currentIndex` ref to `0` and the application SHALL reactively render the content of `001.md` as the current chapter

### Requirement: Next chapter navigation
The application SHALL provide a "Next" navigation button rendered within a Vue header component. Clicking it SHALL update the `currentIndex` reactive ref in `useChapterNav()`, causing Vue's reactivity system to load and render the next chapter in numeric order. The button's visibility SHALL be controlled by a computed property derived from the composable's reactive state. When new chapter files are detected by the polling mechanism, the "Next" button SHALL become enabled if the user is currently on the last known chapter.

#### Scenario: Next button loads subsequent chapter via reactive state
- **WHEN** the user clicks the "Next" button in the header component
- **THEN** the `useChapterNav()` composable SHALL increment `currentIndex`, and the component SHALL reactively render the next chapter in numeric order

#### Scenario: Next button hidden before story is loaded
- **WHEN** no story folder has been selected (composable's `chapters` ref is empty)
- **THEN** the "Next" button SHALL not be visible, controlled by a Vue `v-if` or `v-show` directive bound to reactive state

#### Scenario: Next button enabled when new chapter appears
- **WHEN** the user is viewing the last chapter and a new chapter file is detected by polling
- **THEN** the composable's `chapters` ref SHALL update reactively, and the "Next" button's disabled state (a computed property) SHALL become `false`

### Requirement: Previous chapter navigation
The application SHALL provide a "Previous" navigation button rendered within the Vue header component. Clicking it SHALL decrement the `currentIndex` reactive ref in `useChapterNav()`, causing Vue's reactivity system to load and render the previous chapter. The button's visibility SHALL be controlled by a computed property derived from reactive state.

#### Scenario: Previous button loads preceding chapter via reactive state
- **WHEN** the user clicks the "Previous" button in the header component
- **THEN** the `useChapterNav()` composable SHALL decrement `currentIndex`, and the component SHALL reactively render the previous chapter in numeric order

#### Scenario: Previous button hidden before story is loaded
- **WHEN** no story folder has been selected (composable's `chapters` ref is empty)
- **THEN** the "Previous" button SHALL not be visible, controlled by a Vue directive bound to reactive state

### Requirement: Disable navigation at boundaries
The "Previous" button SHALL be disabled when `currentIndex` equals `0`. The "Next" button SHALL be disabled when `currentIndex` equals `totalChapters - 1`. Disabled state SHALL be derived from computed properties in the `useChapterNav()` composable (e.g., `isFirst`, `isLast`). Disabled buttons SHALL be visually distinguishable from active buttons. When no story is loaded, all navigation controls SHALL be hidden via Vue directives rather than disabled.

#### Scenario: Previous button disabled on first chapter
- **WHEN** the composable's `currentIndex` ref is `0`
- **THEN** the "Previous" button SHALL be disabled via a bound `:disabled="isFirst"` computed property and visually distinguishable from an active button

#### Scenario: Next button disabled on last chapter
- **WHEN** the composable's `currentIndex` ref equals `totalChapters - 1`
- **THEN** the "Next" button SHALL be disabled via a bound `:disabled="isLast"` computed property and visually distinguishable from an active button

#### Scenario: All navigation controls hidden when no story is loaded
- **WHEN** no story folder has been selected (composable's `chapters` ref is empty)
- **THEN** all navigation controls SHALL be hidden via Vue directives (`v-if` or `v-show`), not merely disabled

### Requirement: Chapter progress indicator
The application SHALL display a chapter progress indicator in the header component showing the current chapter number and the total number of chapters (e.g., "Chapter 3 / 10"). Values SHALL be derived from `useChapterNav()` computed properties. The indicator SHALL be hidden via Vue directive until a story folder is selected.

#### Scenario: Progress indicator shows current and total chapters
- **WHEN** a story is loaded and the user is viewing a chapter
- **THEN** the header component SHALL display a chapter progress indicator using the composable's reactive `currentIndex` and `totalChapters` values (e.g., `{{ currentIndex + 1 }} / {{ totalChapters }}`)

#### Scenario: Progress indicator hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the chapter progress indicator SHALL not be visible, controlled by a Vue directive bound to the composable's reactive state

### Requirement: Current chapter state tracking
The `useChapterNav()` composable SHALL synchronize the current chapter index with the URL hash (e.g., `#chapter=3`). The composable SHALL use a `watch` effect on `currentIndex` to update the URL hash, and SHALL read the hash on initialization to restore state. This preserves the reading position on page refresh and enables bookmarking.

#### Scenario: URL hash updates on navigation
- **WHEN** the user navigates to the third chapter (composable's `currentIndex` becomes `2`)
- **THEN** a `watch` effect SHALL update the URL hash to `#chapter=3`

#### Scenario: Page loads with hash in URL
- **WHEN** the page is loaded with `#chapter=5` in the URL and a folder is selected containing at least 5 chapters
- **THEN** the composable SHALL parse the hash on initialization and set `currentIndex` to `4`, navigating to the fifth chapter

### Requirement: Scroll to top on chapter change
The `useChapterNav()` composable SHALL use a `watch` effect on `currentIndex` to scroll the viewport to the top of the content area when the chapter changes. The scroll position SHALL be offset by the height of the sticky header component and the padding-top of the `<main>` element so that the first line of chapter content is not covered.

#### Scenario: Viewport scrolls to top on next chapter
- **WHEN** `currentIndex` changes via the composable
- **THEN** a `watch` effect SHALL scroll the viewport to the top of the rendered chapter content, offset by the sticky header height and main padding-top

#### Scenario: Scroll offset accounts for header and main padding
- **WHEN** the sticky header has a computed height of H pixels and the `<main>` element has a computed padding-top of P pixels, and the user navigates to a new chapter
- **THEN** the scroll position SHALL be set such that the top of the content area is at least (H + P) pixels below the top of the viewport

### Requirement: Auto-reload polling with content awareness

In backend mode, the polling mechanism within `useChapterNav()` SHALL check for new chapters by comparing the chapter count via reactive refs. Additionally, the polling mechanism SHALL fetch the last chapter's content and compare it with the cached content in the composable's reactive state. If the content has changed, the cached content SHALL be updated reactively, triggering a re-render for the user if they are viewing that chapter.

Only the last chapter's content SHALL be fetched on each poll tick (not all chapters) to keep polling efficient.

The rendering pipeline SHALL strip `<user_message>…</user_message>` blocks and their enclosed content from chapter markdown before conversion to HTML. The `<user_message>` content SHALL be preserved in the raw chapter data but SHALL NOT be visible in the rendered output.

#### Scenario: New chapter detected during polling
- **WHEN** the polling mechanism detects that the chapter count has changed
- **THEN** the composable SHALL update its `chapters` reactive ref, triggering a full reload of all chapters from the backend

#### Scenario: Last chapter content changes during polling
- **WHEN** the polling mechanism detects that the last chapter's content has changed compared to the cached version in the composable's reactive state
- **THEN** the cached content SHALL be updated reactively and, if the user is currently viewing that chapter, Vue's reactivity SHALL trigger a re-render in real time

#### Scenario: Content unchanged during polling
- **WHEN** the polling mechanism fetches the last chapter's content and it matches the cached version
- **THEN** no reactive update SHALL occur and the cached state SHALL remain unchanged

#### Scenario: User message hidden in rendered output
- **WHEN** a chapter's raw content contains a `<user_message>…</user_message>` block
- **THEN** the rendering pipeline SHALL remove the block and its content so that only the AI-generated story content is displayed to the reader

### Requirement: Session restoration error handling
The `useChapterNav()` composable's session restoration logic SHALL wrap `handleDirectorySelected` in a try/catch block. If a `NotFoundError` or any other error occurs (stale/deleted directory), it SHALL silently clear the stored handle from IndexedDB and return without crashing.

#### Scenario: Stale directory handle
- **WHEN** a previously saved directory handle points to a directory that no longer exists
- **THEN** the composable's session restoration logic SHALL catch the `NotFoundError`, clear the stale handle from IndexedDB, and return gracefully without console errors

#### Scenario: Valid directory handle
- **WHEN** a previously saved directory handle is still valid
- **THEN** the composable SHALL restore the session normally as before

### Requirement: Single chapter display
The application SHALL display only one chapter at a time. The Vue component SHALL reactively render only the content corresponding to `currentIndex`. When navigating to a new chapter, Vue's reactivity SHALL replace the displayed content without manual DOM manipulation.

#### Scenario: Only current chapter is visible
- **WHEN** the user navigates from chapter 2 to chapter 3
- **THEN** only the content of chapter 3 SHALL be visible; Vue's template binding SHALL ensure chapter 2 content is no longer rendered

### Requirement: Chat input visibility based on current chapter

The `useChapterNav()` composable SHALL expose a reactive computed property `isLastChapter` (and an `isEmpty` computed for the no-chapters case). Parent Vue components SHALL use these reactive properties to conditionally show or hide the chat input component via `v-if` or `v-show` directives. The former callback-based `onChapterChange` pattern SHALL be replaced by reactive computed properties.

#### Scenario: Chat input visible on last chapter
- **WHEN** the composable's `isLastChapter` computed property is `true` in backend mode
- **THEN** the chat input component SHALL be visible via a Vue directive bound to `isLastChapter`

#### Scenario: Chat input hidden on previous chapters
- **WHEN** the composable's `isLastChapter` computed property is `false`
- **THEN** the chat input component SHALL be hidden via a Vue directive

#### Scenario: Chat input visible when no chapters exist
- **WHEN** a story is loaded in backend mode but the composable's `chapters` ref is empty
- **THEN** the chat input component SHALL remain visible so the user can send the first message

#### Scenario: Chat input visibility updates on navigation
- **WHEN** the user navigates from a previous chapter to the last chapter using the Next button
- **THEN** the composable's `isLastChapter` computed property SHALL reactively become `true`, and the chat input component SHALL become visible

## ADDED Requirements

### Requirement: Vue composable API contract
The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<string[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), `isEmpty` (ComputedRef<boolean>), `currentSeries` (Ref<string>), `currentStory` (Ref<string>), `isBackendMode` (ComputedRef<boolean>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, `loadFromFSA(dirHandle)`, and `loadFromBackend(series, name)`. The `reloadToLast()` method SHALL reload chapters from the current source and navigate to the last chapter — used by chat input after sending a message. All reactive state SHALL be encapsulated within the composable and SHALL NOT use module-scoped mutable variables.

#### Scenario: Composable returns typed reactive interface
- **WHEN** a Vue component calls `useChapterNav()`
- **THEN** the returned object SHALL contain typed reactive refs and computed properties as specified, and no module-level mutable state SHALL exist outside the composable

#### Scenario: reloadToLast navigates to the newest chapter
- **WHEN** the chat input component calls `reloadToLast()` after sending a message
- **THEN** the composable SHALL reload chapters from the current source (backend API or FSA) and set `currentIndex` to the last chapter

#### Scenario: Backend context refs available for prompt preview
- **WHEN** the prompt preview component calls `useChapterNav()`
- **THEN** it SHALL have access to `currentSeries`, `currentStory`, and `isBackendMode` reactive refs to construct API requests for prompt rendering

### Requirement: Dual-mode preserved via composable
The `useChapterNav()` composable SHALL support both FSA mode and backend mode. The active mode SHALL be tracked as a reactive ref (e.g., `mode: Ref<'fsa' | 'backend'>`). Switching modes SHALL clear previous state and load from the new source.

#### Scenario: Mode switching clears state
- **WHEN** the user switches from FSA mode to backend mode (or vice versa)
- **THEN** the composable SHALL reset `chapters`, `currentIndex`, and cached content before loading from the new source

### Requirement: Singleton initialization guard for side effects
The `useChapterNav()` composable SHALL initialize side effects (polling intervals, `hashchange` listeners, `watch` effects for URL hash sync and scroll-to-top) exactly once on the first invocation, using a module-level `initialized` flag as a guard. Subsequent calls to `useChapterNav()` from other components SHALL return the shared reactive state and methods without creating duplicate polling timers, event listeners, or watchers. This follows the standard Vue singleton composable pattern.

#### Scenario: First call initializes side effects
- **WHEN** the first Vue component calls `useChapterNav()`
- **THEN** the composable SHALL set the `initialized` flag to `true` and register all side effects (polling, hash listener, watchers) exactly once

#### Scenario: Subsequent calls skip initialization
- **WHEN** a second Vue component calls `useChapterNav()` after another component has already called it
- **THEN** the composable SHALL detect that `initialized` is `true` and return the shared reactive state without creating additional polling intervals, event listeners, or watchers

#### Scenario: No duplicate polling timers
- **WHEN** three components simultaneously use `useChapterNav()` in backend mode
- **THEN** only one polling timer SHALL be active, not three

### Requirement: Polling cleanup on component unmount
The `useChapterNav()` composable SHALL use Vue's `onUnmounted` lifecycle hook to clear any active polling intervals (`setInterval` / `setTimeout`) when the component using the composable is unmounted. Shared reactive refs (`currentIndex`, `chapters`, cached content) SHALL NOT be cleared on individual component unmount because the composable uses a singleton pattern — other components may still reference the same shared state. Only polling timers and fetch abort controllers SHALL be cleaned up.

#### Scenario: Polling stops on unmount
- **WHEN** the component using `useChapterNav()` is unmounted
- **THEN** all active polling intervals SHALL be cleared and no further fetch requests SHALL be made

#### Scenario: Shared refs survive component unmount
- **WHEN** a component using `useChapterNav()` is unmounted while another component still references the same composable
- **THEN** the shared `chapters`, `currentIndex`, and cached content refs SHALL retain their current values
