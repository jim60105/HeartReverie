# Chapter List Data Attributes

## Purpose

Exposes chapter navigation state via HTML data attributes on the AppHeader navigation controls, enabling plugins to discover and annotate the chapter navigation area without coupling to Vue component internals.

## Requirements

### Requirement: Chapter navigation data attributes

The `AppHeader.vue` component SHALL render a `<nav>` element with the `data-chapter-list` attribute wrapping the 5 chapter navigation controls (first, previous, progress, next, last). Despite the attribute name, this marks the navigation controls area — not a full chapter list or table of contents. The `<nav>` element SHALL use `display: contents` (or equivalent) to preserve the parent `.header-row` flex layout. Each of the 5 navigation elements within SHALL carry a `data-chapter-number` attribute whose value is the actual `ChapterData.number` from the chapters array at the corresponding position:

- The "first chapter" button SHALL have `data-chapter-number` set to `chapters[0].number` (the first chapter's number, which may not be `1`).
- The "previous chapter" button SHALL have `data-chapter-number` set to `chapters[Math.max(0, currentIndex - 1)].number`. When on the first chapter, it equals the first chapter's number.
- The progress indicator (`<span>`) SHALL have `data-chapter-number` set to `chapters[currentIndex].number` (the current chapter's number).
- The "next chapter" button SHALL have `data-chapter-number` set to `chapters[Math.min(chapters.length - 1, currentIndex + 1)].number`. When on the last chapter, it equals the last chapter's number.
- The "last chapter" button SHALL have `data-chapter-number` set to `chapters[chapters.length - 1].number`.

The `data-chapter-list` element SHALL only be present when `hasChapters` is true (i.e., `totalChapters > 0`). When no chapters are loaded, neither `data-chapter-list` nor any `data-chapter-number` attributes SHALL appear in the DOM.

#### Scenario: Chapter navigation container is discoverable by plugins

- **WHEN** a story with chapters is loaded and rendered
- **THEN** `document.querySelector('[data-chapter-list]')` SHALL return the `<nav>` element wrapping the 5 chapter navigation controls (first, previous, progress, next, last)

#### Scenario: All 5 navigation elements have chapter numbers (non-sequential)

- **WHEN** the reader is on position 3 (index 2) of a story with chapters numbered `[29, 30, 31, 32, 33, 34, 35, 36, 37, 38]`
- **THEN** exactly 5 elements with `data-chapter-number` SHALL exist inside `[data-chapter-list]`
- **AND** the first button SHALL have `data-chapter-number="29"`
- **AND** the previous button SHALL have `data-chapter-number="30"`
- **AND** the progress indicator SHALL have `data-chapter-number="31"`
- **AND** the next button SHALL have `data-chapter-number="32"`
- **AND** the last button SHALL have `data-chapter-number="38"`

#### Scenario: No data attributes when no chapters exist

- **WHEN** no story or no chapters are loaded
- **THEN** `document.querySelector('[data-chapter-list]')` SHALL return `null`
- **AND** no `data-chapter-number` attributes SHALL exist in the DOM

#### Scenario: Data attributes update on chapter navigation

- **WHEN** the user navigates from position 3 to position 4 in a story with chapters `[29, 30, 31, 32, 33, ...]`
- **THEN** the progress indicator's `data-chapter-number` SHALL update to `"32"`
- **AND** the previous button's `data-chapter-number` SHALL update to `"31"`
- **AND** the next button's `data-chapter-number` SHALL update to `"33"`
