## ADDED Requirements

### Requirement: Custom font stacks
The page SHALL define two CSS custom properties for font families:
- `--font-system-ui` SHALL be a CJK-optimised sans-serif stack: `Noto Sans TC, Noto Sans JP, Noto Sans SC, Noto Sans, Noto Color Emoji, Microsoft JhengHei, Heiti TC, system-ui, sans-serif`
- `--font-antique` SHALL be an antique/serif stack featuring the Iansui web font: `Iansui, Superclarendon, "Bookman Old Style", "URW Bookman", "URW Bookman L", "Georgia Pro", Georgia, serif`

The Iansui font and Noto Sans families SHALL be loaded via Google Fonts `<link rel="stylesheet">` in `<head>`, preceded by `<link rel="preconnect">` hints for `fonts.googleapis.com` and `fonts.gstatic.com` (best practice).

#### Scenario: Body text uses system-ui font stack
- **WHEN** the page is rendered
- **THEN** the `body` element's `font-family` SHALL resolve to the `--font-system-ui` custom property value

#### Scenario: Headings and decorative labels use antique font stack
- **WHEN** heading elements (h1–h6) or decorative label elements (`.char-name`, `.item-label`, `.fold-header`, `#folder-name`) are rendered
- **THEN** they SHALL use `font-family: var(--font-antique), var(--font-system-ui)` with `font-weight: normal` and `line-height: normal`

### Requirement: Content area padding
The `#content` element SHALL have horizontal padding so that prose text has breathing room within the grid column and does not sit flush against the container edges.

#### Scenario: Content has horizontal padding
- **WHEN** the story content is rendered inside `#content`
- **THEN** the content area SHALL have horizontal padding applied (e.g., `padding: 0 1rem`)

## MODIFIED Requirements

### Requirement: Compact header sizing
The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area. The header SHALL contain both the folder picker button and the navigation controls (previous button, chapter progress indicator, next button). The navigation controls SHALL be hidden until a story folder is loaded.

#### Scenario: Header uses compact padding
- **WHEN** the page is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-3 py-1` padding for a minimal-height header bar

#### Scenario: Header contains folder picker and navigation controls
- **WHEN** the page is rendered and a story folder has been selected
- **THEN** the header SHALL display the folder picker button alongside the navigation controls (previous button, chapter progress indicator, next button) in a single unified bar

#### Scenario: Navigation controls hidden before story is loaded
- **WHEN** the page is rendered and no story folder has been selected
- **THEN** the navigation controls (previous button, chapter progress indicator, next button) in the header SHALL be hidden, and only the folder picker button SHALL be visible
