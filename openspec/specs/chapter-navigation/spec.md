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

### Requirement: Current chapter state tracking
The application SHALL track the current chapter index in the URL hash (e.g., `#chapter=3`) so that the reading position is preserved on page refresh and can be shared or bookmarked.

#### Scenario: URL hash updates on navigation
- **WHEN** the user navigates to the third chapter
- **THEN** the URL hash SHALL be updated to reflect the current chapter (e.g., `#chapter=3`)

#### Scenario: Page loads with hash in URL
- **WHEN** the page is loaded with `#chapter=5` in the URL and a folder is selected containing at least 5 chapters
- **THEN** the application SHALL navigate directly to the fifth chapter after folder selection

### Requirement: Scroll to top on chapter change
When navigating to a different chapter, the application SHALL scroll the viewport to the top of the content area so the user begins reading from the start of the new chapter. The scroll position SHALL be offset by the height of the sticky `<header>` element AND the padding-top of the `<main>` element so that the first line of chapter content is not covered by the header or cut off by padding.

#### Scenario: Viewport scrolls to top on next chapter
- **WHEN** the user clicks "Next" to navigate to the next chapter
- **THEN** the viewport SHALL scroll to the top of the rendered chapter content, offset by the sticky header height and main padding-top, so that the first line of content is fully visible below the header

#### Scenario: Scroll offset accounts for header and main padding
- **WHEN** the sticky header has a computed height of H pixels and the `<main>` element has a computed padding-top of P pixels, and the user navigates to a new chapter
- **THEN** the scroll position SHALL be set such that the top of the content area is at least (H + P) pixels below the top of the viewport

### Requirement: Auto-reload polling with content awareness

In backend mode, the polling mechanism SHALL check for new chapters by comparing the chapter count. Additionally, the polling mechanism SHALL fetch the last chapter's content and compare it with the cached content in `state.backendChapters`. If the content has changed, the cached content SHALL be updated in place. If the user is currently viewing that last chapter, the display SHALL be re-rendered to reflect the updated content, enabling real-time display of streaming content.

Only the last chapter's content SHALL be fetched on each poll tick (not all chapters) to keep polling efficient.

The rendering pipeline SHALL strip `<user_message>…</user_message>` blocks and their enclosed content from chapter markdown before conversion to HTML. The `<user_message>` content SHALL be preserved in the raw chapter data but SHALL NOT be visible in the rendered output.

#### Scenario: New chapter detected during polling
- **WHEN** the polling mechanism detects that the chapter count has changed
- **THEN** the application SHALL perform a full reload of all chapters from the backend

#### Scenario: Last chapter content changes during polling
- **WHEN** the polling mechanism detects that the last chapter's content has changed compared to the cached version
- **THEN** the cached content SHALL be updated and, if the user is currently viewing that chapter, the display SHALL be re-rendered in real time

#### Scenario: Content unchanged during polling
- **WHEN** the polling mechanism fetches the last chapter's content and it matches the cached version
- **THEN** no re-render SHALL occur and the cached state SHALL remain unchanged

#### Scenario: User message hidden in rendered output
- **WHEN** a chapter's raw content contains a `<user_message>…</user_message>` block
- **THEN** the rendering pipeline SHALL remove the block and its content so that only the AI-generated story content is displayed to the reader

### Requirement: Single chapter display
The application SHALL display only one chapter at a time. When navigating to a new chapter, the previously displayed chapter content SHALL be fully replaced.

#### Scenario: Only current chapter is visible
- **WHEN** the user navigates from chapter 2 to chapter 3
- **THEN** only the content of chapter 3 SHALL be visible; chapter 2 content SHALL no longer be in the DOM or SHALL be hidden

### Requirement: Chat input visibility based on current chapter

The chapter navigation module SHALL support an `onChapterChange` callback that is invoked whenever a chapter is loaded. The callback SHALL receive an object containing `{ isLastChapter: boolean }`. The frontend SHALL use this callback to show the chat input area only when the user is viewing the last chapter or when no chapters exist. When the user navigates to a previous chapter, the chat input area SHALL be hidden.

#### Scenario: Chat input visible on last chapter
- **WHEN** the user is viewing the last chapter in backend mode
- **THEN** the chat input area SHALL be visible

#### Scenario: Chat input hidden on previous chapters
- **WHEN** the user navigates to a chapter that is not the last chapter
- **THEN** the chat input area SHALL be hidden

#### Scenario: Chat input visible when no chapters exist
- **WHEN** a story is loaded in backend mode but has no chapters
- **THEN** the chat input area SHALL remain visible so the user can send the first message

#### Scenario: Chat input visibility updates on navigation
- **WHEN** the user navigates from a previous chapter to the last chapter using the Next button
- **THEN** the chat input area SHALL become visible again
