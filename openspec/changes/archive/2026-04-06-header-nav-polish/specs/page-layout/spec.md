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

## REMOVED Requirements

### Requirement: Compact navigation bar sizing
The bottom navigation bar (`#chapter-nav`) SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the bottom of the viewport, increasing the visible reading area.

- **Reason**: The navigation controls have been merged into the `<header>` element. A separate bottom navigation bar is no longer needed, reducing the number of sticky bars from two to one and reclaiming vertical reading space.
- **Migration**: All navigation buttons and the chapter progress indicator are now rendered within the `<header>`. Any references to `#chapter-nav` in layout or styling should be removed.

## ADDED Requirements

### Requirement: Hidden sidebar scrollbar
The `#sidebar` element SHALL hide its scrollbar while remaining scrollable, using `scrollbar-width: none` for standards-compliant browsers and `::-webkit-scrollbar { display: none }` for WebKit-based browsers. The sidebar content SHALL remain fully accessible via scroll gestures or mouse wheel.

#### Scenario: Sidebar scrollbar is visually hidden
- **WHEN** the sidebar content exceeds the visible viewport height on desktop
- **THEN** the `#sidebar` element SHALL not display a visible scrollbar, but the user SHALL still be able to scroll through the sidebar content using scroll gestures, mouse wheel, or keyboard navigation
