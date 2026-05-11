## ADDED Requirements

### Requirement: `dialogue-colorize` exposes three settings

`plugins/dialogue-colorize/plugin.json` SHALL declare a `settingsSchema` block exposing:

- `enabled` (boolean, default `true`) — universal toggle.
- `dialogueColor` (string, default `""`) — CSS color string. Empty string is the sentinel for "fall through to the theme's `--text-name`".
- `enabledQuoteStyles` (array of strings, default all six, items enum `"straight" | "curly" | "guillemet" | "corner" | "corner-half" | "book"`) — selects which quote pairs are highlighted.

#### Scenario: Manifest is valid JSON-Schema

- **WHEN** the engine loads the plugin
- **THEN** the `settingsSchema` block conforms to JSON-Schema draft 7
- **AND** the settings page renders three form controls (boolean toggle, color string, multi-select)

### Requirement: Color override is applied via dedicated stylesheet

The plugin SHALL inject a `<style id="plugin-dialogue-color-override">` element appended to `<head>` AFTER the theme's `#theme-highlight-override` element. The injected rule SHALL target the same six `::highlight()` selectors as the theme override and set `color` to the validated `dialogueColor` value.

The plugin SHALL validate `dialogueColor` via `CSS.supports("color", value)` before injecting. Invalid or empty values SHALL cause the plugin's override stylesheet to be removed, allowing the theme override to take effect (today's behaviour).

The plugin MUST NOT use `!important` in its override rule; source-order precedence is sufficient because the theme's override also avoids `!important` outside its single existing usage.

#### Scenario: Valid color overrides theme

- **WHEN** `dialogueColor` is set to `"#aa5500"`
- **AND** `CSS.supports("color", "#aa5500")` returns `true`
- **THEN** the plugin injects the override stylesheet
- **AND** dialogue quote runs paint with `#aa5500`

#### Scenario: Invalid color falls back to theme

- **WHEN** `dialogueColor` is set to `"not-a-color"`
- **THEN** the plugin removes any existing override stylesheet
- **AND** dialogue quote runs paint with the theme's `--text-name`

### Requirement: Quote-style filtering honours the multi-select

When `enabledQuoteStyles` excludes a style, the plugin SHALL skip the corresponding pattern in its `PAIRS` iteration so those quote runs are not added to any `Highlight` instance.

#### Scenario: User unchecks straight-quote style

- **WHEN** `enabledQuoteStyles` is `["curly","guillemet","corner","corner-half","book"]`
- **THEN** straight `"..."` runs are NOT highlighted
- **AND** all five other styles continue to be highlighted
