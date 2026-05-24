# Chat-Input Delta — fix-chat-input-visibility-on-transitions

## MODIFIED Requirements

### Requirement: Input UI

The reader frontend SHALL render a `ChatInput.vue` component below the story content. The component SHALL contain a textarea bound via `v-model` to a reactive ref for the user message and a submit button. The input area SHALL NOT be sticky or fixed-position; it SHALL scroll naturally with the page content below the story chapters. The component SHALL accept props for configuration (e.g., `series`, `storyName`) and SHALL emit events for actions rather than accepting callback functions.

The chat input SHALL be rendered if, and only if, the reader is in backend mode AND the user is positioned on the last chapter of the loaded story (or the story currently has zero chapters, which represents the new-story creation flow). This visibility predicate SHALL be reactive: any state change that flips the predicate SHALL flip the rendered visibility on the same Vue tick, without requiring a full page reload.

#### Scenario: Input area placement on the last chapter
- **WHEN** the reader page is loaded with a story selected AND the user is positioned on the last chapter
- **THEN** the `ChatInput.vue` component SHALL render a textarea and submit button below the story content, scrolling naturally with the page

#### Scenario: Input area hidden on non-last chapters
- **WHEN** the reader page is loaded with a multi-chapter story selected AND the user is positioned on any chapter that is not the last
- **THEN** the chat input SHALL NOT be rendered

#### Scenario: Input area without story
- **WHEN** no story is selected or loaded
- **THEN** the chat input component SHALL be hidden or disabled via Vue directive

#### Scenario: Backend-mode entry from cold start

- **WHEN** `MainLayout.vue` mounts while no story is loaded (no backend context, e.g. on application boot or on a non-reading route) and the user subsequently triggers a backend story load (via the story-selector, deeplink, or programmatic API)
- **THEN** the chat input SHALL become visible as soon as the load completes on the last chapter of the loaded story, without requiring a page reload
- **AND** the visibility predicate's subscription to `series` / `story` / `isBackendMode` SHALL be established at predicate-definition time so that the cold-start transition propagates reactively

#### Scenario: Direct `loadFromBackend` from non-reading surfaces

- **WHEN** a UI surface (e.g. `StorySelector.vue`) calls `loadFromBackend(series, story, undefined, { syncRoute: false })` directly, without driving a Vue Router transition
- **THEN** any already-mounted consumer of the chat-input visibility predicate SHALL re-evaluate and the chat input SHALL render correctly for the post-load state, without requiring a page reload

#### Scenario: Single-chapter story selected via story-selector

- **WHEN** the user opens the story-selector (top-left `<details>` element) while viewing any other story and chooses a story whose chapter count is exactly one
- **THEN** the chat input SHALL be visible after the in-app navigation completes, without requiring a page reload (F5)
- **AND** no transient render between the click and the destination state SHALL render the page with `chapters.length === 1` but the chat input hidden

#### Scenario: Multi-chapter story, header `goToLast` button (B1 — MainLayout mounted before backend mode)

- **GIVEN** `MainLayout.vue` mounted before any backend story was loaded (the chat-input visibility predicate first evaluated with `isBackendMode === false` and short-circuited before reading `isLastChapter` / `chapters`)
- **WHEN** the user subsequently loads a multi-chapter story via the selector, lands on a non-last chapter, and clicks the header `goToLast` (`⇉`) control
- **THEN** the chat input SHALL be visible after the navigation completes, without requiring a page reload (F5)
- **AND** the visibility predicate SHALL have re-evaluated reactively when backend mode was entered, establishing the subscription to `isLastChapter` and `chapters`

#### Scenario: Multi-chapter story, header `goToLast` button (B2 — direct deeplink entry)

- **GIVEN** the page is loaded via deeplink onto chapter 1 of a multi-chapter story (so backend mode is `true` from first paint)
- **WHEN** the user clicks the header `goToLast` (`⇉`) control
- **THEN** the chat input SHALL be visible synchronously after the chapter index updates, without requiring a page reload (F5)

#### Scenario: Navigate away from the last chapter hides the chat input

- **WHEN** the user is positioned on the last chapter (chat input visible) and navigates to any earlier chapter via header controls, keyboard shortcuts, or browser back/forward
- **THEN** the chat input SHALL be hidden after the navigation completes, without requiring a page reload (F5)

#### Scenario: New-story creation flow remains unblocked

- **WHEN** the reader enters backend mode against a series/story whose loaded chapter list is empty (new-story creation flow)
- **THEN** the chat input SHALL be rendered, consistent with the pre-existing behavior that uses the chat input as the first-chapter creation surface
