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
