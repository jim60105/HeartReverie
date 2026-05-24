# Chapter-Navigation Delta — fix-chat-input-visibility-on-transitions

## MODIFIED Requirements

### Requirement: Current chapter state tracking

The `useChapterNav()` composable SHALL synchronize the current chapter index with the Vue Router route params. When `currentIndex` changes, the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/:chapter` where `:chapter` is the **1-indexed sequential position** (`currentIndex + 1`), NOT the `ChapterData.number` field. On initialization, the composable SHALL read the `:chapter` route param (if present), parse it as a 1-indexed position, and set `currentIndex` to `position - 1`.

The `:chapter` URL parameter represents "the Nth chapter in sorted order" — it is always a contiguous integer from 1 to `totalChapters`. Chapter numbers (`ChapterData.number`) are internal identifiers used for file naming and sort ordering; they may not start from 1, may have gaps, and SHALL NOT appear in the URL.

The composable's series, story, and backend-mode flag SHALL be reactive Vue refs (or computed values derived from such refs). Any consumer that reads them inside a `computed` or `watchEffect` SHALL receive subscription updates whenever the backend mode is entered, left, or switched to a different series/story. The function `getBackendContext()` SHALL read these refs so that reactive consumers, including the chat-input visibility predicate, subscribe transitively.

When the composable loads (or reloads) a story from the backend — including via `loadFromBackend`, `reloadToLast`, `refreshAfterEdit`, and the `chapters:updated` WebSocket handler — the writes to `chapters` and `currentIndex` for the resulting transition SHALL satisfy all of the following:

- The two writes SHALL occur in the same synchronous code path, with **no `await` and no `nextTick`/microtask boundary** between them.
- No plugin hook (including `dispatchStorySwitch` and `dispatchChapterChange`) SHALL fire until both writes have completed.
- Any consumer that reads these refs via Vue's default flush timing (rendered DOM, default-flush watchers, computeds read from templates) SHALL never observe a committed state in which `chapters.length` reflects the newly loaded story but `currentIndex` reflects a stale prior story such that `isLastChapter` returns an incorrect value for the post-load state.

(Note: a `flush: "sync"` watcher could in principle observe one of the two writes before the other; that observability is not part of the contract. The contract is about plugin hooks, default-flush effects, and rendered output.)

#### Scenario: URL updates on navigation

- **WHEN** the user navigates to the third chapter in sorted order (composable's `currentIndex` becomes `2`)
- **THEN** the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/3`

#### Scenario: Route param sets initial chapter

- **WHEN** the page is loaded with route `/my-series/my-story/chapter/5` and the story contains at least 5 chapters
- **THEN** the composable SHALL read the `:chapter` route param, parse it as an integer position, and set `currentIndex` to `4` (position 5 → index 4)

#### Scenario: Non-sequential chapter numbers do not affect URL

- **WHEN** a story has chapters with `ChapterData.number` values `[29, 30, 31, ..., 64]` (36 chapters total) and the user is viewing the 5th chapter in sorted order (number 33)
- **THEN** the URL SHALL be `/:series/:story/chapter/5` and the progress indicator SHALL display "5 / 36"

#### Scenario: External route change via browser back/forward

- **WHEN** the browser navigates to `/:series/:story/chapter/10` via back/forward
- **THEN** the route watcher SHALL set `currentIndex` to `9` (position 10 → index 9) and display the 10th chapter in sorted order

#### Scenario: Backend-mode flags are reactive

- **WHEN** a Vue computed reads `useChapterNav().getBackendContext().isBackendMode` and the composable subsequently loads a story from the backend for the first time
- **THEN** the computed SHALL re-evaluate on the same Vue tick that the backend-mode transition completes, without requiring a page reload

#### Scenario: Atomic update of `chapters` and `currentIndex` on backend load

- **WHEN** `loadFromBackend` (or `reloadToLast`, `refreshAfterEdit`, or the `chapters:updated` WebSocket handler) finishes resolving a story whose loaded chapter list has length `N`, and the resolved start index is `startIdx`
- **THEN** any default-flush consumer (computed, default-flush watcher, render) and any plugin hook that observes `chapters.length` to be `N` SHALL also observe `currentIndex` to be `startIdx` (and not the index from any previously loaded story), so that `isLastChapter` evaluates consistently for the post-load state

#### Scenario: Chapter-list growth while user is on last chapter

- **WHEN** the user is positioned on the last chapter (`isLastChapter === true`) and a `chapters:updated` event causes the chapter list to grow from `N` to `N+1`
- **THEN** the composable SHALL resolve the new `currentIndex` (typically `N` for "follow to new last") and apply the `chapters` and `currentIndex` writes atomically as specified above, so that `isLastChapter` transitions `true → true` (or `true → false` exactly once) without an intermediate render in which `chapters.length === N+1` and `currentIndex === N-1`

#### Scenario: Plugin hooks fire only after refs settle

- **WHEN** `loadFromBackend` is invoked for a transition between two distinct stories
- **THEN** `dispatchStorySwitch` and the subsequent `dispatchChapterChange` SHALL fire only after `chapters.value` AND `currentIndex.value` have both been assigned to their post-load values
