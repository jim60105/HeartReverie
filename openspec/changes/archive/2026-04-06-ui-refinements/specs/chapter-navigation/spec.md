## MODIFIED Requirements

### Requirement: Scroll to top on chapter change
When navigating to a different chapter, the application SHALL scroll the viewport to the top of the content area so the user begins reading from the start of the new chapter. The scroll position SHALL be offset by the height of the sticky `<header>` element so that the first line of chapter content is not covered by the header.

#### Scenario: Viewport scrolls to top on next chapter
- **WHEN** the user clicks "Next" to navigate to the next chapter
- **THEN** the viewport SHALL scroll to the top of the rendered chapter content, offset by the sticky header height, so that the first line of content is fully visible below the header

#### Scenario: Scroll offset accounts for header
- **WHEN** the sticky header has a computed height of H pixels and the user navigates to a new chapter
- **THEN** the scroll position SHALL be set such that the top of the content area is at least H pixels below the top of the viewport
