## MODIFIED Requirements

### Requirement: story:switch hook context and dispatch

The `story:switch` frontend hook stage SHALL pass a context object with the following shape:
- `previousSeries: string | null` — the series name that was active before this switch, or `null` if no story was previously loaded.
- `previousStory: string | null` — the story name that was active before this switch, or `null` if no story was previously loaded.
- `series: string` — the new series name.
- `story: string` — the new story name.
- `chapters: { number: number }[]` — the sorted chapter list for the new story, containing at minimum the `number` field (the file-level chapter identifier). The array is sorted in ascending order by `number` and its length equals the total number of chapters. Plugins SHALL use this to map between file-level chapter numbers and 1-indexed sequential positions (position = array index + 1).

The hook SHALL be dispatched from `useChapterNav.loadFromBackend()` after the new story's metadata is committed to module state and after chapters have been loaded from the backend, but before the first `chapter:change` dispatch for the new story. This ensures the `chapters` array is populated when plugins receive the event.

The hook SHALL NOT fire when `loadFromBackend()` is called with the same series and story already loaded (i.e., only real transitions dispatch). Reloads of the same story (e.g., `reloadToLast()`) SHALL NOT dispatch `story:switch`.

Handler return values SHALL be ignored (informational stage).

#### Scenario: Switch from no story to a backend story
- **WHEN** `loadFromBackend("seriesA", "storyA")` is called as the first load, and the story has chapters numbered [5, 10, 15]
- **THEN** the hook SHALL dispatch with `previousSeries: null, previousStory: null, series: "seriesA", story: "storyA", chapters: [{ number: 5 }, { number: 10 }, { number: 15 }]`

#### Scenario: Switch between two backend stories
- **WHEN** `loadFromBackend("seriesB", "storyB")` is called while `seriesA/storyA` is active, and storyB has chapters numbered [29, 30, 31]
- **THEN** the hook SHALL dispatch with `previousSeries: "seriesA", previousStory: "storyA", series: "seriesB", story: "storyB", chapters: [{ number: 29 }, { number: 30 }, { number: 31 }]`

#### Scenario: Reloading the same story does not fire story:switch
- **WHEN** `reloadToLast()` is called for the currently active story
- **THEN** the `story:switch` hook SHALL NOT be dispatched

#### Scenario: Chapters array enables number-to-position mapping
- **WHEN** a plugin receives `story:switch` with `chapters: [{ number: 29 }, { number: 30 }, ..., { number: 64 }]`
- **THEN** the plugin can determine that chapter number 33 is at position 5 (index 4 + 1) by calling `chapters.findIndex(c => c.number === 33) + 1`
