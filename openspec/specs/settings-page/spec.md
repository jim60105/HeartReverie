# Settings Page

## Purpose

Dedicated settings page with sidebar navigation and content area for application configuration panels (prompt editor, future settings tabs).

## Requirements

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

### Requirement: Sidebar tab navigation with router-link active state

The sidebar SHALL render navigation items as `<router-link>` elements pointing to each settings child route. The active tab SHALL be visually indicated using Vue Router's `active-class` (or `exact-active-class`) prop to apply a highlight style. Sidebar items SHALL be driven by the route configuration (e.g., iterating over the `/settings` route's `children` array or a derived list), making the tab system extensible without modifying the sidebar template.

#### Scenario: Active tab is visually highlighted
- **WHEN** the user is on `/settings/prompt-editor`
- **THEN** the "Prompt Editor" sidebar link SHALL have the active CSS class applied, visually distinguishing it from inactive tabs

#### Scenario: Sidebar items driven by route config
- **WHEN** a new child route is added to the `/settings` route definition
- **THEN** the sidebar SHALL render a corresponding navigation link without requiring changes to `SettingsLayout.vue`'s template

#### Scenario: Clicking a tab navigates to the child route
- **WHEN** the user clicks a sidebar tab link
- **THEN** Vue Router SHALL navigate to the corresponding child route and the content area SHALL render the matched component

### Requirement: Back-to-reader navigation

The sidebar SHALL include a `← 返回閱讀` back button at the top. Clicking the button SHALL exit the `/settings/*` area in a single navigation, regardless of the user's intra-settings tab history.

The frontend SHALL maintain an in-memory record of the **last reading route** the user occupied — defined as the most recently navigated-to route whose path is **none of**: exactly `/settings`, starting with `/settings/`, exactly `/tools`, or starting with `/tools/`. (A loose `startsWith("/settings")` or `startsWith("/tools")` predicate MUST NOT be used: it would mis-classify valid top-level reading paths whose first segment merely starts with the literal substring `settings` or `tools`, such as a series slug `settings-archive` rendered at `/settings-archive/my-story` or `tools-archive` rendered at `/tools-archive/my-story`.) The record SHALL be updated by a `router.afterEach` global navigation guard installed once at application bootstrap, and the guard MUST be registered BEFORE the router-induced initial navigation completes (i.e., before `app.use(router)`) so that direct entry to a reading URL is captured. The record SHALL store the route's portable identifier (`name`, `params`, `query`, and `hash`; or `path`, `query`, and `hash` as a defensive fallback for unnamed routes), NOT a fullPath string. The record SHALL be in-memory only (it is not persisted across page reloads or browser sessions).

When the user clicks `← 返回閱讀`:
- If a last reading route has been recorded, the application SHALL call `router.push()` with the recorded route location.
- If no last reading route has been recorded (e.g., the user opened a `/settings/*` URL directly with no prior reading navigation in this SPA session), the application SHALL navigate to `/` (the home route) as the fallback.

The button SHALL NOT call `router.back()` and SHALL NOT walk browser history in any form. Browser back/forward buttons remain governed by Vue Router's default history behavior — only the in-app back button is destination-driven.

The same captured record SHALL be reused by any future `← 返回閱讀` control hosted under `/tools/*` (e.g. inside `ToolsLayout`'s sidebar). The capture predicate is shared; only the consumer surface differs.

#### Scenario: Back button returns to last reading route after intra-settings navigation

- **WHEN** the user navigates `/storyA/storyB/chapter/3` → `/settings/prompt-editor` → `/settings/lore` → `/settings/llm` and then clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/storyA/storyB/chapter/3` in a single transition, without passing through `/settings/lore` or `/settings/prompt-editor`

#### Scenario: Back button returns to home when no reading route was recorded

- **WHEN** the user opens `/settings/llm` as the first route in the SPA session (e.g., direct URL entry, fresh page load) and clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/` (home) as the fallback

#### Scenario: Last reading route is updated when the user re-enters reading then re-enters settings

- **WHEN** the user navigates `/` → `/settings/llm` → `/storyA` → `/settings/lore` and then clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/storyA` (the most recent non-`/settings` and non-`/tools` route), not to `/`

#### Scenario: Settings tab navigation does not overwrite the last reading route

- **WHEN** the user navigates `/storyA` → `/settings/prompt-editor` → `/settings/llm`
- **THEN** the recorded last reading route SHALL still be `/storyA` after the second settings navigation, because neither `/settings/prompt-editor` nor `/settings/llm` matches the reading-route criterion (their paths start with `/settings/`)

#### Scenario: Tools navigation does not overwrite the last reading route

- **WHEN** the user navigates `/storyA` → `/tools/new-series` → `/tools/import-character-card`
- **THEN** the recorded last reading route SHALL still be `/storyA` after the tools navigations, because both `/tools/new-series` and `/tools/import-character-card` have paths that start with `/tools/`

#### Scenario: Crossing between settings and tools does not overwrite the last reading route

- **WHEN** the user navigates `/storyA` → `/settings/prompt-editor` → `/tools/new-series` → `/settings/llm`
- **THEN** the recorded last reading route SHALL still be `/storyA`, because none of the three intermediate paths satisfies the reading-route criterion

#### Scenario: Top-level paths whose first segment starts with the substring `settings` ARE reading routes

- **WHEN** the user navigates to a story-shaped path such as `/settings-archive/my-story` (which matches the `story` route, NOT a settings route)
- **THEN** the navigation guard SHALL record this route as a reading route (because its path is neither exactly `/settings` nor starts with `/settings/`, and is neither exactly `/tools` nor starts with `/tools/`)

#### Scenario: Top-level paths whose first segment starts with the substring `tools` ARE reading routes

- **WHEN** the user navigates to a story-shaped path such as `/tools-archive/my-story` (which matches the `story` route, NOT a tools route)
- **THEN** the navigation guard SHALL record this route as a reading route (because its path is neither exactly `/tools` nor starts with `/tools/`)

#### Scenario: Captured route shape is portable

- **WHEN** the navigation guard captures a reading route
- **THEN** the captured value SHALL be an object exposing at minimum `name`, `params`, `query`, and `hash`, suitable as input to `router.push()`, rather than a raw fullPath string

### Requirement: Settings route redirect to first tab

The `/settings` route (without a child path) SHALL redirect to the first available settings tab. Initially, this SHALL redirect to `/settings/prompt-editor`. The redirect SHALL be defined in the route configuration, not in `SettingsLayout.vue` component logic.

#### Scenario: Bare settings path redirects
- **WHEN** the user navigates to `/settings`
- **THEN** Vue Router SHALL redirect to `/settings/prompt-editor`

#### Scenario: Redirect defined in route config
- **WHEN** the `/settings` route definition is inspected
- **THEN** the redirect SHALL be declared as a `redirect` property on the parent route object, not as imperative navigation in a component

### Requirement: Extensible tab registration

The settings tab system SHALL be extensible by adding new child routes to the `/settings` parent route. Each child route SHALL declare a `meta` object containing at minimum a `title` (string, used as the sidebar display text), and MAY declare a `category` (string, used to group sibling tabs in the sidebar). The sidebar component SHALL derive its navigation items from the route children's `meta.title` values, ensuring new tabs can be added without modifying the sidebar component.

The sidebar component SHALL bucket sibling tabs by `meta.category`. Children with no `category` (or `category: "general"`) SHALL appear in the default "一般 / General" group at the top of the sidebar. Children with `category: "developer-tools"` SHALL appear in a separate "開發者工具 / Developer Tools" group rendered below the default group. Additional categories MAY be added in future without changes to the sidebar component, provided the sidebar maps the category key to a human-readable group label (a small static map within the component is acceptable; falling back to the raw category key when no label is mapped is acceptable).

Within each category group, tabs SHALL appear in the order defined by the children array in the route configuration.

No second authentication gate (such as a `?dev=1` query string) SHALL be required for developer-tools category tabs. The passphrase gate remains the sole auth boundary for the entire writer SPA.

#### Scenario: New tab added via route config only
- **WHEN** a developer adds a new child route `{ path: 'appearance', component: AppearancePage, meta: { title: '外觀設定' } }` to the `/settings` route
- **THEN** the sidebar SHALL automatically render a "外觀設定" link pointing to `/settings/appearance` under the default "一般" group without any template changes

#### Scenario: Tab order follows route definition order
- **WHEN** multiple child routes are defined under `/settings` within the same `meta.category`
- **THEN** the sidebar SHALL render those tabs in the same order as the children array in the route configuration

#### Scenario: Developer-tools category renders as a separate group
- **WHEN** a child route is registered with `meta.category: "developer-tools"`
- **THEN** the sidebar SHALL render that tab inside a "開發者工具 / Developer Tools" group separate from the default "一般 / General" group, and the developer-tools group SHALL render BELOW the default group

#### Scenario: Default group is shown when no category is declared
- **WHEN** a child route declares `meta` without a `category` field
- **THEN** the sidebar SHALL render that tab inside the default "一般 / General" group

#### Scenario: No second auth gate for developer tabs
- **WHEN** a user has passed the passphrase gate and navigates to a developer-tools tab
- **THEN** the SPA SHALL render the tab without requiring any additional query parameter, header, or confirmation

### Requirement: Hook Inspector settings tab

The settings area SHALL include a child route at `/settings/hook-inspector` with `meta.title` set to a Traditional Chinese label (e.g. `Hook 檢視`) and `meta.category` set to `"developer-tools"`. The route SHALL lazy-load `HookInspectorPage.vue` from `reader-src/src/components/`. Behavioural details (fetch URL, conflict detection, error reporting, refresh behavior, etc.) are specified by the `hook-inspector` capability; this requirement only governs the route registration and sidebar placement.

#### Scenario: Hook Inspector route registered with developer-tools category
- **WHEN** the `/settings/hook-inspector` child route is registered
- **THEN** its `meta` SHALL include `{ title: <zh-TW label>, category: "developer-tools" }` and the sidebar SHALL render the link under the "開發者工具 / Developer Tools" group described in the modified "Extensible tab registration" requirement

### Requirement: LLM settings tab per story

The settings area SHALL include a new tab registered as a child route of `/settings` at path `llm` (resolving to `/settings/llm`) with `meta.title` set to a Traditional Chinese label such as `LLM 設定`. The route SHALL lazy-load a new `LlmSettingsPage.vue` component. The page SHALL allow the user to select an existing story and edit its LLM parameter overrides (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`). Each field SHALL render a "use default" toggle; when the toggle is ON, the field SHALL be omitted from the request body sent by Save, and the env default SHALL therefore apply at chat time. Loading and saving SHALL go through a new `useStoryLlmConfig` composable wrapping `GET` and `PUT /api/:series/:name/config`. API errors SHALL be surfaced through the existing toast notification mechanism. All user-facing text SHALL be in Traditional Chinese (zh-TW) to match the rest of the frontend.

#### Scenario: Sidebar exposes the LLM settings tab via route config
- **WHEN** the `/settings/llm` child route is registered with `meta.title: 'LLM 設定'`
- **THEN** the sidebar SHALL render a "LLM 設定" link pointing to `/settings/llm` without any changes to the sidebar template

#### Scenario: Page loads current overrides for the selected story
- **GIVEN** the user is on `/settings/llm` and selects a story whose `_config.json` contains `{ "temperature": 0.7 }`
- **WHEN** the page finishes loading the story config
- **THEN** the temperature field SHALL display `0.7` with its "use default" toggle OFF, and every other field's "use default" toggle SHALL be ON

#### Scenario: Save sends only non-default fields
- **GIVEN** the user has toggled "use default" OFF only for temperature and entered `0.3`
- **WHEN** the user clicks the Save button
- **THEN** the frontend SHALL issue `PUT /api/:series/:name/config` with body `{ "temperature": 0.3 }` and SHALL NOT include any other LLM field

#### Scenario: Toggling "use default" on removes the field on save
- **GIVEN** the form currently has temperature loaded as `0.9` with its "use default" toggle OFF
- **WHEN** the user toggles the temperature "use default" toggle ON and clicks Save
- **THEN** the frontend SHALL issue `PUT /api/:series/:name/config` with body `{}`

#### Scenario: API error surfaces through toast notifications
- **WHEN** the Save request returns a non-2xx response
- **THEN** the page SHALL show an error toast using the existing toast notification mechanism and SHALL leave the form values unchanged so the user can retry

### Requirement: Settings drawer and content scroll independently within the viewport

When viewport width ≥ 768 px (desktop / tablet), the `SettingsLayout.vue` component SHALL constrain the visible area to the viewport so that the sticky `<header>` (`AppHeader.vue`) is always on screen and the two columns inside `.settings-body` each scroll on their own. Specifically:

- The `.settings-layout` root SHALL be height-capped to `100dvh` (with `100vh` as a `dvh`-unaware fallback declared first). `min-height: 100vh` SHALL NOT cause the layout to grow past the viewport.
- The `.settings-body` flex container SHALL fill the remaining vertical space below the header and SHALL set `flex: 1; min-height: 0; overflow: hidden` so neither column can spill into a body-level scroll.
- The desktop sidebar (`#settings-drawer` `<aside>`, class `.settings-sidebar` without `.is-mobile`) SHALL set `overflow-y: auto; min-height: 0` so that a sidebar long enough to exceed the available height (general tabs + plugin tabs + developer-tools tabs + back-to-reader button) scrolls inside the aside only. Sidebar scroll position SHALL NOT move the content area.
- The content `<main>` (`.settings-content`) SHALL set `overflow-y: auto; min-height: 0` so that long routed content (e.g. `/settings/prompt-editor`, `/settings/lore`, `/settings/llm`, `/settings/theme`, plugin pages) scrolls inside the main column only. Content scroll position SHALL NOT move the sidebar.
- The document body SHALL NOT introduce a vertical scrollbar on any `/settings/*` route at viewport widths ≥ 768 px: `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (allowing subpixel rounding), and the sticky header SHALL never scroll out of view.

At viewport widths ≤ 767 px (mobile) the mobile drawer rules in "Settings sidebar collapses to an overlay drawer on mobile" continue to apply unchanged. The mobile content area MAY scroll either inside `.settings-content` or as the document body (current behavior is unchanged); the desktop independent-scroll guarantee above does NOT apply on mobile.

#### Scenario: Long sidebar scrolls within the aside on desktop

- **GIVEN** the user is on a `/settings/*` route at 1280 × 720 viewport with so many plugin/developer-tools tabs registered that the sidebar's natural content height exceeds the viewport
- **WHEN** the user scrolls inside `#settings-drawer`
- **THEN** the aside's internal scroll position SHALL advance, the `<main class="settings-content">` element's `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain fully visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Long routed content scrolls within the main on desktop

- **GIVEN** the user is on `/settings/lore` at 1280 × 720 viewport with a lore list whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `.settings-content`
- **THEN** the main's internal scroll position SHALL advance, `#settings-drawer` element's `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain fully visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Document body does not scroll on any settings route at desktop widths

- **WHEN** the user navigates to any `/settings/*` route at a viewport ≥ 768 px (audited at 1280 × 720 and 768 × 1024)
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (no body-level vertical scrollbar), regardless of how tall the sidebar or content's natural heights are

#### Scenario: Computed styles enforce the scroll containers

- **WHEN** the user is on a `/settings/*` route at a viewport ≥ 768 px
- **THEN** `getComputedStyle(.settings-layout).height` SHALL equal the viewport height (within 1 px), `getComputedStyle(.settings-body)` SHALL include `min-height: 0px` and `overflow: hidden`, `getComputedStyle(#settings-drawer)` SHALL include `min-height: 0px` and `overflow-y: auto`, and `getComputedStyle(.settings-content)` SHALL include `min-height: 0px` and `overflow-y: auto`

#### Scenario: Mobile behavior unaffected

- **WHEN** the user is on a `/settings/*` route at a viewport ≤ 767 px
- **THEN** the desktop-only independent-scroll guarantee SHALL NOT be required, the mobile drawer SHALL render per "Settings sidebar collapses to an overlay drawer on mobile", and the mobile content scroll behavior SHALL remain whatever it was before this change (no regression on mobile)

### Requirement: Theme settings tab

The settings area SHALL include a new tab registered as a child route of `/settings` at path `theme` (resolving to `/settings/theme`) with `meta.title` set to a Traditional Chinese label `主題`. The route SHALL lazy-load a new `ThemeSettingsPage.vue` component. The page SHALL render a `<select>` populated from `GET /api/themes` and SHALL bind change events to `useTheme().selectTheme(id)`, which persists the selection to `localStorage` and applies the new theme to `document.documentElement`. All user-facing text SHALL be in Traditional Chinese (zh-TW) to match the rest of the frontend.

#### Scenario: Sidebar exposes the theme tab via route config
- **WHEN** the `/settings/theme` child route is registered with `meta.title: '主題'`
- **THEN** the existing settings sidebar SHALL render a tab labelled `主題` linking to `/settings/theme` without any sidebar-component code change (per the existing "Extensible tab registration" requirement)

#### Scenario: Theme dropdown lists all themes from the backend
- **GIVEN** `GET /api/themes` returns `[{"id":"default","label":"浮心夜夢"},{"id":"light","label":"日光"},{"id":"dark","label":"暗夜"}]`
- **WHEN** the user navigates to `/settings/theme`
- **THEN** the page SHALL render a `<select>` containing exactly those three options with the labels shown to the user

#### Scenario: Selecting a theme applies it and persists the choice
- **GIVEN** the user is on `/settings/theme`
- **WHEN** the user changes the selection from `default` to `light`
- **THEN** `document.documentElement.style.getPropertyValue("--text-main")` SHALL update to the `light` theme's value, AND `localStorage.getItem("heartReverie.themeId")` SHALL equal `"light"`

### Requirement: Dynamic plugin settings tabs

The settings page sidebar SHALL dynamically discover plugins that declare `settingsSchema` via the `/api/plugins` endpoint (checking `hasSettings: true`). For each such plugin, the sidebar SHALL render a navigation link whose **visible link text** is the plugin's `displayName` field from the `/api/plugins` response (the manifest's human-readable zh-TW label), and whose **route target** is `/settings/plugins/:name` where `:name` is the plugin slug (the `name` field, used unchanged as URL parameter, Vue `:key`, and settings-storage key). The settings router SHALL register a wildcard child route at `plugins/:name` that lazy-loads a generic `PluginSettingsPage.vue` component.

`reader-src/src/components/SettingsLayout.vue` SHALL construct each `PluginTab` view-model by reading `displayName` from the `/api/plugins` payload and assigning it to the tab's `label` field. The component SHALL NOT fall back to `name` if `displayName` is missing or empty — the backend's manifest loader already rejects such plugins, so `displayName` is guaranteed to be a non-empty string in any record returned by `/api/plugins`.

#### Scenario: Plugin with settings appears in sidebar with zh-TW label

- **WHEN** the user navigates to any `/settings/*` route and a loaded plugin (e.g. `chapter-bookmark`) declares `settingsSchema` and a manifest `displayName` of `"章節書籤"`
- **THEN** the sidebar SHALL display a `<router-link>` under the "插件" section whose visible text is `章節書籤`
- **AND** the link's `:to` SHALL resolve to `/settings/plugins/chapter-bookmark` (using the plugin slug `name`, not `displayName`)
- **AND** the link's Vue `:key` SHALL be the slug `name`

#### Scenario: Plugin slug is preserved in route param

- **WHEN** the user clicks a plugin's sidebar link
- **THEN** the destination route SHALL be `/settings/plugins/<slug>` where `<slug>` is the plugin's `name` field
- **AND** bookmarked or shared URLs of the form `/settings/plugins/<slug>` SHALL continue to resolve correctly regardless of any change to that plugin's `displayName`

#### Scenario: Plugin settings page renders schema-driven form

- **WHEN** the user navigates to `/settings/plugins/sd-webui-image-gen`
- **THEN** the page SHALL fetch the plugin's settings schema and current values, and render form inputs matching the schema types (text for string, number input for integer/number, select for enum, checkbox for boolean)

#### Scenario: Settings saved via form submission

- **WHEN** the user modifies a field and clicks save on the plugin settings page
- **THEN** the page SHALL PUT the updated values to `/api/plugins/:name/settings` and display a success notification

#### Scenario: Dynamic dropdown options from x-options-url

- **WHEN** a schema field declares `x-options-url: "/api/plugins/sd-webui-image-gen/proxy/sd-models"`
- **THEN** the settings form SHALL fetch that URL and render the response as dropdown `<option>` elements for that field

### Requirement: Plugin settings page renders zh-TW displayName in heading and save notification

`reader-src/src/components/PluginSettingsPage.vue` SHALL render the page-title heading and the save-success notification body using the current plugin's `displayName` (the zh-TW manifest label), not the slug. The route param (`pluginName`), the `/api/plugins/:name/...` API URLs, the settings-storage key, and the `name` field emitted on the `plugin:settingsSaved` event SHALL continue to use the slug unchanged — only the user-visible strings are switched to `displayName`.

The page SHALL obtain `displayName` by reading the `/api/plugins` payload (the same source `SettingsLayout.vue` uses) and matching on the slug from the route param. While the page is still loading the plugin list, the heading MAY transiently display the slug or an empty placeholder, but once the lookup resolves it SHALL be replaced with the `displayName`. Because the loader guarantees every loaded plugin has a non-empty `displayName`, and because the route only resolves for plugins that exist in `/api/plugins`, no fallback-to-slug path is required for the steady state.

#### Scenario: Plugin settings page heading renders displayName

- **WHEN** the user navigates to `/settings/plugins/dialogue-colorize` and the plugin's manifest declares `displayName: "對話著色"`
- **THEN** the page SHALL render `<h2 class="page-title">對話著色 設定</h2>`
- **AND** the heading SHALL NOT contain the slug `dialogue-colorize`

#### Scenario: Save notification uses displayName

- **WHEN** the user saves changes on the plugin settings page for `dialogue-colorize` (with `displayName: "對話著色"`) and the PUT request succeeds
- **THEN** the success toast body SHALL include `對話著色` (the `displayName`)
- **AND** the toast body SHALL NOT include the slug `dialogue-colorize`

#### Scenario: API URLs and route param continue to use the slug

- **WHEN** the user is on `/settings/plugins/dialogue-colorize` and the page issues fetches for schema, settings, schema-meta, and validation, or PUTs the save request
- **THEN** every request URL SHALL be of the form `/api/plugins/dialogue-colorize/...` (the slug `name`, unchanged)
- **AND** the `plugin:settingsSaved` event emitted after a successful save SHALL carry `name: "dialogue-colorize"` (the slug, not the `displayName`)
- **AND** route resolution, browser history, and shared/bookmarked URLs SHALL be unaffected by any change to that plugin's `displayName`
