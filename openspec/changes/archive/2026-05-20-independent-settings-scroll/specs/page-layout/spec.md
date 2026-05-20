## ADDED Requirements

### Requirement: No body-level scroll on settings and tools routes at desktop widths

On routes matching `/settings` or `/settings/*` or `/tools` or `/tools/*` at viewport widths ≥ 768 px, the document body SHALL NOT introduce a vertical scrollbar. The page MAY contain arbitrarily tall content, but that scroll SHALL be confined to the layout's drawer and content scroll containers (defined by the `settings-page` and `tools-menu` capabilities). The sticky `<header>` (`AppHeader.vue`) SHALL therefore remain visible at the top of the viewport at all times on these routes regardless of how far the user has scrolled within either column.

This is a global guarantee for the application shell and complements the per-layout requirements in `settings-page` / `tools-menu`. On other routes (notably reading routes such as `/`, `/<series>`, `/<series>/<story>/chapter/<i>`), this requirement does NOT apply — those routes continue to use body-level scrolling as today.

#### Scenario: Reading routes still scroll the body

- **WHEN** the user is on a reading route (e.g. `/test/test/chapter/1`) at any viewport width
- **THEN** the document body MAY produce a vertical scrollbar as it does today; this requirement SHALL NOT restrict reading-route scroll behavior

#### Scenario: Body has no vertical scrollbar on settings desktop

- **WHEN** the user navigates to any `/settings/*` route at a viewport ≥ 768 px
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` and `<header>`'s top edge SHALL remain pinned to viewport `y = 0`

#### Scenario: Body has no vertical scrollbar on tools desktop

- **WHEN** the user navigates to any `/tools/*` route at a viewport ≥ 768 px
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` and `<header>`'s top edge SHALL remain pinned to viewport `y = 0`
