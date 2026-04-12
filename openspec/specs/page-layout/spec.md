# Page Layout

## Purpose

Defines the overall page structure, grid layout, header/navigation sizing, colour theme variables, and text styling for the story reader interface.

## Requirements

### Requirement: Content area and sidebar responsive layout

The `ContentArea.vue` component SHALL render the chapter content and provide a sidebar region for plugin-relocated elements. The sidebar placement mechanism SHALL use a generic `.plugin-sidebar` CSS class convention: `ContentArea.vue` SHALL use a `watchPostEffect` to query all elements matching `.plugin-sidebar` within the content wrapper and relocate them to the sidebar DOM node via `appendChild`. This imperative DOM relocation is appropriate because plugin-rendered HTML arrives as raw strings via `v-html` — Vue's `<Teleport>` directive cannot be used for plugin content since it is not a Vue component. On mobile viewports (below 768px), CSS media queries SHALL make the sidebar `position: static` with a single-column grid layout, causing it to flow below the chapter content. No plugin-specific class names (such as `.status-float`) SHALL be hardcoded in the main project's component code.

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
