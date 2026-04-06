## MODIFIED Requirements

### Requirement: Next chapter navigation
The application SHALL provide a "Next" navigation button rendered within the `<header>` element. Clicking it SHALL load and render the next chapter in numeric order, replacing the currently displayed chapter. The button SHALL be hidden until a story folder is selected. When new chapter files are detected by the polling mechanism, the "Next" button SHALL become enabled if the user is currently on the last known chapter.

#### Scenario: Next button loads subsequent chapter
- **WHEN** the user clicks the "Next" button in the header
- **THEN** the application SHALL load and render the next chapter in numeric order, replacing the currently displayed content

#### Scenario: Next button hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the "Next" button SHALL not be visible in the header

#### Scenario: Next button enabled when new chapter appears
- **WHEN** the user is viewing the last chapter and a new chapter file is detected by polling
- **THEN** the "Next" button SHALL become enabled, allowing navigation to the newly available chapter
