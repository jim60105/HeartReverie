## ADDED Requirements

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
- **WHEN** the user navigates from a previous chapter to the last chapter using the Next button or keyboard
- **THEN** the chat input area SHALL become visible again
