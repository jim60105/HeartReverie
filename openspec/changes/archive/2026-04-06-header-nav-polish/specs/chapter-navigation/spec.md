## MODIFIED Requirements

### Requirement: Next chapter navigation
The application SHALL provide a "Next" navigation button rendered within the `<header>` element. Clicking it SHALL load and render the next chapter in numeric order, replacing the currently displayed chapter. The button SHALL be hidden until a story folder is selected.

#### Scenario: Next button loads subsequent chapter
- **WHEN** the user clicks the "Next" button in the header
- **THEN** the application SHALL load and render the next chapter in numeric order, replacing the currently displayed content

#### Scenario: Next button hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the "Next" button SHALL not be visible in the header

### Requirement: Previous chapter navigation
The application SHALL provide a "Previous" navigation button rendered within the `<header>` element. Clicking it SHALL load and render the previous chapter in numeric order, replacing the currently displayed chapter. The button SHALL be hidden until a story folder is selected.

#### Scenario: Previous button loads preceding chapter
- **WHEN** the user clicks the "Previous" button in the header
- **THEN** the application SHALL load and render the previous chapter in numeric order, replacing the currently displayed content

#### Scenario: Previous button hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the "Previous" button SHALL not be visible in the header

### Requirement: Disable navigation at boundaries
The "Previous" button in the `<header>` SHALL be disabled when the user is viewing the first chapter. The "Next" button in the `<header>` SHALL be disabled when the user is viewing the last chapter. Disabled buttons SHALL be visually distinguishable from active buttons. When no story is loaded, all navigation controls SHALL be hidden rather than disabled.

#### Scenario: Previous button disabled on first chapter
- **WHEN** the user is viewing the first chapter of a loaded story
- **THEN** the "Previous" button in the header SHALL be disabled and visually distinguishable from an active button

#### Scenario: Next button disabled on last chapter
- **WHEN** the user is viewing the last chapter of a loaded story
- **THEN** the "Next" button in the header SHALL be disabled and visually distinguishable from an active button

#### Scenario: All navigation controls hidden when no story is loaded
- **WHEN** no story folder has been selected
- **THEN** all navigation controls (previous button, chapter progress indicator, next button) in the header SHALL be hidden, not merely disabled

### Requirement: Chapter progress indicator
The application SHALL display a chapter progress indicator in the `<header>` showing the current chapter number and the total number of chapters (e.g., "Chapter 3 / 10"). The indicator SHALL be hidden until a story folder is selected.

#### Scenario: Progress indicator shows current and total chapters
- **WHEN** a story is loaded and the user is viewing a chapter
- **THEN** the header SHALL display a chapter progress indicator showing the current chapter number and the total number of chapters (e.g., "Chapter 3 / 10")

#### Scenario: Progress indicator hidden before story is loaded
- **WHEN** no story folder has been selected
- **THEN** the chapter progress indicator SHALL not be visible in the header
