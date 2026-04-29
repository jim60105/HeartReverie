## ADDED Requirements

### Requirement: refreshAfterEdit preserves the edited chapter and forces re-render

The `useChapterNav()` composable SHALL expose `refreshAfterEdit(targetChapter: number): Promise<void>` for callers (notably `ChapterContent.vue#saveEdit`) that need to reload the chapter list and stay on the chapter the user just modified. The function SHALL:

1. Reuse the existing `loadToken` discard mechanism so a stale call from an earlier edit cannot overwrite a newer one.
2. Call `loadFromBackendInternal(currentSeries, currentStory)` to refresh the chapter array.
3. Clamp `targetChapter` into `[1, chapters.length]` and set `currentIndex` to `targetChapter - 1`.
4. Commit the resulting `chapters[targetChapter - 1].content` to `currentContent` via the private `commitContent` helper, which guarantees the rendered chapter view is invalidated even when the new content is `===` to the previous `currentContent.value` (using `triggerRef` plus `renderEpoch` increment — see the modified `Vue composable API contract` requirement below).
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

## MODIFIED Requirements

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
