## ADDED Requirements

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
