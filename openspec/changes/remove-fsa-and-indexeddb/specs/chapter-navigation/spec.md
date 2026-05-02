## MODIFIED Requirements

### Requirement: Current chapter state tracking

The `useChapterNav()` composable SHALL synchronize the current chapter index with the Vue Router route params. When `currentIndex` changes, the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/:chapter` (1-indexed). On initialization, the composable SHALL read the `:chapter` route param (if present) and set `currentIndex` accordingly.

#### Scenario: URL updates on navigation

- **WHEN** the user navigates to the third chapter (composable's `currentIndex` becomes `2`)
- **THEN** the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/3`

#### Scenario: Route param sets initial chapter

- **WHEN** the page is loaded with route `/my-series/my-story/chapter/5` and the story contains at least 5 chapters
- **THEN** the composable SHALL read the `:chapter` route param, parse it as an integer, and set `currentIndex` to `4`

### Requirement: Vue composable API contract

The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<ChapterData[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), **`currentContent` (`ShallowRef<string>`)**, **`renderEpoch` (Ref<number>)**, `folderName` (Ref<string>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, **`refreshAfterEdit(targetChapter: number): Promise<void>`**, `loadFromBackend(series, story, startChapter?)`, and `getBackendContext()`.

`currentContent` SHALL be implemented as a `shallowRef<string>` so the composable can use `triggerRef` to invalidate dependents when committing a string that is `===` to the previous value. All writes to `currentContent` from inside `useChapterNav` SHALL go through a private `commitContent(next: string): void` helper which (a) assigns `next` if different OR calls `triggerRef(currentContent)` if equal, and (b) always increments `renderEpoch`. Direct `currentContent.value = ...` assignments SHALL NOT exist outside `commitContent`. Consumers outside `useChapterNav` SHALL treat `currentContent` as read-only.

`renderEpoch` SHALL be a `ref<number>` exposed on the return value, monotonically non-decreasing for the lifetime of the page, used by other composables and components (notably the sidebar relocation watch in `ContentArea.vue` and the `tokens` computed in `ChapterContent.vue`) to react to render-invalidation events that don't surface as a `currentContent` reference change.

The `next()` and `previous()` methods SHALL update `currentIndex`, which triggers a `watch` effect that calls `syncRoute()` to update the URL via `router.replace()`. The `loadFromBackend(series, story, startChapter?)` method SHALL load chapter data from the backend API, set `currentIndex` to `startChapter` (clamped to valid range) or 0, and call `syncRoute()` to update the URL. Story-level navigation (e.g., from the story selector) SHALL use `navigateToStory()` in `useStorySelector` which calls `router.push()`, and the route watcher in `useChapterNav` SHALL react to load the new story.

The `reloadToLast()` method SHALL reload chapters and update the route to the **new last chapter**. It is reserved for callers whose semantics genuinely are "go to the new last chapter": post-LLM-stream navigation in `MainLayout`, the rewind toolbar action, and the branch toolbar action. **The edit-save flow SHALL NOT use `reloadToLast()`; it SHALL use `refreshAfterEdit(targetChapter)` instead so the user stays on the chapter they edited.**

A module-level `loadToken` counter SHALL protect against stale results from concurrent loads. Additionally, `loadFromBackend` SHALL trigger a WebSocket `subscribe` message for the loaded story when a WebSocket connection is active.

This change does NOT relocate ownership of the initial deep-link backend load away from `App.vue#handleUnlocked`. The existing path — `Promise.all([initPlugins(), applyBackground()])` then `loadFromBackend(...)` — combined with the new `pluginsSettled` gate in `ContentArea.vue`, is sufficient to guarantee that chapter rendering does not run before plugins have settled. A future change MAY relocate this ownership to a route watcher; doing so is out of scope here.

#### Scenario: Composable returns typed reactive interface
- **WHEN** a Vue component calls `useChapterNav()`
- **THEN** the returned object SHALL contain typed reactive refs (`currentIndex`, `chapters`, `currentContent` as `ShallowRef<string>`, `renderEpoch`, `folderName`), computed properties (`totalChapters`, `isFirst`, `isLast`, `isLastChapter`), and methods (`next`, `previous`, `loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, `getBackendContext`)

#### Scenario: reloadToLast navigates to the newest chapter
- **WHEN** the chat input component calls `reloadToLast()` after sending a message
- **THEN** the composable SHALL reload chapters from the backend API, set `currentIndex` to the last chapter, commit the new content via `commitContent`, and call `syncRoute()` to update the URL

#### Scenario: refreshAfterEdit stays on the edited chapter
- **WHEN** `ChapterContent.vue#saveEdit` calls `refreshAfterEdit(targetChapter)`
- **THEN** the composable SHALL reload the chapter list, clamp `targetChapter` into the valid range, set `currentIndex` to `targetChapter - 1`, commit the new content via `commitContent` (which invalidates dependents even when string-equal), and call `syncRoute()`

#### Scenario: Backend context available for prompt preview
- **WHEN** the prompt preview component calls `useChapterNav()`
- **THEN** it SHALL have access to `getBackendContext()` which returns `{ series, story, isBackendMode }` to construct API requests for prompt rendering

#### Scenario: next() updates route
- **WHEN** the user clicks the Next button viewing chapter 3 of 10
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

### Requirement: Boundary jump helpers in useChapterNav

The `useChapterNav()` composable SHALL expose two new public functions, `goToFirst(): void` and `goToLast(): void`. Both SHALL be no-ops when `chapters.value.length === 0`. Both SHALL route through `navigateTo(index)` and SHALL therefore inherit the existing `chapter:change` hook dispatch and `commitContent()` semantics — neither helper SHALL bypass those side-effects by mutating `currentIndex` directly.

#### Scenario: goToFirst is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToFirst()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: goToLast is a no-op on empty chapter list

- **WHEN** `chapters.value.length === 0` and `goToLast()` is invoked
- **THEN** the function SHALL return without dispatching any hook or mutating any reactive ref

#### Scenario: Single-chapter story disables both boundary buttons

- **WHEN** a story with exactly one chapter is loaded (`chapters.value.length === 1`, `currentIndex.value === 0`)
- **THEN** both `⇇` and `⇉` SHALL render (because `hasChapters` is `true`) and both SHALL be disabled (because `isFirst` and `isLast` are both `true`)

## REMOVED Requirements

### Requirement: Session restoration error handling

**Reason**: Session restoration was the IndexedDB stale-handle recovery path for the FSA composable. With FSA and IndexedDB removed, there is no persisted directory handle to validate and no `handleDirectorySelected` codepath to wrap.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is harmless because no remaining code reads it.

### Requirement: Dual-mode preserved via composable

**Reason**: The composable now has only one mode (backend). The `mode: Ref<"fsa" | "backend">` ref, the FSA branches in every load path, and the mode-switching state-clear contract are all deleted along with `useFileReader()`.

**Migration**: None — pre-1.0 with zero users; FSA mode was unreachable from production UI since commit 4f3f91fe. The `useFileReader` composable, its tests, and the `storyReaderDB` IndexedDB database are all deleted; any orphaned IndexedDB record on existing browsers is harmless because no remaining code reads it.
