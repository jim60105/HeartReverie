# Chapter Navigation

## Purpose

Manages chapter-by-chapter navigation through a multi-file markdown story, including next/previous controls, progress tracking, URL hash state persistence, and scroll-to-top behavior.

## Requirements

### Requirement: Load first chapter on folder selection
When the user selects a folder and chapter files are successfully identified, the application SHALL automatically load and render the first chapter (lowest numeric index) without requiring additional user interaction.

#### Scenario: First chapter loads automatically
- **WHEN** the user selects a folder containing `001.md`, `002.md`, and `003.md`
- **THEN** the application SHALL immediately render the content of `001.md` as the current chapter

### Requirement: Next chapter navigation
The application SHALL provide a "Next" navigation button. Clicking it SHALL load and render the next chapter in numeric order, replacing the currently displayed chapter.

#### Scenario: Navigate from chapter 1 to chapter 2
- **WHEN** the user is viewing chapter `001.md` and clicks the "Next" button
- **THEN** the application SHALL load and render `002.md`, replacing the content of `001.md`

### Requirement: Previous chapter navigation
The application SHALL provide a "Previous" navigation button. Clicking it SHALL load and render the previous chapter in numeric order, replacing the currently displayed chapter.

#### Scenario: Navigate from chapter 3 to chapter 2
- **WHEN** the user is viewing chapter `003.md` and clicks the "Previous" button
- **THEN** the application SHALL load and render `002.md`, replacing the content of `003.md`

### Requirement: Disable navigation at boundaries
The "Previous" button SHALL be disabled when the user is viewing the first chapter. The "Next" button SHALL be disabled when the user is viewing the last chapter. Disabled buttons SHALL be visually distinguishable from active buttons.

#### Scenario: Previous button disabled on first chapter
- **WHEN** the user is viewing the first chapter in the sorted list
- **THEN** the "Previous" button SHALL be disabled and visually styled as non-interactive

#### Scenario: Next button disabled on last chapter
- **WHEN** the user is viewing the last chapter in the sorted list
- **THEN** the "Next" button SHALL be disabled and visually styled as non-interactive

### Requirement: Chapter progress indicator
The application SHALL display a chapter progress indicator showing the current chapter number and the total number of chapters (e.g., "Chapter 3 / 10").

#### Scenario: Chapter counter displays correctly
- **WHEN** the user is viewing the second chapter out of five total chapters
- **THEN** the progress indicator SHALL display text indicating chapter 2 of 5 (e.g., `2 / 5`)

### Requirement: Current chapter state tracking
The application SHALL track the current chapter index in the URL hash (e.g., `#chapter=3`) so that the reading position is preserved on page refresh and can be shared or bookmarked.

#### Scenario: URL hash updates on navigation
- **WHEN** the user navigates to the third chapter
- **THEN** the URL hash SHALL be updated to reflect the current chapter (e.g., `#chapter=3`)

#### Scenario: Page loads with hash in URL
- **WHEN** the page is loaded with `#chapter=5` in the URL and a folder is selected containing at least 5 chapters
- **THEN** the application SHALL navigate directly to the fifth chapter after folder selection

### Requirement: Scroll to top on chapter change
When navigating to a different chapter, the application SHALL scroll the viewport to the top of the content area so the user begins reading from the start of the new chapter. The scroll position SHALL be offset by the height of the sticky `<header>` element so that the first line of chapter content is not covered by the header.

#### Scenario: Viewport scrolls to top on next chapter
- **WHEN** the user clicks "Next" to navigate to the next chapter
- **THEN** the viewport SHALL scroll to the top of the rendered chapter content, offset by the sticky header height, so that the first line of content is fully visible below the header

#### Scenario: Scroll offset accounts for header
- **WHEN** the sticky header has a computed height of H pixels and the user navigates to a new chapter
- **THEN** the scroll position SHALL be set such that the top of the content area is at least H pixels below the top of the viewport

### Requirement: Single chapter display
The application SHALL display only one chapter at a time. When navigating to a new chapter, the previously displayed chapter content SHALL be fully replaced.

#### Scenario: Only current chapter is visible
- **WHEN** the user navigates from chapter 2 to chapter 3
- **THEN** only the content of chapter 3 SHALL be visible; chapter 2 content SHALL no longer be in the DOM or SHALL be hidden
