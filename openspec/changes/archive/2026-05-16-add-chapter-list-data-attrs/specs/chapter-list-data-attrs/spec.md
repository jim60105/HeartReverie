## ADDED Requirements

### Requirement: Chapter navigation data attributes

The `AppHeader.vue` component SHALL render a `<nav>` element with the `data-chapter-list` attribute wrapping the 5 chapter navigation controls (first, previous, progress, next, last). Despite the attribute name, this marks the navigation controls area — not a full chapter list or table of contents. The `<nav>` element SHALL use `display: contents` (or equivalent) to preserve the parent `.header-row` flex layout. Each of the 5 navigation elements within SHALL carry a `data-chapter-number` attribute whose value is the 1-based chapter number the element relates to:

- The "first chapter" button SHALL have `data-chapter-number="1"`.
- The "previous chapter" button SHALL have `data-chapter-number` set to `currentIndex` (the 0-based index of the previous chapter, displayed as 1-based: `currentIndex`). When on the first chapter, the button is disabled and `data-chapter-number` SHALL be `"1"`.
- The progress indicator (`<span>`) SHALL have `data-chapter-number` set to `currentIndex + 1` (the current chapter, 1-based).
- The "next chapter" button SHALL have `data-chapter-number` set to `currentIndex + 2`. When on the last chapter, the button is disabled and `data-chapter-number` SHALL be the total chapter count.
- The "last chapter" button SHALL have `data-chapter-number` set to the total chapter count.

The `data-chapter-list` element SHALL only be present when `hasChapters` is true (i.e., `totalChapters > 0`). When no chapters are loaded, neither `data-chapter-list` nor any `data-chapter-number` attributes SHALL appear in the DOM.

#### Scenario: Chapter navigation container is discoverable by plugins

- **WHEN** a story with chapters is loaded and rendered
- **THEN** `document.querySelector('[data-chapter-list]')` SHALL return the `<nav>` element wrapping the 5 chapter navigation controls (first, previous, progress, next, last)

#### Scenario: All 5 navigation elements have chapter numbers

- **WHEN** the reader is on chapter 3 of a 10-chapter story
- **THEN** exactly 5 elements with `data-chapter-number` SHALL exist inside `[data-chapter-list]`
- **AND** the first button SHALL have `data-chapter-number="1"`
- **AND** the previous button SHALL have `data-chapter-number="2"`
- **AND** the progress indicator SHALL have `data-chapter-number="3"`
- **AND** the next button SHALL have `data-chapter-number="4"`
- **AND** the last button SHALL have `data-chapter-number="10"`

#### Scenario: No data attributes when no chapters exist

- **WHEN** no story or no chapters are loaded
- **THEN** `document.querySelector('[data-chapter-list]')` SHALL return `null`
- **AND** no `data-chapter-number` attributes SHALL exist in the DOM

#### Scenario: Data attributes update on chapter navigation

- **WHEN** the user navigates from chapter 3 to chapter 4
- **THEN** the progress indicator's `data-chapter-number` SHALL update to `"4"`
- **AND** the previous button's `data-chapter-number` SHALL update to `"3"`
- **AND** the next button's `data-chapter-number` SHALL update to `"5"`
