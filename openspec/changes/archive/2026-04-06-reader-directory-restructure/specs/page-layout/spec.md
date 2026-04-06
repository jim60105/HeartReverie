## MODIFIED Requirements

### Requirement: Two-column status panel layout
The page SHALL use a CSS Grid two-column layout on desktop viewports (min-width 768px). The left column SHALL contain the story content (`#content`) with the same max-width as the original single-column layout (48rem / max-w-3xl). The right column SHALL contain a sticky sidebar (`#sidebar`) that takes the remaining width. The status panel SHALL be moved from `#content` to `#sidebar` via JavaScript after rendering. On mobile viewports (below 768px), the layout SHALL collapse to a single column with the status panel rendered inline.

All web reader source files (`index.html`, `js/` modules, `serve.zsh`) SHALL reside under a `reader/` directory at the project root. Internal relative paths between these files remain unchanged since they move together.

#### Scenario: Desktop viewport shows two-column layout
- **WHEN** the viewport width is 768px or greater and a `<status>` block is present
- **THEN** the page SHALL display the story content in the left column and the status panel in a separate right sidebar column, not mixed into the text content

#### Scenario: Status panel is sticky in sidebar
- **WHEN** the user scrolls through story content on desktop
- **THEN** the status panel in the right sidebar SHALL remain sticky at the top of the viewport offset by the header height

#### Scenario: Mobile viewport shows single-column layout
- **WHEN** the viewport width is below 768px and a `<status>` block is present
- **THEN** the layout SHALL collapse to a single column with the status panel rendered inline within the normal content flow

#### Scenario: Web reader files live under reader directory
- **WHEN** the project is checked out
- **THEN** `reader/index.html`, `reader/js/`, and `reader/serve.zsh` SHALL exist and the reader SHALL be served from the `reader/` directory
