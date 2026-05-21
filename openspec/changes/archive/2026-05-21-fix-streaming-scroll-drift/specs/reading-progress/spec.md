## MODIFIED Requirements

### Requirement: Scroll restoration on mount

On `chapter:dom:ready`, the frontend SHALL `GET` the stored progress. If the response is non-null and `saved.chapterIndex` differs from the current chapter, the frontend SHALL show a cross-chapter navigation dialog (or auto-navigate if `confirmRemoteJump` is false). If `saved.chapterIndex` matches the current chapter, it SHALL restore scroll position on `document.scrollingElement` using: (1) Text Fragment anchor lookup if available, (2) `scrollRatio` fallback. Restoration SHALL use ResizeObserver + `document.fonts.ready` for stabilization with a 1.5s maximum retry window. User scroll SHALL immediately cancel restoration.

Because `chapter:dom:ready` is dispatched on every render commit (including every LLM streaming chunk for the current chapter), the handler SHALL be idempotent per `(container, chapterIndex)` pair. The plugin SHALL maintain a per-container state record keyed by the chapter container element that includes the `chapterIndex` for which scroll restoration was already performed. On a subsequent `chapter:dom:ready` dispatch with the same `(container, chapterIndex)`, the handler SHALL refresh the in-memory `currentIdentity` (story / chapter index) and return without re-fetching progress, without re-installing the ResizeObserver restoration window, and without re-scrolling.

#### Scenario: Restore scroll from ratio

- **WHEN** mount completes and saved progress has `scrollRatio: 0.5` for current chapter
- **THEN** the container SHALL scroll to `(scrollHeight - clientHeight) * 0.5`

#### Scenario: User scroll cancels restoration

- **WHEN** user manually scrolls during the restoration window
- **THEN** restoration attempts SHALL stop immediately

#### Scenario: Expired progress not restored

- **WHEN** `lastReadAt` exceeds `retainDays` setting
- **THEN** scroll restoration SHALL NOT be applied

#### Scenario: Streaming chunks do not re-restore scroll

- **WHEN** the engine dispatches `chapter:dom:ready` repeatedly for the same chapter while an LLM stream appends chunks to the chapter content
- **THEN** scroll restoration SHALL run at most once for that `(container, chapterIndex)` pair; subsequent dispatches SHALL be no-ops with respect to scroll position and SHALL NOT install new `ResizeObserver` restoration windows

