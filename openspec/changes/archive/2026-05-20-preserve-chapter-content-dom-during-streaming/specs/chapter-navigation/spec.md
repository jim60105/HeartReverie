## MODIFIED Requirements

### Requirement: Vue composable API contract

The `useChapterNav()` composable SHALL return a well-typed interface including at minimum: `currentIndex` (Ref<number>), `chapters` (Ref<ChapterData[]>), `totalChapters` (ComputedRef<number>), `isFirst` (ComputedRef<boolean>), `isLast` (ComputedRef<boolean>), `isLastChapter` (ComputedRef<boolean>), **`currentContent` (`ShallowRef<string>`)**, **`renderEpoch` (Ref<number>)**, **`remountToken` (Ref<number>)**, `folderName` (Ref<string>), `next()`, `previous()`, `reloadToLast(): Promise<void>`, **`refreshAfterEdit(targetChapter: number): Promise<void>`**, `loadFromBackend(series, story, startChapter?)`, **`notifyRenderInvalidated(): void`**, **`forceTokenRemount(): void`**, and `getBackendContext()`.

`currentContent` SHALL be implemented as a `shallowRef<string>` so the composable can use `triggerRef` to invalidate dependents when committing a string that is `===` to the previous value. All writes to `currentContent` from inside `useChapterNav` SHALL go through a private `commitContent(next: string): void` helper which (a) assigns `next` if different OR calls `triggerRef(currentContent)` if equal, and (b) always increments `renderEpoch`. `commitContent` SHALL NOT touch `remountToken`. Direct `currentContent.value = ...` assignments SHALL NOT exist outside `commitContent`. Consumers outside `useChapterNav` SHALL treat `currentContent` as read-only.

`renderEpoch` SHALL be a `ref<number>` exposed on the return value, monotonically non-decreasing for the lifetime of the page, used by other composables and components (notably the sidebar relocation watch in `ContentArea.vue` and the `chapter:dom:ready` dispatch watch in `ChapterContent.vue`) to react to render-invalidation events that don't surface as a `currentContent` reference change. `renderEpoch` is a **notification** signal and SHALL NOT be used as a v-for key suffix in any component.

`remountToken` SHALL be a `ref<number>` exposed on the return value, monotonically non-decreasing for the lifetime of the page. `remountToken` is a **force-remount** signal: it is consulted by `ChapterContent.vue`'s v-for key so that a change to `remountToken` causes Vue to unmount and remount each rendered token element. `remountToken` SHALL be incremented ONLY by the exported `forceTokenRemount()` helper. `commitContent()`, `notifyRenderInvalidated()`, and all streaming code paths SHALL NOT touch `remountToken`.

`notifyRenderInvalidated(): void` SHALL increment `renderEpoch` only. It is the helper used by callers that need downstream watchers (`chapter:dom:ready` dispatch, `ContentArea` sidebar relocation) to re-run but have NOT externally mutated the rendered DOM. The canonical caller is `usePlugins.ts#subscribeSettingsChanged`, which fires after a plugin's settings change so plugins can re-walk the existing rendered chapter and re-apply.

`forceTokenRemount(): void` SHALL increment **both** `remountToken` and `renderEpoch`, in that order, within a single synchronous call. It is the only public way to force `ChapterContent`'s rendered token elements to remount even when the rendered token strings are byte-identical to the previous render. Its sole legitimate caller in the current codebase is `ChapterContent.vue#cancelEditAction` (the cancel-edit recovery path). Future callers SHALL document why a byte-identical remount is required before adding additional call sites.

The previously-exported `bumpRenderEpoch()` function is REMOVED. See the `REMOVED Requirements` section below for migration guidance.

The `next()` and `previous()` methods SHALL update `currentIndex`, which triggers a `watch` effect that calls `syncRoute()` to update the URL via `router.replace()`. The `loadFromBackend(series, story, startChapter?)` method SHALL load chapter data from the backend API, set `currentIndex` to `startChapter` (clamped to valid range) or 0, and call `syncRoute()` to update the URL. Story-level navigation (e.g., from the story selector) SHALL use `navigateToStory()` in `useStorySelector` which calls `router.push()`, and the route watcher in `useChapterNav` SHALL react to load the new story.

The `reloadToLast()` method SHALL reload chapters and update the route to the **new last chapter**. It is reserved for callers whose semantics genuinely are "go to the new last chapter": post-LLM-stream navigation in `MainLayout`, the rewind toolbar action, and the branch toolbar action. **The edit-save flow SHALL NOT use `reloadToLast()`; it SHALL use `refreshAfterEdit(targetChapter)` instead so the user stays on the chapter they edited.**

A module-level `loadToken` counter SHALL protect against stale results from concurrent loads. Additionally, `loadFromBackend` SHALL trigger a WebSocket `subscribe` message for the loaded story when a WebSocket connection is active.

This change does NOT relocate ownership of the initial deep-link backend load away from `App.vue#handleUnlocked`. The existing path — `Promise.all([initPlugins(), applyBackground()])` then `loadFromBackend(...)` — combined with the new `pluginsSettled` gate in `ContentArea.vue`, is sufficient to guarantee that chapter rendering does not run before plugins have settled. A future change MAY relocate this ownership to a route watcher; doing so is out of scope here.

#### Scenario: Composable returns typed reactive interface

- **WHEN** a Vue component calls `useChapterNav()`
- **THEN** the returned object SHALL contain typed reactive refs (`currentIndex`, `chapters`, `currentContent` as `ShallowRef<string>`, `renderEpoch`, `remountToken`, `folderName`), computed properties (`totalChapters`, `isFirst`, `isLast`, `isLastChapter`), and methods (`next`, `previous`, `loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, `notifyRenderInvalidated`, `forceTokenRemount`, `getBackendContext`)

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

#### Scenario: commitContent never touches remountToken

- **WHEN** any code path (load, navigation, edit save, polling, WebSocket `chapters:content` handler) invokes `commitContent(next)`
- **THEN** `currentContent` SHALL be updated (assigned or `triggerRef`'d) AND `renderEpoch` SHALL be incremented AND `remountToken` SHALL remain at its previous value

#### Scenario: forceTokenRemount bumps both counters

- **WHEN** a caller (currently only `ChapterContent.vue#cancelEditAction`) invokes `forceTokenRemount()`
- **THEN** both `remountToken` and `renderEpoch` SHALL increment by 1, in the same synchronous call

#### Scenario: notifyRenderInvalidated bumps renderEpoch only

- **WHEN** a caller (currently `usePlugins.ts#subscribeSettingsChanged`) invokes `notifyRenderInvalidated()`
- **THEN** `renderEpoch` SHALL increment by 1, and `remountToken` SHALL remain unchanged, so downstream watchers re-run but the v-html DOM is not remounted

#### Scenario: Plugin settings change does not remount rendered tokens

- **WHEN** the user toggles a plugin setting that affects rendering (e.g. dialogue-colorize colors) and `usePlugins.ts` calls `notifyRenderInvalidated()` after the debounce timer fires
- **THEN** `ChapterContent.vue`'s rendered token elements SHALL NOT be remounted (their DOM instances persist), AND `chapter:dom:ready` SHALL be dispatched at least once so the plugin can re-walk and re-apply

#### Scenario: All content writes go through commitContent

- **WHEN** any load path (`loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, `pollBackend`, the WebSocket `chapters:content` handler) commits a chapter content value
- **THEN** the value SHALL be assigned via the private `commitContent` helper, the `renderEpoch` ref SHALL be incremented, `remountToken` SHALL NOT change, and a string-equal commit SHALL additionally call `triggerRef(currentContent)` so dependents that read `currentContent` re-evaluate

## REMOVED Requirements

### Requirement: bumpRenderEpoch exported helper

**Reason:** The function name conflated two distinct concerns (a notification bump vs a force-remount of rendered token DOM). During LLM streaming, every `commitContent()` call indirectly drove the same v-for key change as `bumpRenderEpoch()` did, causing the entire chapter DOM to remount per chunk and the browser to lose scroll anchor. Splitting the concerns into `renderEpoch` (notification) and `remountToken` (force-remount), and replacing the helper with two narrower ones (`notifyRenderInvalidated()` for notification-only callers, `forceTokenRemount()` for true force-remount callers), removes the ambiguity and fixes the streaming scroll-snap bug.

**Migration:** Replace every call to `bumpRenderEpoch()` with the appropriate narrower helper based on intent:
- `usePlugins.ts#subscribeSettingsChanged` → `notifyRenderInvalidated()` (settings change does not externally mutate the rendered DOM).
- `ChapterContent.vue#cancelEditAction` → `forceTokenRemount()` (cancel-edit recovery from sidebar relocation moving children out of v-html).
- Future call sites SHALL audit at the call site whether the caller has externally mutated the rendered DOM. If yes, use `forceTokenRemount()`; otherwise use `notifyRenderInvalidated()`.

Test mocks that exposed `bumpRenderEpoch` SHALL be updated to expose `notifyRenderInvalidated`, `forceTokenRemount`, and a `remountToken: Ref<number>` field.
