## MODIFIED Requirements

### Requirement: Current chapter state tracking

The `useChapterNav()` composable SHALL synchronize the current chapter index with the Vue Router route params. When `currentIndex` changes, the composable SHALL call `router.replace()` to update the URL to `/:series/:story/chapter/:chapter` where `:chapter` is the **1-indexed sequential position** (`currentIndex + 1`), NOT the `ChapterData.number` field. On initialization, the composable SHALL read the `:chapter` route param (if present), parse it as a 1-indexed position, and set `currentIndex` to `position - 1`.

The `:chapter` URL parameter represents "the Nth chapter in sorted order" — it is always a contiguous integer from 1 to `totalChapters`. Chapter numbers (`ChapterData.number`) are internal identifiers used for file naming and sort ordering; they may not start from 1, may have gaps, and SHALL NOT appear in the URL.

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
