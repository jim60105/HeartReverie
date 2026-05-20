# Tools Menu

## Purpose

Header dropdown menu and `/tools/*` shell layout that surfaces story-utility tools (Quick Add, ST Character Card Importer, future tools) without leaving the SPA, with keyboard accessibility and a sidebar-driven nested-route content area.

## Requirements

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

### Requirement: Tools children registry

The router module SHALL export a `toolsChildren: RouteRecordRaw[]` array that lists every tool child route. Each entry SHALL declare a `path` (relative, kebab-case), a `name` of the form `tools-<slug>`, a lazy-loaded `component`, and a `meta.title` string used by the sidebar and the header dropdown as the human-readable label. The `/tools` route SHALL consume this array via its `children` field. Adding a new tool SHALL require only appending an entry to `toolsChildren`; no edits to `ToolsLayout.vue` or `AppHeader.vue` SHALL be required.

#### Scenario: Adding a tool requires only a router edit
- **WHEN** a contributor adds a new entry `{ path: "foo", name: "tools-foo", component: () => import("..."), meta: { title: "Foo Tool" } }` to `toolsChildren`
- **THEN** the new tool SHALL appear as both a sidebar tab inside `ToolsLayout.vue` and an entry in the header tools-menu dropdown without any other code edit

#### Scenario: Sidebar tab text comes from meta.title
- **WHEN** the sidebar renders a tool's `<router-link>`
- **THEN** the link text SHALL be the entry's `meta.title`, falling back to `name` only when `meta.title` is absent

### Requirement: Tools sidebar tab navigation

The `ToolsLayout` sidebar SHALL render one `<router-link>` per entry in `toolsChildren`. The active tab SHALL be visually indicated via Vue Router's `active-class` (or `exact-active-class`). Clicking a tab SHALL navigate to the corresponding child route and the content area SHALL render the matched component.

#### Scenario: Active tab is visually highlighted
- **WHEN** the user is on `/tools/new-series`
- **THEN** the "快速新增" sidebar link SHALL have the active CSS class applied, visually distinguishing it from inactive tabs

#### Scenario: Sidebar items driven by route config
- **WHEN** a new child route is added to `toolsChildren`
- **THEN** the sidebar SHALL render a corresponding navigation link without requiring changes to `ToolsLayout.vue`'s template

### Requirement: Header tools-menu dropdown

`AppHeader.vue` SHALL render a 🧰 icon button immediately adjacent to the existing ⚙️ settings button, sharing the same `header-btn header-btn--icon` class set. Clicking the button SHALL toggle a dropdown panel rendered as a direct child of the header DOM (not via `<Teleport>`). The dropdown SHALL list one `<router-link>` per entry in `toolsChildren`, using each entry's `meta.title` as the label and routing to the entry's `name`. Selecting an item SHALL close the dropdown and navigate to the chosen tool. The dropdown SHALL close when the user clicks outside it, presses Escape, or navigates to any other route.

#### Scenario: Dropdown opens and closes from the icon button
- **WHEN** the user clicks the 🧰 button while the dropdown is closed
- **THEN** the dropdown panel SHALL become visible and list every tool from `toolsChildren`

#### Scenario: Outside click closes the dropdown
- **WHEN** the dropdown is open and the user clicks anywhere outside the dropdown panel and outside the 🧰 button
- **THEN** the dropdown SHALL close

#### Scenario: Escape key closes the dropdown
- **WHEN** the dropdown is open and the user presses the Escape key
- **THEN** the dropdown SHALL close and focus SHALL return to the 🧰 button

#### Scenario: Selecting a tool navigates and closes
- **WHEN** the user clicks a tool entry inside an open dropdown
- **THEN** the application SHALL call `router.push({ name: entry.name })` and SHALL close the dropdown in the same interaction

#### Scenario: Menu reflects the registry without code changes
- **WHEN** `toolsChildren` is changed at build time (entries added or removed)
- **THEN** the dropdown content SHALL update accordingly without any edit to `AppHeader.vue` or `ToolsMenu.vue`

#### Scenario: Dropdown does not use Teleport
- **WHEN** inspecting the rendered DOM for the open dropdown
- **THEN** the dropdown panel SHALL be a descendant of the `<header>` element, not a direct child of `<body>`

#### Scenario: ArrowDown on the trigger opens the menu and focuses the first item
- **WHEN** the trigger button has focus and the user presses ArrowDown (or Enter / Space)
- **THEN** the dropdown SHALL open and focus SHALL move to the first menu item

#### Scenario: ArrowUp / ArrowDown / Home / End cycle focus among items
- **WHEN** the dropdown is open and any menu item has focus
- **THEN** ArrowDown SHALL move focus to the next item (wrapping at the end), ArrowUp SHALL move focus to the previous item (wrapping at the start), Home SHALL move focus to the first item, and End SHALL move focus to the last item

### Requirement: Tools menu visibility across viewports

The 🧰 button SHALL remain visible and reachable at all viewport widths (including the audited mobile range 360 px to 767 px), matching the visibility rule that already applies to the ⚙️ settings button. The dropdown panel SHALL be sized so its content fits within the viewport at 360 px width without horizontal overflow.

#### Scenario: Tools button visible on mobile
- **WHEN** the viewport width is 360 px and the application is rendered
- **THEN** the 🧰 button SHALL be visible and focusable in the header

#### Scenario: Dropdown fits the mobile viewport
- **WHEN** the user opens the tools dropdown at a 360 px viewport width
- **THEN** the dropdown panel SHALL fit within the viewport without horizontal scroll

### Requirement: useTools composable

The application SHALL provide a `useTools()` composable that exposes a reactive `tools: ComputedRef<Array<{ name: string; title: string }>>` derived from the `toolsChildren` registry, plus an `isOpen: Ref<boolean>` and `open()`, `close()`, `toggle()` methods. The composable SHALL register a single document-level click handler while `isOpen.value === true` to implement the outside-click-closes rule, and SHALL remove that handler when the dropdown closes or the consumer unmounts.

#### Scenario: tools list mirrors the registry
- **WHEN** `useTools()` is consumed by `ToolsMenu.vue`
- **THEN** the returned `tools` ref SHALL contain one item per entry in `toolsChildren`, in the same order, each item exposing `{ name, title }`

#### Scenario: outside click handler is scoped to open state
- **WHEN** the dropdown is closed
- **THEN** no document-level click handler from `useTools` SHALL be active

### Requirement: Tools drawer and content scroll independently within the viewport

When viewport width ≥ 768 px (desktop / tablet), the `ToolsLayout.vue` component SHALL constrain the visible area to the viewport so that the sticky `<header>` (`AppHeader.vue`) is always on screen and the two columns inside `.tools-body` each scroll on their own — mirroring the equivalent behavior specified for `SettingsLayout` in the `settings-page` capability. Specifically:

- The `.tools-layout` root SHALL be height-capped to `100dvh` (with `100vh` declared first as a fallback). `min-height: 100vh` SHALL NOT cause the layout to grow past the viewport.
- The `.tools-body` flex container SHALL set `flex: 1; min-height: 0; overflow: hidden` so neither column can spill into a body-level scroll.
- The desktop sidebar (`#tools-drawer` `<aside>`, class `.tools-sidebar` without `.is-mobile`) SHALL set `overflow-y: auto; min-height: 0`. A long `toolsChildren` list SHALL scroll inside the aside only, with no movement in the content area or the document body.
- The content `<main>` (`.tools-content`) SHALL set `overflow-y: auto; min-height: 0`. Long tool pages (e.g. the new-series wizard, future import / migration tools) SHALL scroll inside the main column only.
- The document body SHALL NOT introduce a vertical scrollbar on any `/tools/*` route at viewport widths ≥ 768 px: `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (allowing subpixel rounding).

At viewport widths ≤ 767 px the mobile drawer rules in "Tools sidebar collapses to an overlay drawer on mobile" continue to apply unchanged.

#### Scenario: Long tools sidebar scrolls within the aside on desktop

- **GIVEN** the user is on a `/tools/*` route at 1280 × 720 viewport with a `toolsChildren` list whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `#tools-drawer`
- **THEN** the aside's internal scroll position SHALL advance, `<main class="tools-content">` `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Long tool content scrolls within the main on desktop

- **GIVEN** the user is on a `/tools/*` route at 1280 × 720 viewport with a tool page whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `.tools-content`
- **THEN** the main's internal scroll position SHALL advance, `#tools-drawer` `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Document body does not scroll on any tools route at desktop widths

- **WHEN** the user navigates to any `/tools/*` route at a viewport ≥ 768 px (audited at 1280 × 720 and 768 × 1024)
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (no body-level vertical scrollbar), regardless of how tall the sidebar or content's natural heights are

#### Scenario: Computed styles enforce the scroll containers

- **WHEN** the user is on a `/tools/*` route at a viewport ≥ 768 px
- **THEN** `getComputedStyle(.tools-layout).height` SHALL equal the viewport height (within 1 px), `getComputedStyle(.tools-body)` SHALL include `min-height: 0px` and `overflow: hidden`, `getComputedStyle(#tools-drawer)` SHALL include `min-height: 0px` and `overflow-y: auto`, and `getComputedStyle(.tools-content)` SHALL include `min-height: 0px` and `overflow-y: auto`

#### Scenario: Mobile behavior unaffected

- **WHEN** the user is on a `/tools/*` route at a viewport ≤ 767 px
- **THEN** the desktop-only independent-scroll guarantee SHALL NOT be required and the mobile drawer SHALL render per "Tools sidebar collapses to an overlay drawer on mobile"
