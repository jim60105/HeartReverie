# Page Layout

## MODIFIED Requirements

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
