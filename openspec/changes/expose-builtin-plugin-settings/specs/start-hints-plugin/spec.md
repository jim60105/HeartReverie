## ADDED Requirements

### Requirement: `start-hints` exposes an `enabled` toggle

`plugins/start-hints/plugin.json` SHALL declare a `settingsSchema` block with a single `enabled` boolean (default `true`) so users on stories whose lore already covers genre direction can disable the plugin without removing its directory.

When `enabled === false`, the engine prerequisite that gates `promptFragments[]` by resolved settings SHALL cause the plugin's `start-hints.md` content to be omitted from the assembled system prompt.

#### Scenario: Disabling start-hints removes its fragment

- **WHEN** the operator disables `start-hints` via the settings page
- **AND** the engine assembles a system prompt for a new chapter
- **THEN** none of the seven creative-direction bullets from `start-hints.md` appear in the prompt
