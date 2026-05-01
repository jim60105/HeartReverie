# Chapter Navigation

## Purpose

Manages chapter-by-chapter navigation through a multi-file markdown story, including next/previous controls, progress tracking, URL hash state persistence, and scroll-to-top behavior.

## Requirements

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
The `useChapterNav()` composable SHALL synchronize the current chapter index with the Vue Router route params when in backend mode. When `currentIndex` changes, the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/:chapter` (1-indexed). On initialization, the composable SHALL read the `:chapter` route param (if present) and set `currentIndex` accordingly. In FSA mode, the composable SHALL NOT interact with the router — URL state is not tracked for local file reading.

#### Scenario: URL updates on navigation in backend mode
- **WHEN** the user navigates to the third chapter in backend mode (composable's `currentIndex` becomes `2`)
- **THEN** the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/3`

#### Scenario: Route param sets initial chapter
- **WHEN** the page is loaded with route `/my-series/my-story/chapter/5` and the story contains at least 5 chapters
- **THEN** the composable SHALL read the `:chapter` route param, parse it as an integer, and set `currentIndex` to `4`

#### Scenario: FSA mode ignores router
- **WHEN** the composable is in FSA mode
- **THEN** chapter navigation SHALL NOT call `router.replace()` or read route params; the URL SHALL remain at `/`

### Requirement: Scroll to top on chapter change
The `useChapterNav()` composable SHALL use a `watch` effect on `currentIndex` to scroll the viewport to the top of the content area when the chapter changes. The scroll position SHALL be offset by the height of the sticky header component and the padding-top of the `<main>` element so that the first line of chapter content is not covered.

#### Scenario: Viewport scrolls to top on next chapter
- **WHEN** `currentIndex` changes via the composable
- **THEN** a `watch` effect SHALL scroll the viewport to the top of the rendered chapter content, offset by the sticky header height and main padding-top

#### Scenario: Scroll offset accounts for header and main padding
- **WHEN** the sticky header has a computed height of H pixels and the `<main>` element has a computed padding-top of P pixels, and the user navigates to a new chapter
- **THEN** the scroll position SHALL be set such that the top of the content area is at least (H + P) pixels below the top of the viewport

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

### Requirement: Vue composable API contract

The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<ChapterData[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), **`currentContent` (`ShallowRef<string>`)**, **`renderEpoch` (Ref<number>)**, `mode` (Ref<"fsa" | "backend">), `folderName` (Ref<string>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, **`refreshAfterEdit(targetChapter: number): Promise<void>`**, `loadFromFSA(dirHandle)`, `loadFromBackend(series, story, startChapter?)`, and `getBackendContext()`.

`currentContent` SHALL be implemented as a `shallowRef<string>` so the composable can use `triggerRef` to invalidate dependents when committing a string that is `===` to the previous value. All writes to `currentContent` from inside `useChapterNav` SHALL go through a private `commitContent(next: string): void` helper which (a) assigns `next` if different OR calls `triggerRef(currentContent)` if equal, and (b) always increments `renderEpoch`. Direct `currentContent.value = ...` assignments SHALL NOT exist outside `commitContent`. Consumers outside `useChapterNav` SHALL treat `currentContent` as read-only.

`renderEpoch` SHALL be a `ref<number>` exposed on the return value, monotonically non-decreasing for the lifetime of the page, used by other composables and components (notably the sidebar relocation watch in `ContentArea.vue` and the `tokens` computed in `ChapterContent.vue`) to react to render-invalidation events that don't surface as a `currentContent` reference change.

The `next()` and `previous()` methods SHALL update `currentIndex`, which triggers a `watch` effect that calls `syncRoute()` to update the URL via `router.replace()` in backend mode. The `loadFromBackend(series, story, startChapter?)` method SHALL load chapter data from the backend API, set `currentIndex` to `startChapter` (clamped to valid range) or 0, and call `syncRoute()` to update the URL. Story-level navigation (e.g., from the story selector) SHALL use `navigateToStory()` in `useStorySelector` which calls `router.push()`, and the route watcher in `useChapterNav` SHALL react to load the new story.

The `reloadToLast()` method SHALL reload chapters and update the route to the **new last chapter**. It is reserved for callers whose semantics genuinely are "go to the new last chapter": post-LLM-stream navigation in `MainLayout`, the rewind toolbar action, and the branch toolbar action. **The edit-save flow SHALL NOT use `reloadToLast()`; it SHALL use `refreshAfterEdit(targetChapter)` instead so the user stays on the chapter they edited.**

A module-level `loadToken` counter SHALL protect against stale results from concurrent loads. Additionally, `loadFromBackend` SHALL trigger a WebSocket `subscribe` message for the loaded story when a WebSocket connection is active.

This change does NOT relocate ownership of the initial deep-link backend load away from `App.vue#handleUnlocked`. The existing path — `Promise.all([initPlugins(), applyBackground()])` then `loadFromBackend(...)` — combined with the new `pluginsSettled` gate in `ContentArea.vue`, is sufficient to guarantee that chapter rendering does not run before plugins have settled. A future change MAY relocate this ownership to a route watcher; doing so is out of scope here.

#### Scenario: Composable returns typed reactive interface
- **WHEN** a Vue component calls `useChapterNav()`
- **THEN** the returned object SHALL contain typed reactive refs (`currentIndex`, `chapters`, `currentContent` as `ShallowRef<string>`, `renderEpoch`, `mode`, `folderName`), computed properties (`totalChapters`, `isFirst`, `isLast`, `isLastChapter`), and methods (`next`, `previous`, `loadFromFSA`, `loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, `getBackendContext`)

#### Scenario: reloadToLast navigates to the newest chapter
- **WHEN** the chat input component calls `reloadToLast()` after sending a message
- **THEN** the composable SHALL reload chapters from the current source (backend API or FSA), set `currentIndex` to the last chapter, commit the new content via `commitContent`, and call `syncRoute()` to update the URL in backend mode

#### Scenario: refreshAfterEdit stays on the edited chapter
- **WHEN** `ChapterContent.vue#saveEdit` calls `refreshAfterEdit(targetChapter)`
- **THEN** the composable SHALL reload the chapter list, clamp `targetChapter` into the valid range, set `currentIndex` to `targetChapter - 1`, commit the new content via `commitContent` (which invalidates dependents even when string-equal), and call `syncRoute()`

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

#### Scenario: All content writes go through commitContent
- **WHEN** any load path (`loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, `pollBackend`, the WebSocket `chapters:content` handler) commits a chapter content value
- **THEN** the value SHALL be assigned via the private `commitContent` helper, the `renderEpoch` ref SHALL be incremented, and a string-equal commit SHALL additionally call `triggerRef(currentContent)` so dependents that read `currentContent` re-evaluate

### Requirement: refreshAfterEdit preserves the edited chapter and forces re-render

The `useChapterNav()` composable SHALL expose `refreshAfterEdit(targetChapter: number): Promise<void>` for callers (notably `ChapterContent.vue#saveEdit`) that need to reload the chapter list and stay on the chapter the user just modified. The function SHALL:

1. Reuse the existing `loadToken` discard mechanism so a stale call from an earlier edit cannot overwrite a newer one.
2. Call `loadFromBackendInternal(currentSeries, currentStory)` to refresh the chapter array.
3. Clamp `targetChapter` into `[1, chapters.length]` and set `currentIndex` to `targetChapter - 1`.
4. Commit the resulting `chapters[targetChapter - 1].content` to `currentContent` via the private `commitContent` helper, which guarantees the rendered chapter view is invalidated even when the new content is `===` to the previous `currentContent.value` (using `triggerRef` plus `renderEpoch` increment — see the modified `Vue composable API contract` requirement above).
5. Dispatch the `chapter:change` hook only if `currentIndex` actually changed (i.e. the user edited a chapter different from the one they were viewing — uncommon but legal).
6. Call `syncRoute()` and `startPollingIfNeeded()` like the other backend load paths.

`refreshAfterEdit` SHALL NOT navigate to the last chapter; that contract belongs exclusively to `reloadToLast()`.

#### Scenario: Edit save stays on the edited chapter
- **WHEN** the user is viewing chapter 2 of a 5-chapter story, edits chapter 2, and saves
- **THEN** `ChapterContent.vue` SHALL call `refreshAfterEdit(2)`; after the call resolves, `currentIndex.value` SHALL be `1` (chapter 2), `currentContent.value` SHALL hold the new content of chapter 2, and the URL SHALL be `/<series>/<story>/chapter/2`

#### Scenario: Byte-identical edit invalidates the rendered view
- **WHEN** the user opens the editor on chapter 3, makes no changes, clicks save, and the server returns the unchanged content
- **THEN** `refreshAfterEdit(3)` SHALL invalidate the rendered chapter view (via `triggerRef` on `currentContent` and incrementing `renderEpoch`), and `chapter:render:after` SHALL be dispatched at least once for the resulting render

#### Scenario: Edit on a non-current chapter navigates and re-renders
- **WHEN** (hypothetically) the UI permits editing a chapter that is not the currently displayed chapter and the user edits chapter 1 while viewing chapter 4
- **THEN** `refreshAfterEdit(1)` SHALL set `currentIndex` to `0`, dispatch the `chapter:change` hook with `previousIndex: 3, index: 0`, and re-evaluate `tokens` for chapter 1

#### Scenario: Concurrent edit refreshes are token-protected
- **WHEN** `refreshAfterEdit(2)` is in flight and the user triggers a second save before the first completes
- **THEN** the second call SHALL increment `loadToken` and the first call's results SHALL be discarded, leaving the composable in a consistent state aligned with the second call

### Requirement: Dual-mode preserved via composable
The `useChapterNav()` composable SHALL support both FSA mode and backend mode. The active mode SHALL be tracked as a reactive ref (e.g., `mode: Ref<'fsa' | 'backend'>`). Switching modes SHALL clear previous state and load from the new source.

#### Scenario: Mode switching clears state
- **WHEN** the user switches from FSA mode to backend mode (or vice versa)
- **THEN** the composable SHALL reset `chapters`, `currentIndex`, and cached content before loading from the new source

### Requirement: Singleton initialization guard for side effects
The `useChapterNav()` composable SHALL initialize side effects (polling intervals, route param watchers, `watch` effects for scroll-to-top) exactly once on the first invocation, using a module-level `initialized` flag as a guard. Subsequent calls to `useChapterNav()` from other components SHALL return the shared reactive state and methods without creating duplicate polling timers, event listeners, or watchers. The composable SHALL set up a `watch` on the route's `:chapter` param to sync `currentIndex` when the route changes externally (e.g., browser back/forward). This follows the standard Vue singleton composable pattern.

#### Scenario: First call initializes side effects
- **WHEN** the first Vue component calls `useChapterNav()`
- **THEN** the composable SHALL set the `initialized` flag to `true` and register all side effects (polling, route param watcher, scroll watcher) exactly once

#### Scenario: Subsequent calls skip initialization
- **WHEN** a second Vue component calls `useChapterNav()` after another component has already called it
- **THEN** the composable SHALL detect that `initialized` is `true` and return the shared reactive state without creating additional polling intervals, watchers, or route param listeners

#### Scenario: No duplicate polling timers
- **WHEN** three components simultaneously use `useChapterNav()` in backend mode
- **THEN** only one polling timer SHALL be active, not three

#### Scenario: Route change syncs currentIndex
- **WHEN** the user presses the browser back button, changing the route from `/s/n/chapter/5` to `/s/n/chapter/3`
- **THEN** the route param watcher SHALL update `currentIndex` to `2` and trigger a re-render of chapter 3

### Requirement: Polling cleanup on component unmount
The `useChapterNav()` composable SHALL use Vue's `onUnmounted` lifecycle hook to clear any active polling intervals (`setInterval` / `setTimeout`) when the component using the composable is unmounted. Shared reactive refs (`currentIndex`, `chapters`, cached content) SHALL NOT be cleared on individual component unmount because the composable uses a singleton pattern — other components may still reference the same shared state. Only polling timers and fetch abort controllers SHALL be cleaned up.

#### Scenario: Polling stops on unmount
- **WHEN** the component using `useChapterNav()` is unmounted
- **THEN** all active polling intervals SHALL be cleared and no further fetch requests SHALL be made

#### Scenario: Shared refs survive component unmount
- **WHEN** a component using `useChapterNav()` is unmounted while another component still references the same composable
- **THEN** the shared `chapters`, `currentIndex`, and cached content refs SHALL retain their current values

### Requirement: No per-chapter content requests during initial load
During the initial story load or story switching, the chapter navigation system SHALL NOT make individual `GET /chapters/:num` requests for chapter content. Individual chapter requests are only permitted during HTTP polling fallback for the last chapter's streaming updates.

#### Scenario: Initial load uses only batch endpoint
- **WHEN** a user opens a story URL and the chapters are loaded for the first time
- **THEN** the browser network log SHALL show zero individual `/chapters/:num` requests for chapter content — only the single batch request `/chapters?include=content`

#### Scenario: HTTP polling only fetches last chapter individually
- **WHEN** WebSocket is disconnected and the HTTP polling fallback activates
- **THEN** each poll cycle SHALL make at most 1 request to `/chapters` (count check) and at most 1 request to `/chapters/:lastNum` (last chapter content) — never requests to multiple individual chapter numbers

### Requirement: First-chapter jump button

The reader header SHALL render a first-chapter jump button immediately to the left of the existing `← 上一章` button. The button SHALL display the glyph `⇇` (U+21C7), SHALL set its native tooltip via `title="第一章"`, and SHALL set `aria-label="第一章"` for assistive technologies. Clicking the button SHALL invoke a new public helper `goToFirst()` exported from `useChapterNav()` which sets `currentIndex` to `0` via the same FSA / backend branching that `next()` and `previous()` use, so `chapter:change` hook dispatch and `commitContent()` are unchanged. The button SHALL be disabled when `isFirst` is `true`. The button SHALL NOT render when `chapters.value.length === 0` (no story loaded), gated by the same `v-if="hasChapters"` block as the existing previous / next buttons.

#### Scenario: First-chapter button jumps to chapter index 0

- **WHEN** the user is on chapter index `5` in a story with 11 chapters and clicks the `⇇` button
- **THEN** `useChapterNav().goToFirst()` SHALL run, `currentIndex` SHALL become `0`, the `chapter:change` hook SHALL fire with `previousIndex: 5` and `currentIndex: 0`, and the chapter content SHALL be re-rendered

#### Scenario: First-chapter button disabled at boundary

- **WHEN** the user is already on chapter index `0`
- **THEN** the `⇇` button SHALL render with `:disabled="isFirst"` resolving to `true`, click events SHALL be ignored by the browser, and `goToFirst()` SHALL NOT be invoked

#### Scenario: First-chapter button hidden before story load

- **WHEN** no story has been selected (the composable's `chapters` ref is empty and `hasChapters` is `false`)
- **THEN** the `⇇` button SHALL NOT render any DOM at all, mirroring the existing previous / next button behaviour

#### Scenario: First-chapter tooltip

- **WHEN** the user hovers the `⇇` button
- **THEN** the browser SHALL show the native tooltip `第一章` from the `title` attribute

### Requirement: Last-chapter jump button

The reader header SHALL render a last-chapter jump button immediately to the right of the existing `下一章 →` button. The button SHALL display the glyph `⇉` (U+21C9), SHALL set its native tooltip via `title="最後一章"`, and SHALL set `aria-label="最後一章"` for assistive technologies. Clicking the button SHALL invoke a new public helper `goToLast()` exported from `useChapterNav()` which sets `currentIndex` to `chapters.value.length - 1` via the same FSA / backend branching that `next()` and `previous()` use. The button SHALL be disabled when `isLast` is `true`. The button SHALL NOT render when `chapters.value.length === 0`.

#### Scenario: Last-chapter button jumps to highest index

- **WHEN** the user is on chapter index `2` in a story with 11 chapters and clicks the `⇉` button
- **THEN** `useChapterNav().goToLast()` SHALL run, `currentIndex` SHALL become `10`, the `chapter:change` hook SHALL fire with `previousIndex: 2` and `currentIndex: 10`, and the chapter content SHALL be re-rendered

#### Scenario: Last-chapter button disabled at boundary

- **WHEN** the user is already on the last chapter (`currentIndex === chapters.value.length - 1`)
- **THEN** the `⇉` button SHALL render with `:disabled="isLast"` resolving to `true` and click events SHALL be ignored

#### Scenario: Last-chapter button hidden before story load

- **WHEN** no story has been selected (`chapters` ref empty)
- **THEN** the `⇉` button SHALL NOT render any DOM, mirroring the existing previous / next button behaviour

#### Scenario: Last-chapter tooltip

- **WHEN** the user hovers the `⇉` button
- **THEN** the browser SHALL show the native tooltip `最後一章`

### Requirement: Boundary jump helpers in useChapterNav

The `useChapterNav()` composable SHALL expose two new public functions, `goToFirst(): void` and `goToLast(): void`. Both SHALL be no-ops when `chapters.value.length === 0`. Both SHALL route through the existing `loadFSAChapter(index)` helper when `mode.value === "fsa"` and through `navigateTo(index)` when `mode.value === "backend"`. Both SHALL therefore inherit the existing `chapter:change` hook dispatch and `commitContent()` semantics — neither helper SHALL bypass those side-effects by mutating `currentIndex` directly.

#### Scenario: goToFirst is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToFirst()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: goToLast is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToLast()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: Boundary helpers route through FSA path in FSA mode

- **WHEN** `mode.value === "fsa"`, `chapters.value.length === 5`, and `goToLast()` is invoked
- **THEN** the helper SHALL call `loadFSAChapter(4)` (not `navigateTo(4)`) so the FSA file-read pathway runs and chapter `4`'s content is freshly read from the local file handle

#### Scenario: goToFirst routes through FSA path in FSA mode

- **WHEN** `mode.value === "fsa"`, `chapters.value.length === 5`, `currentIndex.value === 3`, and `goToFirst()` is invoked
- **THEN** the helper SHALL call `loadFSAChapter(0)` (not `navigateTo(0)`)

#### Scenario: Single-chapter story disables both boundary buttons

- **WHEN** a story with exactly one chapter is loaded (`chapters.value.length === 1`, `currentIndex.value === 0`)
- **THEN** both `⇇` and `⇉` SHALL render (because `hasChapters` is `true`) and both SHALL be disabled (because `isFirst` and `isLast` are both `true`)
