# Start Hints Plugin

## Purpose

Defines the start-hints plugin, a prompt-only plugin that provides first-round opening chapter guidance via the `start_hints` Vento template variable.

## Requirements

### Requirement: Start hints plugin definition

A `prompt-only` plugin named `start-hints` SHALL exist at `plugins/start-hints/` with a `plugin.json` manifest containing:
- `name`: `"start-hints"`
- `version`: `"1.0.0"`
- `description`: describing first-round opening chapter guidance
- `type`: `"prompt-only"`
- `promptFragments`: one entry with `file` pointing to the hints markdown, `variable` set to `"start_hints"`, and `priority` of `100`
- `promptStripTags`: `["start_hints"]`
- `displayStripTags`: `["start_hints"]`

#### Scenario: Plugin provides start hints variable
- **WHEN** the plugin system loads `start-hints/plugin.json`
- **THEN** the `start_hints` Vento template variable SHALL contain the `<start_hints>` XML block with 7 Traditional Chinese guidelines for crafting compelling opening chapters

#### Scenario: Start hints tags stripped from context and display
- **WHEN** the LLM echoes `<start_hints>` content in its response
- **THEN** the tag SHALL be stripped from both `previousContext` (via `promptStripTags`) and frontend display (via `displayStripTags`)

### Requirement: Start hints prompt fragment content

The prompt fragment markdown file SHALL contain the `<start_hints>` block with the introductory line (`請參考這段指示創作出一個好的起始章節:`) followed by 7 numbered guidelines covering: hook/suspense, world-building, character introduction, story direction, foreshadowing, impactful opening, and tone-setting. The content SHALL end with a closing line (`起始章節完成以上任務，吸引讀者繼續閱讀。`). The `<start_hints>` XML tags SHALL be included in the fragment content.

#### Scenario: Fragment file contains required structure

- **WHEN** the plugin's prompt fragment file is read
- **THEN** it SHALL contain an opening `<start_hints>` tag, exactly 7 numbered guidelines in Traditional Chinese, and a closing `</start_hints>` tag

### Requirement: `start-hints` exposes an `enabled` toggle

`plugins/start-hints/plugin.json` SHALL declare a `settingsSchema` block with a single `enabled` boolean (default `true`) so users on stories whose lore already covers genre direction can disable the plugin without removing its directory.

When `enabled === false`, the engine prerequisite that gates `promptFragments[]` by resolved settings SHALL cause the plugin's `start-hints.md` content to be omitted from the assembled system prompt.

#### Scenario: Disabling start-hints removes its fragment

- **WHEN** the operator disables `start-hints` via the settings page
- **AND** the engine assembles a system prompt for a new chapter
- **THEN** none of the seven creative-direction bullets from `start-hints.md` appear in the prompt
