# Page Layout

## Purpose

Defines the overall page structure, grid layout, header/navigation sizing, colour theme variables, and text styling for the story reader interface.

## Requirements

### Requirement: Content area and sidebar responsive layout

The `ContentArea.vue` component SHALL render the chapter content and provide a sidebar region for plugin-relocated elements. The sidebar placement mechanism SHALL use a generic `.plugin-sidebar` CSS class convention: `ContentArea.vue` SHALL use a `watchPostEffect` to query all elements matching `.plugin-sidebar` within the content wrapper and relocate them to the sidebar DOM node via `appendChild`. This imperative DOM relocation is appropriate because plugin-rendered HTML arrives as raw strings via `v-html` — Vue's `<Teleport>` directive cannot be used for plugin content since it is not a Vue component. On mobile viewports (below 768px), CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout, causing it to flow below the chapter content. No plugin-specific class names (such as `.status-float`) SHALL be hardcoded in the main project's component code.

In addition to the sidebar relocation mechanism, `MainLayout.vue` SHALL provide a `<div id="plugin-panel-slot">` element as a shared mount point for plugin floating panels (see the `plugin-panel-slot` capability for full requirements). This container occupies a z-index tier (100) between content/sidebar layers (10–20) and modal layers (1000+).

#### Scenario: Plugin elements relocated to sidebar on desktop
- **WHEN** plugin-rendered HTML contains an element with the `.plugin-sidebar` class and the viewport is 768px or wider
- **THEN** `ContentArea.vue`'s `watchPostEffect` SHALL relocate the element to the sidebar DOM node

#### Scenario: Sidebar flows below content on mobile
- **WHEN** plugin-rendered HTML contains an element with the `.plugin-sidebar` class and the viewport is below 768px
- **THEN** the element SHALL still be relocated to the sidebar DOM node, but CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout so it flows below the chapter content

#### Scenario: Generic class name used for relocation
- **WHEN** inspecting `ContentArea.vue` source for sidebar relocation logic
- **THEN** the querySelector SHALL use `.plugin-sidebar` — no plugin-specific class names SHALL be hardcoded

#### Scenario: Multiple plugins use sidebar placement
- **WHEN** two different plugins produce HTML elements with the `.plugin-sidebar` class
- **THEN** `ContentArea.vue` SHALL relocate both elements to the sidebar in document order

#### Scenario: Plugin panel slot available alongside sidebar
- **WHEN** `MainLayout` is rendered
- **THEN** `#plugin-panel-slot` SHALL be present in the DOM as a sibling of the `<main>` content area
- **AND** plugins MAY use either `.plugin-sidebar` (for sidebar-docked panels) or `#plugin-panel-slot` (for floating panels) depending on their UI needs

### Requirement: Sidebar transient hide during LLM streaming

The `Sidebar.vue` host component (`<aside class="sidebar">`) SHALL be visually suppressed for the entire duration of an active LLM streaming request, identified by `useChatApi().isLoading === true`. The suppression SHALL be implemented as a CSS class toggle on the existing `<aside>` element — the element SHALL remain mounted in the DOM and its children (plugin-relocated `.plugin-sidebar` panels, slot content) SHALL NOT be unmounted, recreated, or reordered as a side effect of the toggle.

This requirement defines a **visual-only** mitigation. The relocation `watchPostEffect` in `ContentArea.vue` MAY still re-run during streaming and MAY still mutate `<aside>`'s subtree; that work is hidden from the reader but not avoided. Deferring or batching such relocation work is explicitly out of scope.

This requirement assumes a **single-flight LLM request** model — i.e., that the project does not start a second LLM request while the first is still streaming. If concurrent requests are introduced later, `isLoading`'s boolean semantics SHALL be revisited (e.g., refcounting) so the sidebar does not reappear before all streams have settled; that revision is out of scope for this change.

When `isLoading === true`, the `<aside>` SHALL receive a class (e.g., `.sidebar--hidden-during-stream`) whose CSS rules:

- On desktop (≥ 768 px): apply `visibility: hidden`, `opacity: 0`, and `pointer-events: none`. The `<aside>`'s layout box SHALL remain so the chapter column does not shift horizontally during streaming.
- On mobile (< 768 px): apply `display: none` so the empty vertical slot collapses (avoiding a blank gap below the chapter content).

When `isLoading` returns to `false` — whether by stream completion, server error, network failure, user abort, or cancel — the class SHALL be removed within the same render frame and the sidebar SHALL be visible again immediately. No animation or debounce delay SHALL be introduced.

The hidden state SHALL be derived purely from the in-memory `useChatApi().isLoading` ref. The implementation SHALL NOT persist any "sidebar hidden" flag to `localStorage`, `sessionStorage`, IndexedDB, cookies, the URL query string, or any other persistent store. After a full page reload (the user agent reloads the document and the JS bundle is freshly evaluated), the sidebar SHALL start visible regardless of any prior streaming session — `isLoading` re-initialises to `false`.

The hide rule SHALL only suppress the `<aside class="sidebar">` element. The streaming preview area, the chapter content, the header, the chat input, and any other UI SHALL be unaffected. The sidebar's children (relocated `.plugin-sidebar` panels) inherit the suppression transitively because they are descendants of `<aside>`; plugin polling timers, fetches, and event listeners SHALL continue running unaffected.

#### Scenario: Sidebar hides while streaming on desktop

- **WHEN** the user submits a chat message on a viewport ≥ 768 px and `useChatApi().isLoading` becomes `true`
- **THEN** the `<aside class="sidebar">` element SHALL receive the hidden-during-stream class
- **AND** its computed `visibility` SHALL be `hidden` and `opacity` SHALL be `0`
- **AND** the chapter column's horizontal width SHALL NOT change

#### Scenario: Sidebar hides while streaming on mobile

- **WHEN** the user submits a chat message on a viewport < 768 px and `useChatApi().isLoading` becomes `true`
- **THEN** the `<aside class="sidebar">` element SHALL receive the hidden-during-stream class
- **AND** its computed `display` SHALL be `none` so the vertical slot collapses
- **AND** the chapter content immediately above SHALL NOT be visually pushed down by an empty gap

#### Scenario: Sidebar reappears on stream completion

- **WHEN** an LLM stream completes successfully and `isLoading` flips to `false`
- **THEN** the hidden-during-stream class SHALL be removed from `<aside>` within the same render frame
- **AND** the sidebar SHALL be visible (`visibility: visible` on desktop, normal `display` on mobile)

#### Scenario: Sidebar reappears on stream abort

- **WHEN** the user clicks the abort/cancel control during streaming and `isLoading` flips to `false` (this typically happens when the server acknowledges the abort, not necessarily on the client click itself)
- **THEN** the hidden-during-stream class SHALL be removed
- **AND** the sidebar SHALL be visible immediately upon the `isLoading → false` transition

#### Scenario: Sidebar reappears on stream error

- **WHEN** the streaming request errors out (network failure, server 5xx, decode error) and `isLoading` flips to `false`
- **THEN** the hidden-during-stream class SHALL be removed
- **AND** the sidebar SHALL be visible immediately

#### Scenario: DOM stays mounted across hide/show cycles

- **WHEN** `isLoading` toggles from `false` → `true` → `false` while plugin `.plugin-sidebar` panels are present in `<aside>`
- **THEN** those `.plugin-sidebar` elements SHALL retain their identity (same DOM nodes, same event listeners, same internal state)
- **AND** `ContentArea.vue`'s relocation `watchPostEffect` SHALL NOT need to re-run as a result of the toggle

#### Scenario: Sidebar starts visible on fresh page load

- **WHEN** the user reloads the page (or otherwise causes the JS bundle to be freshly evaluated) and no chat activity has occurred yet
- **THEN** `<aside class="sidebar">` SHALL NOT carry the hidden-during-stream class
- **AND** the sidebar SHALL be fully visible

#### Scenario: Hidden state is not persisted

- **WHEN** the sidebar is in the hidden-during-stream state and the user reloads the page
- **THEN** after reload, `<aside class="sidebar">` SHALL be visible (no hidden class)
- **AND** no key matching the hidden-state name SHALL be present in `localStorage`, `sessionStorage`, IndexedDB, cookies, or the URL query string

#### Scenario: Other UI surfaces unaffected

- **WHEN** `isLoading === true` and the sidebar is hidden
- **THEN** the streaming preview area inside `ChatInput.vue` SHALL still render visibly
- **AND** the header, chapter content, and chat input controls SHALL be unaffected by the hide rule
- **AND** on desktop (≥ 768 px) the page body's scroll position SHALL NOT change as a result of the toggle (the layout box is preserved). On mobile (< 768 px) the page MAY shorten because the sidebar's vertical slot collapses; in that case the browser's native scroll-anchoring behaviour SHALL be relied upon.

#### Scenario: Plugin polling continues while sidebar is hidden

- **WHEN** `isLoading === true` and the sidebar is hidden, and a plugin (e.g., `sd-webui-image-gen`) has an active polling timer for image metadata
- **THEN** the polling timer SHALL continue firing on schedule
- **AND** any fetch the timer triggers SHALL proceed normally
- **AND** when the sidebar reappears at stream end, it SHALL display the most recently polled state

#### Scenario: Hidden sidebar does not capture clicks

- **WHEN** `isLoading === true` and the user clicks at a screen position that would normally hit the sidebar (e.g., on a pre-stream visible thumbnail)
- **THEN** the click event SHALL NOT be received by the sidebar or its children (`pointer-events: none` on desktop; the element does not exist in the layout on mobile)
- **AND** the click SHALL fall through to whichever element is now at that position (or be a no-op over the backdrop)

### Requirement: Compact header sizing

The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area. The header SHALL contain the story selector toggle, the folder-name display, the reload button (when chapters are loaded), the tools-menu button, the settings button, and the chapter-navigation cluster. The chapter-navigation cluster SHALL contain, in this fixed left-to-right order, the first-chapter jump button (`⇇`), the previous-chapter button (`← 上一章`), the chapter progress indicator (e.g., `3 / 11`), the next-chapter button (`下一章 →`), and the last-chapter jump button (`⇉`). The cluster SHALL be hidden until a story is loaded.

The tools-menu button (`🧰`) SHALL be rendered immediately adjacent to the settings button (`⚙️`) and SHALL share the same `header-btn header-btn--icon` class set as the settings button. Clicking the tools button SHALL toggle a dropdown panel rendered as a descendant of the `<header>` element (NOT via `<Teleport>`) so that the panel inherits the header's sticky stacking context and z-index. The contents of the dropdown are specified by the `tools-menu` capability.

The header SHALL NOT render a mobile hamburger button. Any such legacy `☰` control and its associated `mobileMenuOpen` state SHALL be removed from the component; future mobile-drawer functionality, if introduced, SHALL be specified in a separate change rather than carried as dead code.

At a viewport width of 767 px or less, the header SHALL adapt to a single-row layout via CSS media queries:

- The `.folder-name` breadcrumb (e.g. `<series> / <story>`) SHALL NOT be visible. Series and story name remain reachable through the `📖` story-selector dropdown.
- The first-chapter jump button (`⇇`) and the last-chapter jump button (`⇉`) SHALL NOT be visible or focusable, and SHALL NOT be exposed to assistive tech. They SHALL become visible and reachable again when the viewport widens to 768 px or above without requiring a Vue remount of the header component.
- The `← 上一章`, the `i / N` progress indicator, and `下一章 →` SHALL remain visible at all viewport widths once a story is loaded.
- The `📖` story-selector toggle, the `🔄` reload button, the `🧰` tools-menu button, and the `⚙️` settings button SHALL remain visible at all viewport widths.
- The header row SHALL NOT wrap onto multiple lines and the visible content SHALL fit within the row width without horizontal overflow at any viewport width in the audited mobile range (360 px to 767 px) at default user-agent text scaling. Behavior at viewport widths below 360 px or under non-default text scaling (e.g. browser-level zoom or user-set base font size of 200 % or more) is not guaranteed by this requirement; if a future regression report identifies an overflow at those widths, a follow-up change SHALL extend coverage rather than silently re-introducing wrap.

The mobile media-query breakpoint (`@media (max-width: 767px)`) SHALL be the same value used by `ContentArea.vue`'s grid-collapse rule so that header collapse and content single-column collapse trigger together.

#### Scenario: Compact header padding

- **WHEN** the application is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-2 py-1` padding for a minimal-height header bar

#### Scenario: Header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport ≥ 768 px
- **THEN** the header SHALL display the story selector toggle, folder name, reload button, tools-menu button, settings button, and the chapter-navigation cluster (`⇇` `← 上一章` `i / N` `下一章 →` `⇉`) in a single unified bar

#### Scenario: Mobile header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport in the audited mobile range (360 px to 767 px) at default user-agent text scaling
- **THEN** the header SHALL display only the story selector toggle (`📖`), the reload button (`🔄`), the tools-menu button (`🧰`), the settings button (`⚙️`), and the reduced chapter-navigation cluster (`← 上一章` `i / N` `下一章 →`) in a single row without wrapping or horizontal overflow, and the folder-name breadcrumb, the `⇇` button, and the `⇉` button SHALL NOT be visible or focusable

#### Scenario: Mobile breakpoint matches content-area breakpoint

- **WHEN** inspecting the header's mobile-collapse media query and `ContentArea.vue`'s grid-collapse media query
- **THEN** both SHALL use `@media (max-width: 767px)` (identical breakpoint), so resizing past 768 px collapses or restores both elements simultaneously

#### Scenario: Resize from mobile to desktop restores hidden controls without remount

- **WHEN** the viewport is resized from 443 px (or any mobile width) to 1280 px (or any desktop width) within the same page session
- **THEN** the breadcrumb, the `⇇` button, and the `⇉` button SHALL become visible again, and the transition SHALL NOT require remounting the `AppHeader` component (i.e. component-local state such as the StorySelector's open / closed state SHALL be preserved across the transition)

#### Scenario: Navigation cluster hidden before story load

- **WHEN** no story has been loaded yet
- **THEN** the entire chapter-navigation cluster — first-chapter button, previous button, progress indicator, next button, last-chapter button — SHALL be hidden via Vue directive (`v-if`), and only the story selector, reload button, tools-menu button, and settings button SHALL remain visible

#### Scenario: No hamburger button in header

- **WHEN** the application is rendered in any state, at any viewport width
- **THEN** the header SHALL NOT render a `☰` hamburger button, and the component SHALL NOT declare an unused `mobileMenuOpen` reactive state ref

#### Scenario: Tools button placement

- **WHEN** the application is rendered with a loaded story on a desktop viewport
- **THEN** the `🧰` tools-menu button SHALL appear in the header immediately adjacent to the `⚙️` settings button (no other interactive control between them)

#### Scenario: Tools dropdown is a descendant of header

- **WHEN** the user opens the tools dropdown by clicking `🧰`
- **THEN** the rendered dropdown panel SHALL be a descendant element of the `<header>` element, NOT a direct child of `<body>` (no `<Teleport>` is used)

### Requirement: Prompt-editor toolbar narrow-viewport wrap

The prompt-editor settings page (`/settings/prompt-editor`) SHALL render its toolbar action cluster (the buttons that perform `＋ 新增訊息`, `↻ 回復預設`, `儲存`, and `預覽 Prompt`) so that, when the available container width is narrower than the cluster's natural one-line width, the cluster wraps onto multiple rows aligned to the trailing edge rather than overflowing horizontally past the viewport. Specifically, the `.toolbar-actions` flex container SHALL declare `flex-wrap: wrap` and SHALL NOT pin its width via `flex-shrink: 0`; remaining items SHALL be right-aligned via `justify-content: flex-end` so that on a narrow viewport the rightmost button (`預覽 Prompt`) lands flush with the trailing edge of the toolbar instead of dropping under the leftmost button.

#### Scenario: Toolbar action cluster wraps without overflow at narrow viewport

- **WHEN** the prompt-editor page is rendered in a viewport whose width is narrower than the action cluster's natural one-line width (audited at 360 px and 375 px)
- **THEN** the action cluster SHALL wrap onto two or more rows within the editor pane, every button SHALL remain fully inside the viewport (`getBoundingClientRect().right ≤ window.innerWidth`), and the document SHALL NOT introduce horizontal page overflow (`document.body.scrollWidth === window.innerWidth`)

#### Scenario: Toolbar action cluster fits on one row on wider viewports

- **WHEN** the prompt-editor page is rendered in a viewport whose width is at least the action cluster's natural one-line width (audited at 390 px, 443 px, and 1280 px)
- **THEN** the action cluster SHALL render on a single row right-aligned within the toolbar with no wrap

### Requirement: Colour variable merge for love theme

The CSS custom properties SHALL be defined in the shared theme file with the following colour values for the love theme:
- `--text-main` SHALL be `rgba(207, 207, 197, 1)`
- `--text-italic` SHALL be `rgba(145, 145, 145, 1)`
- `--text-underline` SHALL be `rgba(145, 145, 145, 1)`
- `--text-quote` SHALL be `rgba(198, 193, 151, 1)`
- `--shadow-color` SHALL be `rgba(0, 0, 0, 0.9)`
- `--shadow-width` SHALL be `2px`
- `--border-outer` SHALL be `rgba(0, 0, 0, 1)`

#### Scenario: Updated main text colour is applied
- **WHEN** the page is rendered with the love theme
- **THEN** the `--text-main` CSS custom property SHALL resolve to `rgba(207, 207, 197, 1)`

#### Scenario: Theme variables defined in shared file not inline
- **WHEN** the theme variables are inspected
- **THEN** all `--text-*`, `--shadow-*`, `--border-*`, and `--font-*` custom properties SHALL be defined in the shared theme CSS file, not in inline `<style>` blocks or component-scoped styles

### Requirement: Custom font stacks

The shared theme file SHALL define two CSS custom properties for font families:
- `--font-system-ui` SHALL be a CJK-optimised sans-serif stack: `Noto Sans TC, Noto Sans JP, Noto Sans SC, Noto Sans, Noto Color Emoji, Microsoft JhengHei, Heiti TC, system-ui, sans-serif`
- `--font-antique` SHALL be an antique/serif stack featuring the Iansui web font: `Iansui, Superclarendon, "Bookman Old Style", "URW Bookman", "URW Bookman L", "Georgia Pro", Georgia, serif`

The Iansui font and Noto Sans families SHALL be loaded via Google Fonts `<link rel="stylesheet">` in the `index.html` `<head>`, preceded by `<link rel="preconnect">` hints for `fonts.googleapis.com` and `fonts.gstatic.com`.

#### Scenario: Body text uses system-ui font stack
- **WHEN** the page is rendered
- **THEN** the `body` element's `font-family` SHALL resolve to the `--font-system-ui` custom property value

#### Scenario: Font definitions in theme file
- **WHEN** the `--font-system-ui` and `--font-antique` custom properties are inspected
- **THEN** they SHALL be defined in the shared theme CSS file alongside other theme variables

### Requirement: Content area padding
The `#content` element SHALL have horizontal padding so that prose text has breathing room within the grid column and does not sit flush against the container edges.

#### Scenario: Content has horizontal padding
- **WHEN** the story content is rendered inside `#content`
- **THEN** the content area SHALL have horizontal padding applied (e.g., `padding: 0 1rem`)

### Requirement: Body background colour preserved
The `body` element's `background-color` SHALL remain `#0f0a0c` (original love theme) as a fallback. When a background image is configured (via the `frontend-background` capability), the background colour SHALL serve as the fallback beneath the image and overlay layers. The colour merge only affects text and tint variables, not the page background base colour.

#### Scenario: Body background unchanged
- **WHEN** the page is rendered
- **THEN** the body background-color SHALL be `#0f0a0c`

#### Scenario: Background colour visible as fallback under image
- **WHEN** the page is rendered with a configured background image that fails to load
- **THEN** the `#0f0a0c` background colour SHALL remain visible as the fallback

### Requirement: Prose text-shadow
Paragraph text in the prose content area SHALL have a `text-shadow` using `--shadow-width` and `--shadow-color` to improve legibility against the background.

#### Scenario: Prose paragraphs have text-shadow
- **WHEN** paragraph text is rendered inside `#content`
- **THEN** the paragraphs SHALL have `text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color)` applied

### Requirement: Hidden sidebar scrollbar
The `#sidebar` element SHALL hide its scrollbar while remaining scrollable, using `scrollbar-width: none` for standards-compliant browsers and `::-webkit-scrollbar { display: none }` for WebKit-based browsers. The sidebar content SHALL remain fully accessible via scroll gestures or mouse wheel.

#### Scenario: Sidebar scrollbar is visually hidden
- **WHEN** the sidebar content exceeds the visible viewport height on desktop
- **THEN** the `#sidebar` element SHALL not display a visible scrollbar, but the user SHALL still be able to scroll through the sidebar content using scroll gestures, mouse wheel, or keyboard navigation

### Requirement: Option button styling
Each option button SHALL be visually styled as a clickable button with clear borders, padding, and readable text. The option number SHALL be displayed alongside or within the button. The buttons SHALL have hover and active visual states defined entirely in CSS using `:hover` and `:active` pseudo-classes. No inline `onmouseover` or `onmouseout` event handlers SHALL be used.

#### Scenario: Buttons have interactive states via CSS
- **WHEN** the user hovers over an option button
- **THEN** the button SHALL visually indicate it is interactive (e.g., change background color or border) using CSS `:hover` rules, not inline JavaScript event handlers

#### Scenario: No inline hover handlers in HTML
- **WHEN** the page HTML is rendered
- **THEN** no elements SHALL contain `onmouseover` or `onmouseout` attributes

### Requirement: No global bridge functions

The page layout and application wiring SHALL NOT register global functions on the `window` object for inter-module communication (e.g., `window.__appendToInput`). Module communication SHALL use Vue's component event system (`emit`/`props`), `provide`/`inject`, or composable shared state instead of direct ES module imports of DOM-manipulating functions. This eliminates global namespace pollution and enables strict CSP.

#### Scenario: window.__appendToInput is removed
- **WHEN** the application initializes
- **THEN** `window.__appendToInput` SHALL NOT be defined on the global `window` object

#### Scenario: Options panel communicates via Vue events
- **WHEN** the options panel needs to append text to the chat input
- **THEN** it SHALL emit a Vue event or use a shared composable to communicate with the chat input component instead of calling a global bridge function or directly importing a DOM-manipulating module function

### Requirement: CSS hover states for interactive elements

All interactive elements (option buttons, navigation controls, folder picker) SHALL define their hover, focus, and active visual states using CSS pseudo-classes (`:hover`, `:focus`, `:active`) in component-scoped `<style scoped>` blocks or the shared theme file. No inline event handlers (`onmouseover`, `onmouseout`, `onfocus`, `onblur`) SHALL be used for visual state changes anywhere in the page.

#### Scenario: All hover effects use CSS
- **WHEN** the page is rendered with interactive elements
- **THEN** all hover visual effects SHALL be defined in component-scoped `<style scoped>` blocks or shared CSS using pseudo-classes, and no inline event handler attributes for visual state changes SHALL exist in the HTML

#### Scenario: CSP compatibility
- **WHEN** a strict Content Security Policy is active that blocks inline scripts
- **THEN** all interactive visual states SHALL continue to function because they are CSS-based, not JavaScript-based

### Requirement: CSS architecture decomposition

The ~700 lines of inline CSS previously embedded in `index.html` `<style>` blocks SHALL be decomposed into three layers:

1. **Theme variables file** — A shared CSS file (e.g., `theme.css`) containing all CSS custom properties (`--text-main`, `--text-italic`, `--font-system-ui`, etc.) and base colour definitions for the love theme. This file SHALL also define settings-specific CSS custom properties: `--settings-sidebar-width` (approximately `200px`), `--settings-sidebar-bg` (sidebar background colour), `--settings-sidebar-active-bg` (active tab background highlight colour), `--settings-sidebar-active-border` (active tab left-border accent colour), and `--settings-content-padding` (content area padding).
2. **Base/reset styles** — Global typography, body background, font-face loading, and reset rules in a shared stylesheet
3. **Component-scoped styles** — Layout-specific styles (grid, header, sidebar, content area, settings layout) defined within Vue SFC `<style scoped>` blocks

The `index.html` file SHALL be reduced to a minimal Vue mount point with no inline `<style>` blocks containing layout or theme rules. All visual appearance SHALL be preserved identically after decomposition.

The `SettingsLayout.vue` component SHALL define its layout styles in a `<style scoped>` block, using the settings CSS custom properties from the theme file. The settings layout SHALL use CSS Grid or Flexbox with the sidebar at `var(--settings-sidebar-width)` and the content area filling the remaining space. The active tab in the sidebar SHALL be indicated by a left-border accent (`var(--settings-sidebar-active-border)`) and a highlighted background (`var(--settings-sidebar-active-bg)`).

#### Scenario: Theme variables in shared file
- **WHEN** the application is built
- **THEN** a shared theme CSS file SHALL define all CSS custom properties (`--text-main`, `--text-italic`, `--text-underline`, `--text-quote`, `--shadow-color`, `--shadow-width`, `--border-outer`, `--font-system-ui`, `--font-antique`, `--settings-sidebar-width`, `--settings-sidebar-bg`, `--settings-sidebar-active-bg`, `--settings-sidebar-active-border`, `--settings-content-padding`) and the values SHALL match the existing love theme values exactly for reader variables, with new settings variables using theme-consistent colours

#### Scenario: No inline styles in index.html
- **WHEN** the `index.html` file is inspected
- **THEN** it SHALL contain no `<style>` blocks with layout, theme, or component styling — only a Vue mount point (`<div id="app">`) and necessary `<link>`/`<script>` tags for the Vite bundle

#### Scenario: Component-scoped styles in SFCs
- **WHEN** a Vue SFC (e.g., `AppHeader.vue`, `Sidebar.vue`, `SettingsLayout.vue`) defines layout styles
- **THEN** those styles SHALL be in a `<style scoped>` block within the SFC, not in a global stylesheet

#### Scenario: Settings layout uses CSS custom properties
- **WHEN** the `SettingsLayout.vue` component is rendered
- **THEN** the sidebar width SHALL reference `var(--settings-sidebar-width)`, the active tab SHALL use `var(--settings-sidebar-active-bg)` and `var(--settings-sidebar-active-border)`, and the content area padding SHALL use `var(--settings-content-padding)`

#### Scenario: Settings sidebar active tab indicator
- **WHEN** a settings tab is active (matched by Vue Router)
- **THEN** the active tab's `<router-link>` SHALL have a left-border accent and background highlight applied via the `active-class` CSS rules, using the settings CSS custom properties
