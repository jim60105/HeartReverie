## ADDED Requirements

### Requirement: Two-column status panel layout
The page SHALL use a CSS Grid two-column layout on desktop viewports (min-width 768px). The left column SHALL contain the story content (`#content`) with the same max-width as the original single-column layout (48rem / max-w-3xl). The right column SHALL contain a sticky sidebar (`#sidebar`) that takes the remaining width. The status panel SHALL be moved from `#content` to `#sidebar` via JavaScript after rendering. On mobile viewports (below 768px), the layout SHALL collapse to a single column with the status panel rendered inline.

#### Scenario: Desktop viewport shows two-column layout
- **WHEN** the viewport width is 768px or greater and a `<status>` block is present
- **THEN** the page SHALL display the story content in the left column and the status panel in a separate right sidebar column, not mixed into the text content

#### Scenario: Status panel is sticky in sidebar
- **WHEN** the user scrolls through story content on desktop
- **THEN** the status panel in the right sidebar SHALL remain sticky at the top of the viewport offset by the header height

#### Scenario: Mobile viewport shows single-column layout
- **WHEN** the viewport width is below 768px and a `<status>` block is present
- **THEN** the layout SHALL collapse to a single column with the status panel rendered inline within the normal content flow

### Requirement: Compact header sizing
The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area.

#### Scenario: Header uses compact padding
- **WHEN** the page is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-3 py-1` padding for a minimal-height header bar

### Requirement: Compact navigation bar sizing
The bottom navigation bar (`#chapter-nav`) SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the bottom of the viewport, increasing the visible reading area.

#### Scenario: Navigation bar uses compact padding
- **WHEN** the chapter navigation bar is visible
- **THEN** the nav bar SHALL use `py-1 px-3` padding and buttons SHALL use `px-3 py-1` padding for a minimal-height navigation bar

### Requirement: Colour variable merge for love theme
The CSS custom properties SHALL be updated to merge the following colour values into the love theme for improved prose readability:
- `--text-main` SHALL be `rgba(207, 207, 197, 1)` (replacing the previous `#f0c0cc`)
- `--text-italic` SHALL be `rgba(145, 145, 145, 1)` (new variable for italic text)
- `--text-underline` SHALL be `rgba(145, 145, 145, 1)` (new variable for underlined text)
- `--text-quote` SHALL be `rgba(198, 193, 151, 1)` (new variable for blockquote text)
- `--shadow-color` SHALL be `rgba(0, 0, 0, 0.9)` (new variable for shadow effects)
- `--shadow-width` SHALL be `2px` (new variable for text shadow offset)
- `--border-outer` SHALL be `rgba(0, 0, 0, 1)` (new variable for outer border colour)

#### Scenario: Updated main text colour is applied
- **WHEN** the page is rendered with the love theme
- **THEN** the `--text-main` CSS custom property SHALL resolve to `rgba(207, 207, 197, 1)`

#### Scenario: New italic text colour is available
- **WHEN** italic text is rendered in the prose content
- **THEN** the italic text SHALL be styled using the `--text-italic` variable with value `rgba(145, 145, 145, 1)`

#### Scenario: New underline text colour is available
- **WHEN** underlined text is rendered in the prose content
- **THEN** the underlined text SHALL be styled using the `--text-underline` variable with value `rgba(145, 145, 145, 1)`

#### Scenario: New quote text colour is available
- **WHEN** a blockquote is rendered in the prose content
- **THEN** the blockquote text SHALL be styled using the `--text-quote` variable with value `rgba(198, 193, 151, 1)`

### Requirement: Body background colour preserved
The `body` element's `background-color` SHALL remain `#0f0a0c` (original love theme). The colour merge only affects text and tint variables, not the page background.

#### Scenario: Body background unchanged
- **WHEN** the page is rendered
- **THEN** the body background-color SHALL be `#0f0a0c`

### Requirement: Prose text-shadow
Paragraph text in the prose content area SHALL have a `text-shadow` using `--shadow-width` and `--shadow-color` to improve legibility against the background.

#### Scenario: Prose paragraphs have text-shadow
- **WHEN** paragraph text is rendered inside `#content`
- **THEN** the paragraphs SHALL have `text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color)` applied
