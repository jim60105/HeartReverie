## 1. Revert URL routing to position-based semantics

- [x] 1.1 In `useChapterNav.ts`, revert `syncRoute()` to write `currentIndex.value + 1` instead of `chapters[currentIndex].number`
- [x] 1.2 In `useChapterNav.ts`, revert the route watcher (chapter param branch in `initRouteSync()`) to parse `:chapter` as position: `const idx = parseInt(param) - 1; if (idx >= 0 && idx < chapters.length && idx !== currentIndex)` — navigate to that index
- [x] 1.3 In `useChapterNav.ts`, revert `loadFromBackend()` to treat `startChapter` as a 1-indexed position: `startIdx = startChapter ? Math.max(0, Math.min(startChapter - 1, chapters.length - 1)) : 0`

## 2. Extend story:switch payload with chapters metadata

- [x] 2.1 In `types/index.ts`, add `chapters: { number: number }[]` field to `StorySwitchContext`
- [x] 2.2 In `useChapterNav.ts`, move `dispatchStorySwitch()` call to AFTER the stale-load guard (`if (token !== loadToken) return`) and pass `chapters: chapters.value.map(c => ({ number: c.number }))` in the context

## 3. Fix ChapterContent.vue callers

- [x] 3.1 In `ChapterContent.vue` `saveEdit()`: change `refreshAfterEdit(currentChapterNumber.value)` to `refreshAfterEdit(currentIndex.value + 1)` (position, not chapter number)
- [x] 3.2 In `ChapterContent.vue` `handleBranch()`: change `loadFromBackend(result.series, result.name, currentChapterNumber.value)` to use `currentIndex.value + 1` and change `router.push({ params: { chapter: String(currentChapterNumber.value) }})` to use `String(currentIndex.value + 1)`

## 4. Tests

- [x] 4.1 Update existing `useChapterNav` route-sync tests to verify position-based URL (not chapter.number)
- [x] 4.2 Update `story:switch` hook tests to assert `chapters` field in payload
- [x] 4.3 Verify `AppHeader.test.ts` still passes (data-chapter-number uses real chapter.number — no change needed)
- [x] 4.4 Run full frontend test suite (`npm test`) — all 920 tests pass

## 5. Regression tests

- [x] 5.1 Add `useChapterNav-race.test.ts`: verifies story:switch fires even when two concurrent `loadFromBackend` calls race (stale-guard scenario); confirms `previousSeries`/`previousStory` only update after successful dispatch
- [x] 5.2 Add `chapter-bookmark-panel-persistence.test.ts`: verifies panel tab remounts when `tabEl` is detached from document (simulating settings→back navigation); confirms no spurious remount when tab is still in document; confirms stale references are cleaned up before remount
- [x] 5.3 Add `chapter-bookmark-position-mapping.test.ts`: verifies `goToChapter` maps chapter number to 1-indexed position (not using chapter number directly as URL); covers non-starting-from-1 chapters (29-64), gap chapters, empty cache, and missing chapter number scenarios
