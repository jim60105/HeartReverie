## MODIFIED Requirements

### Requirement: Tools parent route and layout component

The application SHALL provide a `ToolsLayout.vue` component mounted at the `/tools` parent route. The component SHALL render a content area containing a `<router-view />` for nested child routes. Its sidebar presentation SHALL depend on viewport width:

- At viewport widths **≥ 768 px** (desktop), the sidebar SHALL render as a fixed left column (~200 px width) adjacent to the content area.
- At viewport widths **≤ 767 px** (mobile), the sidebar SHALL render as an off-canvas overlay drawer (see "Tools sidebar collapses to an overlay drawer on mobile" below) and SHALL NOT be part of the inline document flow.

`ToolsLayout.vue` SHALL be lazy-loaded via dynamic `import()`. `/tools` SHALL redirect to its first child route (currently `/tools/new-series`). The `/tools` parent route SHALL NOT be nested under `MainLayout`; it is a peer to `/` and `/settings`. Resizing the viewport across the 768 px breakpoint SHALL NOT remount `ToolsLayout` or its child route component.

#### Scenario: Tools layout renders sidebar and content area on desktop

- **WHEN** the user navigates to any `/tools/*` route on a viewport ≥ 768 px
- **THEN** `ToolsLayout.vue` SHALL render a left sidebar (~200 px) and a content area containing the matched child route's component via `<router-view />`

#### Scenario: Tools layout is lazy-loaded

- **WHEN** the `/tools` route is matched for the first time in a session
- **THEN** the `ToolsLayout.vue` component SHALL be loaded via dynamic `import()` and SHALL NOT be included in the initial bundle

#### Scenario: Tools parent route redirects to first tool

- **WHEN** the user navigates to `/tools` exactly
- **THEN** the router SHALL redirect to `/tools/new-series`

#### Scenario: Tools layout content area is full-width on mobile

- **WHEN** the user navigates to any `/tools/*` route on a viewport ≤ 767 px
- **THEN** the content area SHALL span the full viewport width (no inline sidebar gutter), the sidebar SHALL NOT be part of the document flow, and `document.documentElement.scrollWidth === clientWidth` SHALL hold

## ADDED Requirements

### Requirement: Tools sidebar collapses to an overlay drawer on mobile

At viewport widths of 767 px or less, the `ToolsLayout.vue` component SHALL render its sidebar as a slide-in off-canvas overlay drawer using the same mechanics as the settings sidebar drawer. Specifically:

- The closed-state drawer SHALL be visually hidden (translated off-screen to the left), MUST be marked `inert` AND `aria-hidden="true"`, and SHALL NOT contribute horizontal width to the document (`document.documentElement.scrollWidth === clientWidth` on a 443 × 920 viewport with the drawer closed).
- A toggle control (icon-only `☰` button using the standard `.header-btn` / `.header-btn--icon` styling — `padding: 4px 8px`, `font-size: 0.875rem`, `border-radius: 4px`, ≈ 31 px high — so it visually matches every other header control) SHALL be rendered inside the application header at viewport widths ≤ 767 px and SHALL NOT be rendered at ≥ 768 px. The toggle SHALL be injected into `AppHeader.vue` via a `#leading` slot fill owned by `ToolsLayout.vue`, so it appears as the left-most control in the header row only while a `/tools/*` route is active. The toggle SHALL carry `aria-controls` referencing the drawer's element id and `aria-expanded` reflecting open state.
- When open, the drawer panel SHALL be `min(280px, 80vw)` wide, SHALL carry `role="dialog"` and `aria-modal="true"` and an accessible name (`aria-labelledby` or `aria-label`), and SHALL render a full-viewport backdrop (`position: fixed; inset: 0`) with translucent dark background.
- The drawer SHALL auto-close on any of: toggle re-tap, backdrop tap, `Escape` key, or `router.afterEach` firing for any navigation while open.
- Focus management: on open, focus SHALL move to the first focusable element inside the drawer (the back-to-reader button); while open, `Tab` / `Shift+Tab` SHALL stay within the drawer with wrap-around; on close, focus SHALL return to the toggle button.

This presentation SHALL apply regardless of how many tools children are registered in `toolsChildren`. The drawer SHALL NOT degrade to a wrapped horizontal-row layout even if the number of tools is small.

The drawer and toggle SHALL be implemented using the same shared composable (`useSidebarDrawer`) as the settings drawer so the two layouts cannot drift apart in behavior.

#### Scenario: Tools drawer is closed by default on mobile

- **WHEN** the user navigates to `/tools/new-series` on a 443 × 920 viewport
- **THEN** the drawer SHALL render in the closed state, the document SHALL satisfy `documentElement.scrollWidth === clientWidth`, the drawer panel SHALL carry `inert` and `aria-hidden="true"`, and the toggle button SHALL be visible inside the application header (rendered via `AppHeader`'s `#leading` slot) with `aria-expanded="false"`

#### Scenario: Tools drawer opens with dialog semantics and focus moved to first tab

- **WHEN** the user taps the tools toggle button (`☰`)
- **THEN** the drawer SHALL slide in from the left, the backdrop SHALL appear, the drawer panel SHALL carry `role="dialog"`, `aria-modal="true"`, and an accessible name, `aria-expanded` on the toggle SHALL become `"true"`, and focus SHALL move to the first focusable element inside the drawer

#### Scenario: Tools drawer auto-closes on route navigation and Escape

- **GIVEN** the tools drawer is open on `/tools/new-series`
- **WHEN** the user taps a different tool link inside the drawer (or presses `Escape`)
- **THEN** Vue Router SHALL navigate (link case only) and the `router.afterEach` hook SHALL close the drawer (transform off-screen, `inert` reapplied, `aria-hidden="true"`, `aria-expanded="false"`), focus SHALL return to the toggle, and on `Escape` the keydown SHALL NOT propagate to other components

#### Scenario: Tools drawer focus is trapped while open

- **GIVEN** the tools drawer is open with the back-to-reader button followed by N tool router-links focusable
- **WHEN** the user presses `Tab` past the last focusable, or `Shift+Tab` past the first
- **THEN** focus SHALL wrap to the first / last focusable element respectively, and SHALL NOT escape the drawer panel

#### Scenario: Tools drawer is not rendered on desktop

- **WHEN** the tools page is displayed on a viewport ≥ 768 px
- **THEN** the toggle button SHALL NOT be visible or focusable, the sidebar SHALL render as the existing fixed-width vertical column, and no drawer panel / backdrop element SHALL exist (or both SHALL be removed from accessibility / interactive trees)

#### Scenario: Adding a new tools child does not regress the drawer

- **WHEN** a new entry is added to `toolsChildren` so the total exceeds the number that fits in a single wrapped row
- **THEN** the mobile presentation SHALL remain the off-canvas drawer (NOT a wrapped horizontal row) and the closed-state `documentElement.scrollWidth === clientWidth` invariant SHALL still hold on a 443 × 920 viewport
