## MODIFIED Requirements

### Requirement: Settings layout with sidebar and content area

The application SHALL provide a `SettingsLayout.vue` component that renders a content area containing a `<router-view />` for nested child routes. The component's sidebar presentation SHALL depend on viewport width:

- At viewport widths **≥ 768 px** (desktop), the sidebar SHALL render as a fixed left column (~200 px width) adjacent to the content area, containing tab navigation links and a back-to-reader button. The component layout SHALL be `display: flex` (sidebar + content).
- At viewport widths **≤ 767 px** (mobile), the sidebar SHALL NOT participate in the inline flex layout — it SHALL render as an off-canvas overlay drawer (see "Settings sidebar collapses to an overlay drawer on mobile" below). The content area SHALL occupy the full viewport width and SHALL NOT be horizontally compressed by a sidebar.

`SettingsLayout.vue` SHALL be lazy-loaded as the component for the `/settings` parent route. Resizing the viewport across the 768 px breakpoint SHALL NOT remount `SettingsLayout` or its child route component.

#### Scenario: Settings layout renders sidebar and content area on desktop

- **WHEN** the user navigates to any `/settings/*` route on a viewport ≥ 768 px
- **THEN** `SettingsLayout.vue` SHALL render a left sidebar (~200 px) and a content area containing the matched child route's component via `<router-view />`

#### Scenario: Sidebar is fixed width on desktop

- **WHEN** the settings page is displayed on a viewport 768 px or wider
- **THEN** the sidebar SHALL have a fixed width of approximately 200 px and the content area SHALL fill the remaining horizontal space

#### Scenario: Settings layout content area is full-width on mobile

- **WHEN** the user navigates to any `/settings/*` route on a viewport ≤ 767 px
- **THEN** the content area SHALL span the full viewport width (no inline sidebar gutter), the sidebar SHALL NOT be part of the document flow, and `document.documentElement.scrollWidth === clientWidth` SHALL hold

#### Scenario: Crossing the 768 px breakpoint does not remount

- **WHEN** the viewport is resized from 1280 px to 443 px (or vice versa) within the same page session
- **THEN** `SettingsLayout` and its currently-rendered child route SHALL remain mounted (same Vue component instance, child state preserved), and the sidebar presentation SHALL switch between inline column and off-canvas drawer via reactive CSS / `useMediaQuery`

## ADDED Requirements

### Requirement: Settings sidebar collapses to an overlay drawer on mobile

At viewport widths of 767 px or less, the `SettingsLayout.vue` component SHALL render its sidebar as a slide-in off-canvas drawer rather than as a horizontal row of tab links. The closed-state drawer SHALL be visually hidden (transform/translation off-screen to the left), MUST be marked `inert` AND `aria-hidden="true"` so it is unreachable by assistive technology and the keyboard tab order, and SHALL NOT contribute horizontal width to the document — measured as `document.documentElement.scrollWidth === document.documentElement.clientWidth` on a 443 × 920 viewport with the drawer closed.

A toggle control (an icon-only `☰` button styled identically to every other header control — `.header-btn` / `.header-btn--icon` class set, `padding: 4px 8px`, `font-size: 0.875rem`, `border-radius: 4px`, ≈ 31 px high — so the visible row of header buttons has a uniform height) SHALL be rendered inside the application header (NOT inside the `SettingsLayout` content area) at viewport widths ≤ 767 px, AND SHALL NOT be rendered at viewport widths ≥ 768 px. The toggle SHALL be injected into `AppHeader.vue` via a `#leading` slot fill owned by `SettingsLayout.vue`, so it appears as the left-most control in the header row only while a `/settings/*` route is active. The toggle SHALL carry `aria-controls` referencing the drawer's element id and `aria-expanded` reflecting open state. Activating the toggle SHALL open the drawer; activating it again (or any of the dismiss paths below) SHALL close it.

When the drawer is open it SHALL render a full-viewport backdrop element (`position: fixed; inset: 0`) with a translucent dark background; tapping the backdrop SHALL close the drawer. The drawer panel itself SHALL be `min(280px, 80vw)` wide so the backdrop remains tappable on narrow phones.

The drawer SHALL auto-close in response to **any** of the following:
- the user activates the toggle button while the drawer is open
- the user taps the backdrop
- the user presses `Escape`
- Vue Router's `afterEach` fires for any navigation while the drawer is open (so tapping a tab navigates AND dismisses the drawer in one gesture)

Focus management:
- On open, focus SHALL move into the drawer to the first focusable element (the back-to-reader button, which is the first focusable in the existing drawer markup).
- The focusable set inside the drawer SHALL be: the back-to-reader button, every settings router-link, and any close button if one is rendered. Focus order SHALL match DOM order.
- While open, keyboard `Tab` and `Shift+Tab` SHALL stay within the drawer (focus trap with wrap-around: `Tab` from the last focusable wraps to the first; `Shift+Tab` from the first wraps to the last).
- On close, focus SHALL return to the toggle button.

Accessibility semantics while open:
- The drawer panel SHALL carry `role="dialog"` and `aria-modal="true"`.
- The drawer panel SHALL have an accessible name via `aria-labelledby` (referencing a visually-hidden or visible heading element inside the drawer) or `aria-label`.
- Background page content outside the drawer SHALL be unreachable to assistive technology while the drawer is open (e.g. by setting `inert` on the sibling content area, or via the `aria-modal` semantics combined with the backdrop).

The drawer SHALL be rendered as a sibling of the `<router-view />` (i.e. inside the `SettingsLayout` template), NOT teleported to `<body>`, so it inherits the layout's stacking context and theme variables.

#### Scenario: Drawer is closed by default on mobile and contributes no horizontal overflow

- **WHEN** the user navigates to `/settings/prompt-editor` on a 443 × 920 viewport for the first time
- **THEN** the `.sidebar-nav` drawer SHALL render in the closed state (transform / translation off-screen to the left), the document SHALL satisfy `documentElement.scrollWidth === clientWidth` (no horizontal page scroll), the drawer panel SHALL carry the `inert` attribute and `aria-hidden="true"`, and the toggle button SHALL be visible inside the application header (rendered via `AppHeader`'s `#leading` slot) with `aria-expanded="false"`

#### Scenario: Tapping the toggle opens the drawer with the active tab visible

- **WHEN** the user taps the toggle button (`☰`)
- **THEN** the drawer SHALL slide in from the left to width `min(280px, 80vw)`, the backdrop SHALL appear, the drawer SHALL lose the `inert` attribute, `aria-hidden` SHALL become `"false"`, the drawer panel SHALL carry `role="dialog"` and `aria-modal="true"` and an accessible name (via `aria-labelledby` or `aria-label`), the toggle's `aria-expanded` SHALL become `"true"`, focus SHALL move to the first focusable element inside the drawer (the back-to-reader button), and the currently-active tab SHALL be visible with its active-class highlight

#### Scenario: Tapping a tab navigates and auto-closes the drawer

- **GIVEN** the drawer is open on `/settings/prompt-editor`
- **WHEN** the user taps the `LLM` tab inside the drawer
- **THEN** Vue Router SHALL navigate to `/settings/llm`, the `router.afterEach` hook SHALL close the drawer (transform off-screen, `inert` reapplied, `aria-hidden="true"`, `aria-expanded="false"`), focus SHALL return to the toggle button, and the content area SHALL render the LLM settings component

#### Scenario: Escape key closes the drawer

- **GIVEN** the drawer is open and a router-link inside it has focus
- **WHEN** the user presses `Escape`
- **THEN** the drawer SHALL close, focus SHALL return to the toggle button, no navigation SHALL occur, and no `Escape` keydown SHALL propagate to other components

#### Scenario: Backdrop click closes the drawer

- **GIVEN** the drawer is open
- **WHEN** the user taps the backdrop element (any area outside the drawer panel)
- **THEN** the drawer SHALL close without navigation

#### Scenario: Drawer is not rendered on desktop

- **WHEN** the settings page is displayed on a viewport ≥ 768 px
- **THEN** the toggle button SHALL NOT be visible or focusable, the sidebar SHALL render as the existing fixed-width vertical column (~200 px), no `inert` attribute / `aria-hidden="true"` / backdrop element SHALL exist, and resizing from mobile → desktop SHALL NOT remount `SettingsLayout` (component-local state preserved)

#### Scenario: Resizing from desktop to mobile re-enables the drawer without remount

- **WHEN** the viewport is resized from 1280 px to 443 px within the same page session
- **THEN** the layout SHALL switch to the drawer-closed state (toggle visible, drawer off-canvas with `inert` + `aria-hidden="true"`), `SettingsLayout` SHALL NOT remount, and the currently-rendered child route SHALL stay mounted in the content area

#### Scenario: Focus stays trapped inside the open drawer

- **GIVEN** the drawer is open with the back-to-reader button followed by N settings router-links inside its focus order
- **WHEN** the user presses `Tab` past the last focusable element, or `Shift+Tab` past the first
- **THEN** focus SHALL wrap to the first / last focusable element respectively, and SHALL NOT escape to elements outside the drawer panel
