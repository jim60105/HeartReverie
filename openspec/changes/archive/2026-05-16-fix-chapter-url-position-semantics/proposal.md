## Why

The current implementation uses the real `chapter.number` field (file-based chapter identifier, e.g., 29–64) as the URL `:chapter` route parameter. This creates a confusing UX: the chapter progress indicator shows position-based "30 / 36" while the URL shows `/chapter/58`, and can produce nonsensical combinations like "60 / 36". The intended design is that the URL `:chapter` represents the **1-indexed sequential position** (i.e., "which chapter in order"), not the storage-level chapter number. Chapter numbers are only meaningful for file naming and sort ordering — they may not start from 1, may have gaps, and must never leak into user-facing navigation semantics.

## What Changes

- **Revert URL routing to position-based semantics**: `syncRoute()` writes `currentIndex + 1`; route watcher reads `parseInt(param) - 1` as the index. The `:chapter` URL parameter is strictly "the Nth chapter in sorted order" (1-indexed).
- **Extend `StorySwitchContext` with chapters metadata**: Add `chapters: { number: number }[]` to the `story:switch` hook payload so plugins can map between chapter numbers and positions without extra backend calls.
- **Keep `data-chapter-number` DOM attributes as real chapter numbers**: Navigation buttons retain the actual `chapter.number` values in `data-chapter-number` for plugin matching (e.g., bookmark star marks). These are NOT position values.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chapter-navigation`: `syncRoute()` and the route param watcher revert to position-based URL semantics (`currentIndex + 1`); `loadFromBackend(startChapter)` treats `startChapter` as a 1-indexed position.
- `vue-router`: Clarify that `:chapter` is strictly a 1-indexed sequential position, not a chapter number. Document the constraint that chapter numbers may not start from 1 and may have gaps.
- `plugin-hooks`: `story:switch` payload gains a new `chapters` field containing the sorted chapter list with at least `{ number }` per entry.

## Impact

- **`useChapterNav.ts`** — `syncRoute()`, route watcher, `loadFromBackend` position logic.
- **`types/index.ts`** — `StorySwitchContext` interface extended with `chapters` field.
- **`AppHeader.vue`** — No change needed; `data-chapter-number` already uses real chapter numbers.
- **Downstream plugins** — `chapter-bookmark` plugin must update `goToChapter()` to convert chapter number → position using the chapters array from `story:switch`. (Addressed in companion change in `HeartReverie_Plugins`.)
