## ADDED Requirements

### Requirement: Collapsed toggle label after story selection

The `StorySelector.vue` `<summary>` element SHALL render its label dynamically based on whether a backend story is currently selected. When `selectedStory` is the empty string, the summary SHALL render the visible text `📖 故事選擇` and SHALL NOT set an `aria-label` (the visible text already labels the control). When `selectedStory` is a non-empty string (a story is selected), the summary SHALL render only the glyph `📖` and the `<summary>` element itself SHALL set `aria-label="故事選擇"` so assistive technologies still announce the control's purpose. The glyph itself MAY be marked `aria-hidden="true"` so it is not announced twice.

The collapsed and expanded summary forms SHALL share the same `themed-btn selector-toggle` styling so the toggle does not visually shift between forms — only the rendered text differs.

#### Scenario: Full label when no story selected

- **WHEN** the `StorySelector.vue` is mounted with `selectedStory === ""`
- **THEN** the summary SHALL render the visible text `📖 故事選擇` and SHALL NOT carry an `aria-label` attribute

#### Scenario: Glyph-only label after story selected

- **WHEN** the user picks a story from the dropdown and `selectedStory` becomes a non-empty string
- **THEN** the summary SHALL render only the glyph `📖` and the `<summary>` element itself SHALL carry `aria-label="故事選擇"`

#### Scenario: Label restores after story is cleared

- **WHEN** `selectedStory` reverts to the empty string (e.g., user clears the selection)
- **THEN** the summary SHALL re-render the full `📖 故事選擇` label and the `aria-label` attribute SHALL be removed
