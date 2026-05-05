# Tools Menu

## Purpose

Header dropdown menu and `/tools/*` shell layout that surfaces story-utility tools (Quick Add, ST Character Card Importer, future tools) without leaving the SPA, with keyboard accessibility and a sidebar-driven nested-route content area.

## Requirements

### Requirement: Tools parent route and layout component

The application SHALL provide a `ToolsLayout.vue` component that renders a left sidebar (~200 px width) and a content area, mounted at the `/tools` parent route. The content area SHALL render a `<router-view />` for nested child routes. `ToolsLayout.vue` SHALL be lazy-loaded via dynamic `import()`. `/tools` SHALL redirect to its first child route (currently `/tools/new-series`). The `/tools` parent route SHALL NOT be nested under `MainLayout`; it is a peer to `/` and `/settings`.

#### Scenario: Tools layout renders sidebar and content area
- **WHEN** the user navigates to any `/tools/*` route
- **THEN** `ToolsLayout.vue` SHALL render a left sidebar (~200 px) and a content area containing the matched child route's component via `<router-view />`

#### Scenario: Tools layout is lazy-loaded
- **WHEN** the `/tools` route is matched for the first time in a session
- **THEN** the `ToolsLayout.vue` component SHALL be loaded via dynamic `import()` and SHALL NOT be included in the initial bundle

#### Scenario: Tools parent route redirects to first tool
- **WHEN** the user navigates to `/tools` exactly
- **THEN** the router SHALL redirect to `/tools/new-series`

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
