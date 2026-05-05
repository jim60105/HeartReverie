# Settings Page

## ADDED Requirements

### Requirement: Theme settings tab

The settings area SHALL include a new tab registered as a child route of `/settings` at path `theme` (resolving to `/settings/theme`) with `meta.title` set to a Traditional Chinese label `主題`. The route SHALL lazy-load a new `ThemeSettingsPage.vue` component. The page SHALL render a `<select>` populated from `GET /api/themes` and SHALL bind change events to `useTheme().selectTheme(id)`, which persists the selection to `localStorage` and applies the new theme to `document.documentElement`. All user-facing text SHALL be in Traditional Chinese (zh-TW) to match the rest of the frontend.

#### Scenario: Sidebar exposes the theme tab via route config
- **WHEN** the `/settings/theme` child route is registered with `meta.title: '主題'`
- **THEN** the existing settings sidebar SHALL render a tab labelled `主題` linking to `/settings/theme` without any sidebar-component code change (per the existing "Extensible tab registration" requirement)

#### Scenario: Theme dropdown lists all themes from the backend
- **GIVEN** `GET /api/themes` returns `[{"id":"default","label":"心夢預設"},{"id":"light","label":"日光"},{"id":"dark","label":"暗夜"}]`
- **WHEN** the user navigates to `/settings/theme`
- **THEN** the page SHALL render a `<select>` containing exactly those three options with the labels shown to the user

#### Scenario: Selecting a theme applies it and persists the choice
- **GIVEN** the user is on `/settings/theme`
- **WHEN** the user changes the selection from `default` to `light`
- **THEN** `document.documentElement.style.getPropertyValue("--text-main")` SHALL update to the `light` theme's value, AND `localStorage.getItem("heartReverie.themeId")` SHALL equal `"light"`
