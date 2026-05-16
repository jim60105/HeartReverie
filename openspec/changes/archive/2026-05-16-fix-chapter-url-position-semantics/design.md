## Context

The URL route `/:series/:story/chapter/:chapter` is the primary deep-linking mechanism for chapter navigation. The `useChapterNav` composable owns bidirectional synchronization between `currentIndex` (0-based array position) and the `:chapter` route parameter.

**Current state (broken):** After a prior fix for bookmark navigation, `syncRoute()` writes `chapters[currentIndex].number` into the URL and the route watcher resolves via `findIndex(c => c.number === chapterNum)`. This causes the progress indicator ("30 / 36") and the URL (`/chapter/58`) to refer to different numbering systems — confusing users and breaking any tool that interprets the URL as sequential position.

**Design constraint:** Chapter numbers are arbitrary storage identifiers (may start at 29, have gaps, etc.). They exist solely for file naming (`029.md`) and sorted retrieval. User-facing position semantics must be 1-indexed sequential: "the 1st chapter loaded", "the 2nd", etc.

**Affected parties:**
- Core `useChapterNav` composable (routing logic)
- `AppHeader.vue` (already uses real chapter numbers in `data-chapter-number` — this is correct and unchanged)
- Downstream plugins that call `goToChapter()` with a real chapter number and construct a URL

## Goals / Non-Goals

**Goals:**
- URL `:chapter` is strictly 1-indexed position (Nth chapter in sorted order)
- Progress indicator and URL are semantically consistent
- Plugins receive chapter metadata in `story:switch` to map chapter.number → position
- `data-chapter-number` DOM attributes remain real chapter numbers for plugin matching

**Non-Goals:**
- Exposing a full chapter manifest API to plugins (over-engineering for now)
- Changing how chapters are sorted or numbered on the backend
- Modifying the bookmark plugin within this proposal (companion change in `HeartReverie_Plugins`)

## Decisions

### D1: URL `:chapter` = `currentIndex + 1` (position, not chapter.number)

**Rationale:** Aligns with the original spec intent (`vue-router/spec.md` line 27, `chapter-navigation/spec.md` line 70). Position is the only stable, user-meaningful concept. Chapter numbers are an internal implementation detail of file storage.

**Alternative considered:** Use chapter.number in URL (rejected — produces "60/36" display inconsistency, breaks progress semantics, leaks storage internals into UX).

### D2: Extend `StorySwitchContext` with `chapters: { number: number }[]`

**Rationale:** Plugins like `chapter-bookmark` store bookmarks by real chapter number and need to convert to position for URL navigation. Providing the sorted chapters array in the `story:switch` payload gives plugins everything they need without requiring a separate backend call or DOM scraping.

**Alternative considered:** Add a core utility function `getChapterPosition(chapterNumber)` — rejected because it would require an import mechanism for plugins (they run in vanilla JS, not Vue modules). Passing data in hook payload is the established plugin communication pattern.

### D3: `data-chapter-number` retains real chapter.number

**Rationale:** The bookmark plugin matches `[data-chapter-number="58"]` against stored bookmarks to toggle `.cb-marked`. If we changed this to position, the plugin would need an inverse lookup. Real chapter numbers in DOM are semantically correct ("this button points to chapter 58 in storage") and useful for plugins.

### D4: `loadFromBackend(startChapter)` treats parameter as 1-indexed position

**Rationale:** `startChapter` is read from the URL `:chapter` param (which is now position-based). Converting to index: `startIdx = startChapter ? Math.max(0, startChapter - 1) : 0`.

### D5: `dispatchStorySwitch()` moves after stale-load guard

**Rationale:** To include `chapters` in the payload, the dispatch must happen after `loadFromBackendInternal()` completes. It must also be after the stale-load token check (`if (token !== loadToken) return`) to avoid dispatching for an outdated load that was superseded by a newer one. Placement: after stale check, before `currentIndex` assignment and `dispatchChapterChange`.

### D6: Fix `ChapterContent.vue` callers that pass chapter number where position is expected

**Rationale:** `refreshAfterEdit(targetChapter)` and `loadFromBackend(startChapter)` both treat their parameter as 1-indexed position. `ChapterContent.vue`'s `saveEdit()` and `handleBranch()` currently pass `currentChapterNumber.value` (real chapter number). This must change to `currentIndex.value + 1` (current position). Backend API calls (`editChapter`, `rewindAfter`, `branchFrom`) correctly use real chapter numbers and are unchanged.

## Risks / Trade-offs

- **[Risk] Existing bookmarked URLs may become invalid** → Mitigation: No backward compat needed (0 users). Also, position-based URLs were the original behavior before the recent chapter.number fix, so any prior URLs are already position-based.
- **[Risk] Plugin authors may confuse `data-chapter-number` (real number) with URL `:chapter` (position)** → Mitigation: Document the distinction clearly in plugin-hooks spec; name the DOM attribute explicitly `data-chapter-number` (not `data-chapter`).
- **[Risk] chapters array in story:switch may become stale if chapters are added mid-session** → Mitigation: Acceptable; plugins that need fresh data can re-derive from `chapter:change` events or re-fetch. The array is authoritative at story-switch time.
- **[Risk] Stale dispatch from concurrent loads** → Mitigation: Dispatch is after stale-load token check, so only the latest load fires the hook.
