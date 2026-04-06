# Chapter Navigation (MODIFIED)

## Purpose

Manages chapter-by-chapter navigation through a multi-file markdown story, including next/previous controls, progress tracking, URL hash state persistence, and scroll-to-top behavior.

## Requirements

### Requirement: Auto-reload polling with content awareness

In backend mode, the polling mechanism SHALL check for new chapters by comparing the chapter count. Additionally, the polling mechanism SHALL fetch the last chapter's content and compare it with the cached content in `state.backendChapters`. If the content has changed, the cached content SHALL be updated in place. If the user is currently viewing that last chapter, the display SHALL be re-rendered to reflect the updated content, enabling real-time display of streaming content.

Only the last chapter's content SHALL be fetched on each poll tick (not all chapters) to keep polling efficient.

#### Scenario: New chapter detected during polling
- **WHEN** the polling mechanism detects that the chapter count has changed
- **THEN** the application SHALL perform a full reload of all chapters from the backend

#### Scenario: Last chapter content changes during polling
- **WHEN** the polling mechanism detects that the last chapter's content has changed compared to the cached version
- **THEN** the cached content SHALL be updated and, if the user is currently viewing that chapter, the display SHALL be re-rendered in real time

#### Scenario: Content unchanged during polling
- **WHEN** the polling mechanism fetches the last chapter's content and it matches the cached version
- **THEN** no re-render SHALL occur and the cached state SHALL remain unchanged
