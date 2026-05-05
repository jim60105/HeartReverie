# Theme System

## Purpose

Provides a TOML-driven theming capability that lets operators ship multiple visual themes (palette + background image + color-scheme hint) and lets readers pick one through a settings page. The selection is persisted client-side and applied to `document.documentElement` as CSS custom properties, with a small static boot script preventing flash-of-unstyled-content on reload.

## Requirements

### Requirement: Theme directory configuration

The server SHALL read a `THEME_DIR` environment variable. If unset, the value SHALL default to `./themes/`. Relative paths SHALL be resolved against `Deno.cwd()`. The server SHALL discover theme files by scanning this directory non-recursively for files with the `.toml` extension at startup.

#### Scenario: Default theme directory when env var is unset
- **WHEN** the server starts without `THEME_DIR` set
- **THEN** the server SHALL load themes from `./themes/` resolved against the current working directory

#### Scenario: Custom theme directory when env var is set
- **WHEN** the server starts with `THEME_DIR=/etc/heart-reverie/themes` and the directory contains `default.toml`, `light.toml`, `dark.toml`
- **THEN** the server SHALL load all three themes from that directory

#### Scenario: Missing theme directory
- **WHEN** the server starts and `THEME_DIR` points to a nonexistent path
- **THEN** the server SHALL NOT crash; it SHALL log a warning and start with an empty theme index

### Requirement: TOML theme file format

Each theme file SHALL be a valid TOML document with the following top-level structure:

- `id` — non-empty kebab-case string. The value MUST equal the file basename without the `.toml` extension.
- `label` — non-empty human-readable string used as the dropdown label.
- `colorScheme` — optional string, one of `"light"` or `"dark"`. Defaults to `"dark"`.
- `backgroundImage` — optional string. When non-empty, the value MUST be one of:
  - `url('/<same-origin-path>')` — a `url()` wrapper around a single-quoted absolute path beginning with `/` (e.g. `url('/assets/heart.webp')`).
  - `url('data:<…>')` — a `url()` wrapper around a single-quoted `data:` URL (e.g. `url('data:image/png;base64,iVBORw0KGgo')`).
  - A CSS gradient function call: `linear-gradient(...)`, `radial-gradient(...)`, `conic-gradient(...)`, `repeating-linear-gradient(...)`, `repeating-radial-gradient(...)`, or `repeating-conic-gradient(...)`.

  Empty string or missing key SHALL mean "no background image". Any other value (a bare path without the `url()` wrapper, an off-origin URL such as `http(s)://…`, protocol-relative `//…`, relative path, `file://`, an unwrapped `data:` URL, etc.) SHALL be rejected by the loader. The `url()` wrappers MUST use single quotes around the URL contents to match the project's CSP (`img-src 'self' data:`); off-origin values would be silently blocked at paint time.
- `[palette]` — table whose keys are CSS custom-property names **without** the leading `--`, and whose values are strings applied verbatim as the property value.

The server SHALL accept any string value in `[palette]`, including CSS expressions such as `linear-gradient(...)`, `rgba(...)`, `clamp(...)`, and quoted font-family lists; it SHALL NOT validate or transform palette values beyond requiring them to be strings.

#### Scenario: Valid TOML theme file is loaded
- **GIVEN** a file `themes/default.toml` whose contents declare `id = "default"`, `label = "浮心夜夢"`, and a `[palette]` table with at least `panel-bg = "linear-gradient(145deg, #1a0810, #220c16)"`
- **WHEN** the server starts
- **THEN** the theme SHALL appear in the in-memory theme index under id `default`

#### Scenario: id mismatch with filename is rejected
- **GIVEN** a file `themes/default.toml` whose body declares `id = "other"`
- **WHEN** the server starts
- **THEN** the file SHALL be skipped, an error SHALL be logged, and the server SHALL continue starting

#### Scenario: Malformed TOML is skipped without crashing
- **GIVEN** a file `themes/broken.toml` containing invalid TOML syntax
- **WHEN** the server starts
- **THEN** the file SHALL be skipped with an error logged, and other valid theme files SHALL still be loaded

#### Scenario: Non-TOML files are ignored
- **GIVEN** the theme directory contains `default.toml`, `README.md`, and `notes.txt`
- **WHEN** the server scans the directory
- **THEN** only `default.toml` SHALL be parsed; the non-TOML files SHALL be ignored silently

#### Scenario: Off-origin backgroundImage is rejected at parse time
- **GIVEN** a file `themes/external.toml` whose body declares `backgroundImage = "https://example.com/bg.jpg"`
- **WHEN** the server starts
- **THEN** the file SHALL be skipped, the server SHALL log an error naming the file path and the offending value, and the theme SHALL NOT appear in the in-memory index

#### Scenario: Protocol-relative backgroundImage is rejected
- **GIVEN** a file `themes/proto-rel.toml` whose body declares `backgroundImage = "//cdn.example.com/bg.jpg"`
- **WHEN** the server starts
- **THEN** the file SHALL be skipped with an error logged

#### Scenario: Bare same-origin path (without url() wrapper) is rejected
- **GIVEN** a file `themes/bare.toml` whose body declares `backgroundImage = "/assets/heart.webp"`
- **WHEN** the server starts
- **THEN** the file SHALL be skipped with an error logged (the value MUST be wrapped as `url('/assets/heart.webp')`)

#### Scenario: Relative path backgroundImage is rejected
- **GIVEN** a file `themes/relative.toml` whose body declares `backgroundImage = "assets/bg.jpg"`
- **WHEN** the server starts
- **THEN** the file SHALL be skipped with an error logged

#### Scenario: url() with same-origin path is accepted
- **GIVEN** a file `themes/with-path.toml` whose body declares `backgroundImage = "url('/assets/heart.webp')"`
- **WHEN** the server starts
- **THEN** the theme SHALL load successfully and `GET /api/themes/with-path` SHALL return `url('/assets/heart.webp')` verbatim in the `backgroundImage` field

#### Scenario: url() with data: URL is accepted
- **GIVEN** a file `themes/inline.toml` whose body declares `backgroundImage = "url('data:image/png;base64,iVBORw0KGgo')"`
- **WHEN** the server starts
- **THEN** the theme SHALL load successfully and `GET /api/themes/inline` SHALL return the wrapped value verbatim in the `backgroundImage` field

#### Scenario: CSS gradient backgroundImage is accepted
- **GIVEN** a file `themes/gradient.toml` whose body declares `backgroundImage = "linear-gradient(160deg, #F5F0E6 0%, #E8E0D2 100%)"`
- **WHEN** the server starts
- **THEN** the theme SHALL load successfully and `GET /api/themes/gradient` SHALL return the gradient value verbatim in the `backgroundImage` field

#### Scenario: Empty backgroundImage is accepted
- **GIVEN** a file `themes/no-bg.toml` that omits `backgroundImage` (or sets it to `""`)
- **WHEN** the server starts
- **THEN** the theme SHALL load successfully and the response SHALL contain `backgroundImage = ""`

### Requirement: Theme list endpoint

The server SHALL expose `GET /api/themes` returning a JSON array `[{ "id": string, "label": string }, ...]` of every successfully loaded theme. The endpoint SHALL NOT require authentication, parity with `/api/config` historically, so the SPA can render the dropdown before the user enters the passphrase. The order SHALL be deterministic (alphabetical by `id`).

#### Scenario: Lists all loaded themes
- **GIVEN** the server has loaded `default`, `light`, and `dark` themes
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with body `[{"id":"dark","label":"…"},{"id":"default","label":"…"},{"id":"light","label":"…"}]`

#### Scenario: Endpoint is publicly accessible
- **WHEN** a client sends `GET /api/themes` without an `X-Passphrase` header
- **THEN** the server SHALL respond with HTTP 200 (not 401)

#### Scenario: Empty index returns empty array
- **GIVEN** the theme directory is empty
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with body `[]`

### Requirement: Theme detail endpoint

The server SHALL expose `GET /api/themes/:id` returning the parsed theme as JSON: `{ "id": string, "label": string, "colorScheme": string, "backgroundImage": string, "palette": { "--<name>": "<value>", ... } }`. Palette keys SHALL include the leading `--` (the loader prepends it; TOML files store keys without). If the id is unknown, the response SHALL be HTTP 404 with an RFC 9457 Problem Details body. The endpoint SHALL NOT require authentication.

#### Scenario: Returns full theme JSON
- **GIVEN** the `default` theme is loaded with `palette.panel-bg = "linear-gradient(...)"` and `backgroundImage = "url('/assets/heart.webp')"`
- **WHEN** a client sends `GET /api/themes/default`
- **THEN** the response SHALL be HTTP 200 and the JSON body SHALL contain `palette["--panel-bg"] === "linear-gradient(...)"` and `backgroundImage === "url('/assets/heart.webp')"`

#### Scenario: Unknown id returns 404
- **WHEN** a client sends `GET /api/themes/no-such-theme`
- **THEN** the response SHALL be HTTP 404 with an RFC 9457 Problem Details body

#### Scenario: Endpoint is publicly accessible
- **WHEN** a client sends `GET /api/themes/default` without an `X-Passphrase` header
- **THEN** the server SHALL respond with HTTP 200 (not 401)

### Requirement: Built-in themes shipped with the project

The repository SHALL include three theme files under `themes/` at the project root:

- `themes/default.toml` — its `[palette]` table SHALL contain a key for every CSS custom property declared in `reader-src/src/styles/theme.css` and the value of each key SHALL be byte-for-byte identical to that property's value in `theme.css`. Its `backgroundImage` SHALL be `url('/assets/heart.webp')`. Its `id` SHALL be `default`.
- `themes/light.toml` — a light colour scheme (`colorScheme = "light"`) whose `backgroundImage` SHALL be a CSS `linear-gradient(...)` value (paper-tinted warm light gradient). Id `light`.
- `themes/dark.toml` — a neutral dark colour scheme (`colorScheme = "dark"`) whose `backgroundImage` SHALL be a CSS `linear-gradient(...)` value (subtle dark gradient). Id `dark`.

#### Scenario: default.toml reproduces the current palette verbatim
- **WHEN** `themes/default.toml` is parsed and its `palette` is compared to the declarations in `reader-src/src/styles/theme.css`
- **THEN** every CSS custom property in `theme.css` SHALL have a matching key in `palette`, and every value SHALL be string-equal (after trimming surrounding whitespace)

#### Scenario: Three themes ship by default
- **WHEN** the server starts with `THEME_DIR` pointing at the repository's `themes/` directory
- **THEN** the theme index SHALL contain exactly the ids `default`, `light`, and `dark`

### Requirement: Frontend applies CSS variables to :root

The SPA SHALL provide a `useTheme()` composable that, given a parsed theme JSON object, applies every entry in `palette` to `document.documentElement.style` via `setProperty(name, value)` (where `name` includes the leading `--`), sets `color-scheme` if `colorScheme` is present, and sets `document.body.style.backgroundImage` to the `backgroundImage` value verbatim (which is already a valid CSS `background-image` token such as `url('…')` or a gradient function call) when non-empty, or to the literal CSS keyword `none` when empty.

#### Scenario: Palette is applied to documentElement
- **GIVEN** a theme with `palette["--text-main"] = "rgba(207, 207, 197, 1)"`
- **WHEN** `useTheme().applyTheme(theme)` is called
- **THEN** `document.documentElement.style.getPropertyValue("--text-main")` SHALL equal `"rgba(207, 207, 197, 1)"`

#### Scenario: url() backgroundImage is applied to body verbatim
- **GIVEN** a theme with `backgroundImage = "url('/assets/heart.webp')"`
- **WHEN** `useTheme().applyTheme(theme)` is called
- **THEN** `document.body.style.backgroundImage` SHALL be set to that value verbatim (the browser MAY normalise the surrounding quote style)

#### Scenario: Gradient backgroundImage is applied to body verbatim
- **GIVEN** a theme with `backgroundImage = "linear-gradient(160deg, #F5F0E6 0%, #E8E0D2 100%)"`
- **WHEN** `useTheme().applyTheme(theme)` is called
- **THEN** `document.body.style.backgroundImage` SHALL contain the gradient function call

#### Scenario: Empty backgroundImage clears the body image
- **GIVEN** a theme with `backgroundImage = ""`
- **WHEN** `useTheme().applyTheme(theme)` is called
- **THEN** `document.body.style.backgroundImage` SHALL be set to `none` (clearing any previous image)

### Requirement: Theme selection persistence

The frontend SHALL persist the user's selected theme id in `localStorage` under the key `heartReverie.themeId` and SHALL persist the most recently fetched payload of the selected theme under the key `heartReverie.themeCache.<id>` (JSON-stringified). On initial mount, `useTheme` SHALL read `heartReverie.themeId` (defaulting to `"default"`), fetch `GET /api/themes/:id`, apply the result, and refresh the cache. If the fetch returns 404, the SPA SHALL fall back to id `"default"` and clear the stale `themeId`.

#### Scenario: Selection survives reload
- **GIVEN** the user selects the `light` theme via the dropdown
- **WHEN** the page is reloaded
- **THEN** `localStorage.getItem("heartReverie.themeId")` SHALL equal `"light"` and the SPA SHALL fetch and apply the `light` theme on mount

#### Scenario: Stale id falls back to default
- **GIVEN** `localStorage.heartReverie.themeId = "vanished"` and the server has no theme with that id
- **WHEN** the SPA mounts and fetches `/api/themes/vanished`
- **THEN** the response SHALL be 404; the SPA SHALL clear `localStorage.heartReverie.themeId` and apply the `default` theme

### Requirement: FOUC prevention via static boot script

The project SHALL ship a static JavaScript file at `reader-src/public/theme-boot.js` (which Vite copies verbatim to the dist root, served as a same-origin asset at `/theme-boot.js`). The `reader-src/index.html` document SHALL include `<script src="/theme-boot.js"></script>` placed **before** the `<script type="module" src="/src/main.ts">` tag. The boot script SHALL synchronously read `localStorage["heartReverie.themeId"]` and `localStorage["heartReverie.themeCache.<id>"]`, parse the cached JSON, and apply the cached `palette` entries to `document.documentElement.style` plus assign the cached `backgroundImage` value verbatim to `document.body.style.backgroundImage` (or `none` when empty) — deferring the body-style write via a `DOMContentLoaded` listener if `document.body` is not yet present. The script SHALL be wrapped in a try/catch that swallows all errors so a corrupt cache cannot break page load. The script SHALL NOT be inlined into `index.html` because the project's CSP (`script-src 'self'`, no `'unsafe-inline'`, no nonce) refuses inline scripts.

#### Scenario: Cached theme paints with the first frame
- **GIVEN** `localStorage.heartReverie.themeId = "light"` and `localStorage["heartReverie.themeCache.light"]` contains a valid serialised theme
- **WHEN** the page reloads
- **THEN** before the Vue app has mounted, `document.documentElement.style.getPropertyValue("--text-main")` SHALL already reflect the `light` theme value

#### Scenario: Corrupt cache does not break the page
- **GIVEN** `localStorage["heartReverie.themeCache.default"] = "not json"`
- **WHEN** the page loads
- **THEN** the boot script SHALL silently swallow the parse error and the page SHALL still mount normally

#### Scenario: First-ever load with empty localStorage
- **WHEN** the page loads with no theme keys in `localStorage`
- **THEN** the boot script SHALL be a no-op; the stylesheet's `:root { … }` declarations SHALL paint first; once Vue mounts `useTheme` SHALL fetch `default` and apply it (visually identical to the stylesheet defaults)

#### Scenario: Boot script satisfies the CSP
- **WHEN** the page loads with the populated cache and a browser enforcing the existing CSP `script-src 'self'`
- **THEN** the browser SHALL execute `/theme-boot.js` without raising any `Refused to execute inline script` or `Refused to load the script` violation in the console

#### Scenario: Boot script is loaded before the Vite module entry
- **WHEN** the contents of `reader-src/index.html` are inspected
- **THEN** the `<script src="/theme-boot.js">` tag SHALL appear in document source order before the `<script type="module" src="/src/main.ts">` tag

### Requirement: CSS custom property names preserved

The set of CSS custom-property names declared in `theme.css` and emitted by the loader SHALL match exactly the names referenced by the project's plugins (`HeartReverie_Plugins/`) and SFC `<style scoped>` blocks today. Any future rename of a `--*` variable SHALL update the theme schema, the built-in themes, and every plugin reference in a single change.

#### Scenario: Plugin styling continues to work after the theme system lands
- **GIVEN** a plugin's stylesheet uses `var(--border-color)` and `var(--text-main)`
- **WHEN** the user is on the `default` theme
- **THEN** the plugin SHALL render with the same colours as before this change (because `default.toml` declares the same `--border-color` and `--text-main` values that `theme.css` did)

### Requirement: Theme settings page

The frontend SHALL register a new child route under `/settings` at path `theme` (resolving to `/settings/theme`) with `meta.title = '主題'`, lazy-loading a new `ThemeSettingsPage.vue` component. The page SHALL render a single `<select>` populated from `GET /api/themes`. Changing the selection SHALL invoke `useTheme().selectTheme(id)`, which persists the id, fetches `/api/themes/:id`, applies the result, and refreshes the localStorage cache.

#### Scenario: Sidebar exposes the theme tab
- **GIVEN** the `/settings/theme` route is registered with `meta.title: '主題'`
- **WHEN** the user navigates to any `/settings/*` route
- **THEN** the sidebar SHALL render a tab labelled `主題` linking to `/settings/theme`

#### Scenario: Dropdown lists all themes
- **GIVEN** the server has loaded three themes (`default`, `light`, `dark`)
- **WHEN** the user navigates to `/settings/theme`
- **THEN** the dropdown SHALL contain three `<option>` elements with values `default`, `light`, `dark` and labels matching each theme's `label`

#### Scenario: Selecting a theme applies it immediately
- **GIVEN** the user is on `/settings/theme` with `default` selected
- **WHEN** the user selects `light` from the dropdown
- **THEN** `document.documentElement.style.getPropertyValue("--text-main")` SHALL update to the `light` theme's value within the same tick, and `localStorage.heartReverie.themeId` SHALL equal `"light"`

### Requirement: Component styles use theme CSS variables for panel backgrounds

The `StorySelector`, `LoreEditor`, and `LoreBrowser` components SHALL use `var(--panel-bg)` for their dropdown and dialog background styles instead of hardcoding colour literals. No scoped style in these components SHALL reference the raw values `#1a0810`, `#220c16`, or the literal gradient `linear-gradient(145deg, #1a0810, #220c16)`.

#### Scenario: StorySelector dropdown uses theme variable
- **WHEN** the `StorySelector` component renders its dropdown panel
- **THEN** the dropdown's `background` CSS property SHALL resolve from `var(--panel-bg)`, adapting to the active theme

#### Scenario: LoreEditor tag-suggestion list uses theme variable
- **WHEN** the `LoreEditor` component renders its tag-suggestion dropdown
- **THEN** the dropdown's `background` CSS property SHALL resolve from `var(--panel-bg)`

#### Scenario: LoreEditor confirm-dialog uses theme variable
- **WHEN** the `LoreEditor` component renders its confirm-dialog overlay
- **THEN** the dialog's `background` CSS property SHALL resolve from `var(--panel-bg)`

#### Scenario: LoreBrowser search results dropdown uses theme variable
- **WHEN** the `LoreBrowser` component renders its search results dropdown
- **THEN** the dropdown's `background` CSS property SHALL resolve from `var(--panel-bg)`

#### Scenario: Theme switch updates all panel backgrounds
- **WHEN** the user switches from the default theme to the light theme
- **THEN** all dropdown and dialog backgrounds in StorySelector, LoreEditor, and LoreBrowser SHALL update to the light theme's `--panel-bg` value without a page reload

### Requirement: Theme system defines new accent-derived CSS variables

The theme system SHALL define the following additional CSS custom properties in `theme.css` (fallback) and all three theme TOML files, with values appropriate to each theme's colour palette:

| Variable | Semantic role |
|----------|--------------|
| `--selection-bg` | Text selection highlight background |
| `--accent-glow` | Text-shadow glow colour for decorative headings |
| `--accent-line` | Centre colour of decorative horizontal gradient lines |
| `--text-hover` | Text colour on hover states (lighter than `--text-name`) |
| `--pill-bg` | Background of variable-pill / tag badges |
| `--pill-hover-bg` | Hover background of variable-pill badges |
| `--accent-shadow` | Box-shadow colour for accent-coloured elements |
| `--accent-border` | Strong accent border colour (e.g. scene boxes) |
| `--accent-inset` | Inset glow colour for pulse animations |
| `--accent-subtle` | Very subtle accent background (field hints, error regions) |
| `--accent-solid` | Solid accent colour for error text and active indicators |

#### Scenario: All accent variables defined in each theme TOML
- **GIVEN** the theme files `default.toml`, `light.toml`, and `dark.toml`
- **THEN** each SHALL define all 11 new palette keys with colours that harmonise with its existing palette

#### Scenario: theme.css provides fallback definitions
- **GIVEN** the fallback `:root` block in `theme.css`
- **THEN** it SHALL include definitions for all 11 new variables matching the default theme values

### Requirement: Global base.css uses theme variables instead of hardcoded accent colours

`base.css` SHALL NOT contain literal `rgba(180, 30, 60, …)`, `rgba(255, 100, 120, …)`, or `rgba(224, 80, 112, …)` values.

#### Scenario: Text selection uses --selection-bg
- **WHEN** the user selects text on the page
- **THEN** the `::selection` and `::-moz-selection` backgrounds SHALL use `var(--selection-bg)`

#### Scenario: pulse-glow animation uses theme variables
- **WHEN** the `pulse-glow` keyframe animation renders
- **THEN** box-shadow colours SHALL use `var(--accent-shadow)` and `var(--accent-inset)` instead of hardcoded rgba values

#### Scenario: Variable-pill badges use theme variables
- **WHEN** a `.variable-pill` element renders
- **THEN** its `background` SHALL use `var(--pill-bg)` and on hover `var(--pill-hover-bg)`
- **AND** the `.pill-plugin` variant SHALL use `var(--btn-active-bg)` for background and `var(--item-border)` for border-color

### Requirement: Reader components use theme variables for accent-derived colours

Components SHALL NOT hardcode `#b41e3c`, `rgba(180, 30, 60, …)`, or `rgba(224, 80, 112, …)`. They SHALL use the closest semantic CSS variable.

#### Scenario: QuickAddPage and ImportCharacterCardPage use theme variables
- **WHEN** these components render error/validation states
- **THEN** `#b41e3c` colour references SHALL become `var(--accent-solid)`
- **AND** `rgba(180, 30, 60, 0.08)` backgrounds SHALL become `var(--accent-subtle)`

#### Scenario: ToolsMenu, ToolsLayout, SettingsLayout use existing variables
- **WHEN** these components render active-item backgrounds with `rgba(180, 30, 60, 0.12)`
- **THEN** they SHALL use `var(--btn-active-bg)` instead

#### Scenario: PromptEditorMessageCard uses theme variables
- **WHEN** the `.pill-plugin` variant renders in this component
- **THEN** it SHALL use `var(--btn-active-bg)` for background and `var(--item-border)` for border-color
- **AND** `rgba(224, 80, 112, 0.12)` backgrounds SHALL use `var(--pill-bg)`

#### Scenario: LoreEditor tag-suggestion hover uses existing variable
- **WHEN** a tag suggestion item is hovered
- **THEN** its background SHALL use `var(--btn-hover-bg)` instead of `rgba(180, 30, 60, 0.22)`

#### Scenario: LoreBrowser uses theme variables for all accent colours
- **WHEN** `LoreBrowser` renders its various interactive states
- **THEN** `rgba(224, 80, 112, 0.12)` SHALL become `var(--pill-bg)`
- **AND** `rgba(224, 80, 112, 0.3)` SHALL become `var(--pill-hover-bg)`
- **AND** `rgba(180, 30, 60, 0.22)` SHALL become `var(--btn-hover-bg)`
- **AND** `rgba(180, 30, 60, 0.35)` SHALL become `var(--accent-shadow)` (or a dedicated hover-strong variable)
- **AND** `rgba(180, 30, 60, 0.12)` SHALL become `var(--btn-active-bg)`
- **AND** `rgba(180, 30, 60, 0.4)` SHALL become `var(--accent-border)`
- **AND** `rgba(180, 30, 60, 0.15)` SHALL become `var(--accent-subtle)` (or `var(--btn-active-bg)`)

### Requirement: Plugin stylesheets use theme variables instead of hardcoded colours

Plugin CSS files (`status/styles.css`, `options/styles.css`) SHALL NOT contain literal `rgba(180, 30, 60, …)`, `rgba(255, 100, 140, …)`, `#c23456`, or `#ffd0dc` values. They SHALL reference CSS custom properties from the theme system.

#### Scenario: status plugin uses theme variables
- **WHEN** `status/styles.css` renders the character header and fold sections
- **THEN** `rgba(255, 100, 140, 0.5)` text-shadow SHALL use `var(--accent-glow)`
- **AND** `rgba(180, 30, 60, 0.5)` border SHALL use `var(--accent-border)`
- **AND** `#ffd0dc` hover colour SHALL use `var(--text-hover)`
- **AND** `rgba(255, 50, 80, 0.08)` inset glow SHALL use `var(--accent-subtle)`

#### Scenario: options plugin uses theme variables
- **WHEN** `options/styles.css` renders action buttons and decorative elements
- **THEN** `#c23456` in the gradient SHALL use `var(--accent-line)`
- **AND** `rgba(255, 100, 140, 0.5)` text-shadow SHALL use `var(--accent-glow)`
- **AND** `#ffd0dc` hover text SHALL use `var(--text-hover)`
- **AND** `rgba(180, 30, 60, 0.3)` box-shadow SHALL use `var(--accent-shadow)`
- **AND** `rgba(180, 30, 60, 0.15)` active box-shadow SHALL use `var(--accent-subtle)`
