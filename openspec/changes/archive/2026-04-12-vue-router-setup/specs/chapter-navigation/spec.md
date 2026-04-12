## MODIFIED Requirements

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

### Requirement: Vue composable API contract
The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<ChapterData[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), `currentContent` (Ref<string>), `mode` (Ref<"fsa" | "backend">), `folderName` (Ref<string>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, `loadFromFSA(dirHandle)`, `loadFromBackend(series, story, startChapter?)`, and `getBackendContext()`. The `next()` and `previous()` methods SHALL update `currentIndex`, which triggers a `watch` effect that calls `syncRoute()` to update the URL via `router.replace()` in backend mode. The `loadFromBackend(series, story, startChapter?)` method SHALL load chapter data from the backend API, set `currentIndex` to `startChapter` (clamped to valid range) or 0, and call `syncRoute()` to update the URL. Story-level navigation (e.g., from the story selector) SHALL use `navigateToStory()` in `useStorySelector` which calls `router.push()`, and the route watcher in `useChapterNav` SHALL react to load the new story. The `reloadToLast()` method SHALL reload chapters and update the route to the last chapter via `syncRoute()`. A module-level `loadToken` counter SHALL protect against stale results from concurrent loads.

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
