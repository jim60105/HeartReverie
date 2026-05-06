## ADDED Requirements

### Requirement: Custom dropdown panel replaces datalist for multi-combobox fields

The `PluginSettingsPage.vue` multi-combobox field type SHALL render a custom dropdown panel (`<div>`) instead of a browser-native `<datalist>`. The dropdown panel SHALL display available options fetched from `x-options-url` as clickable items.

#### Scenario: Dropdown panel renders options from x-options-url

- **GIVEN** a plugin settingsSchema field with `type: "array"` and `x-options-url`
- **AND** the dynamic options have been fetched successfully
- **WHEN** the dropdown panel is open
- **THEN** the panel SHALL display all fetched options as selectable items

#### Scenario: Dropdown not rendered when no options available

- **GIVEN** a multi-combobox field with no options loaded (empty array or fetch failed)
- **WHEN** the user focuses the input
- **THEN** the dropdown panel SHALL NOT be displayed (input still accepts free-text entry)

### Requirement: Dropdown opens on input focus or chevron button click

The dropdown panel SHALL open when the user focuses the text input or clicks the ▼ (chevron) button adjacent to the input.

#### Scenario: Open on input focus

- **WHEN** the user clicks or tabs into the multi-combobox text input
- **AND** options are available
- **THEN** the dropdown panel SHALL become visible

#### Scenario: Open on chevron button click

- **WHEN** the user clicks the ▼ button
- **AND** options are available
- **THEN** the dropdown panel SHALL become visible and the input SHALL receive focus

### Requirement: Dropdown dismissal on click-outside or Escape

The dropdown panel SHALL close when the user clicks outside the multi-combobox container or presses the Escape key.

#### Scenario: Close on click outside

- **GIVEN** the dropdown panel is open
- **WHEN** the user clicks anywhere outside the `.multi-combobox` container
- **THEN** the dropdown panel SHALL close

#### Scenario: Close on Escape key

- **GIVEN** the dropdown panel is open
- **WHEN** the user presses the Escape key
- **THEN** the dropdown panel SHALL close and the input SHALL retain focus

### Requirement: Click-to-add immediately adds option to array

Clicking an option in the dropdown SHALL immediately add that option's value to the array (no Enter keypress required). The dropdown SHALL remain open after adding, allowing rapid multi-selection.

#### Scenario: Click option adds to array

- **GIVEN** the dropdown panel is open with options ["A", "B", "C"]
- **AND** the current array value is ["A"]
- **WHEN** the user clicks option "B"
- **THEN** the array value SHALL become ["A", "B"]
- **AND** the dropdown SHALL remain open
- **AND** the input text SHALL be cleared

#### Scenario: Clicking already-selected option does not add duplicate

- **GIVEN** the dropdown panel is open
- **AND** option "A" is already in the array
- **WHEN** the user clicks option "A" in the dropdown
- **THEN** the array value SHALL NOT change (no duplicate added)

### Requirement: Type-to-filter narrows visible options

As the user types in the input, the dropdown options SHALL be filtered to show only options whose text contains the typed substring (case-insensitive match).

#### Scenario: Filter matches substring

- **GIVEN** options are ["Anime", "Realistic", "Artistic"]
- **WHEN** the user types "art"
- **THEN** the dropdown SHALL show ["Artistic"] (case-insensitive match)

#### Scenario: Empty filter shows all options

- **GIVEN** options are ["Anime", "Realistic", "Artistic"]
- **WHEN** the input text is empty
- **THEN** the dropdown SHALL show all options

#### Scenario: No matching options

- **GIVEN** options are ["Anime", "Realistic", "Artistic"]
- **WHEN** the user types "xyz"
- **THEN** the dropdown SHALL display no options (empty state)

### Requirement: Already-selected options visually distinguished in dropdown

Options that are already present in the array SHALL be visually dimmed in the dropdown to indicate they are already selected. They SHALL still be visible (not hidden).

#### Scenario: Selected option is dimmed

- **GIVEN** the array value is ["Anime"]
- **WHEN** the dropdown is open
- **THEN** the "Anime" option SHALL be displayed with a dimmed/muted visual style
- **AND** unselected options SHALL be displayed with normal styling

### Requirement: Free-text entry via Enter key

Pressing Enter in the input SHALL add the current input text to the array, regardless of whether it matches an existing option. This preserves the ability to enter custom values.

#### Scenario: Enter adds typed text to array

- **GIVEN** the input contains "custom-value"
- **WHEN** the user presses Enter
- **THEN** "custom-value" SHALL be added to the array
- **AND** the input text SHALL be cleared

#### Scenario: Enter with empty input does nothing

- **GIVEN** the input is empty
- **WHEN** the user presses Enter
- **THEN** the array SHALL NOT be modified

#### Scenario: Enter adds highlighted option when navigating with arrows

- **GIVEN** the dropdown is open with a highlighted option via arrow-key navigation
- **WHEN** the user presses Enter
- **THEN** the highlighted option's value SHALL be added to the array
- **AND** the input text SHALL be cleared

### Requirement: Keyboard navigation within dropdown

Arrow Up and Arrow Down keys SHALL move a visual highlight through the filtered options list. The highlighted option SHALL scroll into view if not visible.

#### Scenario: Arrow Down moves highlight forward

- **GIVEN** the dropdown is open with options ["A", "B", "C"] and no highlight
- **WHEN** the user presses Arrow Down
- **THEN** option "A" (first item) SHALL be highlighted

#### Scenario: Arrow Down wraps at end

- **GIVEN** the highlight is on the last option
- **WHEN** the user presses Arrow Down
- **THEN** the highlight SHALL wrap to the first option

#### Scenario: Arrow Up moves highlight backward

- **GIVEN** the highlight is on option "B"
- **WHEN** the user presses Arrow Up
- **THEN** option "A" SHALL be highlighted

#### Scenario: Arrow Up from first wraps to last

- **GIVEN** the highlight is on the first option
- **WHEN** the user presses Arrow Up
- **THEN** the highlight SHALL wrap to the last option

### Requirement: Existing tag-chip removal preserved

The pill/tag display with × remove buttons SHALL continue to function. Clicking × on a tag SHALL remove that item from the array.

#### Scenario: Remove tag via × button

- **GIVEN** the array value is ["A", "B", "C"]
- **WHEN** the user clicks × on tag "B"
- **THEN** the array value SHALL become ["A", "C"]

### Requirement: Dropdown panel styled with CSS variables for theme consistency

The dropdown panel SHALL use existing CSS variables (`var(--bg-*)`, `var(--text-*)`, `var(--border-*)`) for colors and shall support both dark and light themes. The panel SHALL be positioned absolutely below the input with appropriate `z-index` and `max-height` with scroll overflow.

#### Scenario: Dropdown uses theme colors

- **WHEN** the dropdown panel is rendered
- **THEN** it SHALL use `var(--bg-*)` for background, `var(--text-*)` for text color, and `var(--border-*)` for borders
- **AND** it SHALL have `max-height` with `overflow-y: auto` for scrollable content
