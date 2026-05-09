## MODIFIED Requirements

### Requirement: Compaction configuration

The context-compaction plugin SHALL support configuration via the following layers, applied in this precedence order (highest first):

1. **Story-level YAML**: `playground/{series}/{name}/compaction-config.yaml` — selected as a single block if present.
2. **Series-level YAML**: `playground/{series}/compaction-config.yaml` — selected as a single block if no story-level YAML is present **as a valid (non-array) object**. Empty, scalar, array, or malformed story-level YAML is treated as absent and series-level YAML applies.
3. **Engine-managed plugin settings (global)**: persisted by the engine at `playground/_plugins/context-compaction/config.json`, edited via the reader's auto-rendered settings page (driven by the plugin's `settingsSchema`).
4. **Built-in defaults**: `recentChapters: 3`, `enabled: true`.

YAML-vs-YAML semantics SHALL remain all-or-nothing: story YAML and series YAML are mutually exclusive — if story-level YAML exists, series-level YAML SHALL NOT be consulted. The plugin-settings layer SHALL sit *under* the chosen YAML (or under defaults if no YAML exists) and SHALL fill in fields the chosen YAML omits via field-level merge. The defaults layer SHALL fill in fields neither the YAML nor the plugin settings layer specify.

Configuration SHALL support the following fields: `recentChapters` (positive integer, default 3, the L2 window size) and `enabled` (boolean, default true, allows disabling compaction per story/series). Each layer SHALL be sanitised before merging — non-positive integers and non-boolean values SHALL be dropped (treated as if absent) so the next-lower layer fills in.

The plugin SHALL read the engine-managed settings file on each `prompt-assembly` invocation (per chat turn) so that a UI edit takes effect on the very next turn without restart or cache invalidation. A missing settings file or malformed JSON SHALL be treated as an empty plugin-settings layer; malformed JSON SHALL produce a WARN-level log entry but SHALL NOT abort the request.

#### Scenario: Story-level YAML overrides series-level YAML

- **WHEN** both story-level and series-level `compaction-config.yaml` exist with different `recentChapters` values
- **THEN** the story-level value SHALL be used
- **AND** series-level YAML SHALL NOT contribute any fields, even those omitted by the story-level YAML

#### Scenario: Story YAML overrides plugin settings UI

- **GIVEN** the user has set `recentChapters: 7` in the reader's settings UI
- **AND** the story-level `compaction-config.yaml` contains `recentChapters: 2`
- **WHEN** a chat turn is processed for that story
- **THEN** the effective `recentChapters` SHALL be `2`

#### Scenario: Plugin settings UI fills in fields omitted by chosen YAML

- **GIVEN** the story-level `compaction-config.yaml` contains only `recentChapters: 5` (no `enabled` field)
- **AND** the user has set `enabled: false` in the reader's settings UI
- **WHEN** a chat turn is processed for that story
- **THEN** the effective config SHALL be `{ recentChapters: 5, enabled: false }`

#### Scenario: Plugin settings UI applies when no YAML is present

- **GIVEN** no `compaction-config.yaml` exists at story or series level
- **AND** the user has set `recentChapters: 5` and `enabled: true` in the reader's settings UI
- **WHEN** a chat turn is processed
- **THEN** the effective config SHALL be `{ recentChapters: 5, enabled: true }`

#### Scenario: Defaults apply when neither YAML nor UI is set

- **WHEN** no `compaction-config.yaml` exists at story or series level
- **AND** the user has not edited the reader's settings UI for this plugin (no `playground/_plugins/context-compaction/config.json` file)
- **THEN** the plugin SHALL use default values: `recentChapters: 3`, `enabled: true`

#### Scenario: Compaction disabled via story YAML

- **WHEN** story-level `compaction-config.yaml` contains `enabled: false`
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded
- **AND** the plugin settings UI value for `enabled` SHALL be ignored for this story

#### Scenario: Compaction disabled via plugin settings UI

- **GIVEN** no YAML files exist for the story or series
- **AND** the user has set `enabled: false` in the reader's settings UI
- **WHEN** a chat turn is processed
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded

#### Scenario: UI edit takes effect on next turn

- **GIVEN** a chat turn just completed using the previous `recentChapters` value
- **WHEN** the user opens the plugin settings page, changes `recentChapters` from `3` to `6`, and saves
- **AND** a new chat turn is processed
- **THEN** the new turn SHALL use `recentChapters: 6` without any backend restart or cache invalidation step

#### Scenario: Existing YAML-only setups behave identically

- **GIVEN** the plugin settings file `playground/_plugins/context-compaction/config.json` does not exist (user has never edited the UI)
- **AND** a story-level or series-level `compaction-config.yaml` exists with any combination of fields
- **WHEN** a chat turn is processed
- **THEN** the effective config SHALL be byte-for-byte identical to what `loadCompactionConfig()` would have produced before this change

#### Scenario: Malformed plugin settings JSON does not break the request

- **GIVEN** `playground/_plugins/context-compaction/config.json` exists but contains invalid JSON
- **WHEN** a chat turn is processed
- **THEN** the plugin SHALL log a WARN-level message and treat the plugin-settings layer as empty
- **AND** the request SHALL succeed using YAML (if present) or defaults

#### Scenario: Out-of-range value in persisted config.json is sanitised at read time

- **GIVEN** `playground/_plugins/context-compaction/config.json` contains `{ "recentChapters": 0, "enabled": true }` (e.g., manually edited on disk)
- **AND** no YAML files exist
- **WHEN** a chat turn is processed
- **THEN** the effective `recentChapters` SHALL fall through to the next layer (defaults: `3`)
- **AND** the effective `enabled` SHALL be `true` (the boolean field is sanitised independently)

## ADDED Requirements

### Requirement: Plugin settings schema declaration

The `context-compaction` plugin's `plugin.json` manifest SHALL declare a top-level `settingsSchema` (JSON Schema draft-07, `type: "object"`) exposing the `recentChapters` and `enabled` configuration fields to the engine's `plugin-settings` capability so the reader auto-renders a settings page for them.

The schema SHALL define:

- `recentChapters` — `type: "integer"`, `minimum: 1`, `default: 3`, with zh-TW `title` and `description` explaining the L2 window size. The `minimum: 1` declaration is documentation and a UI rendering hint; the engine's current validator does not enforce it. Runtime safety SHALL be provided by sanitisation in `config.ts` (non-positive values fall through to the next-lower layer).
- `enabled` — `type: "boolean"`, `default: true`, with zh-TW `title` and `description` explaining that disabling makes the plugin a no-op.

The schema's `default` values SHALL be identical to the values in the plugin's in-code `DEFAULTS` constant so that an unedited UI matches built-in behaviour exactly.

#### Scenario: Settings page is auto-rendered

- **WHEN** the reader navigates to the plugin settings page for `context-compaction`
- **THEN** the page SHALL show two controls: an integer input for `recentChapters` (with `min="1"` from the schema) and a boolean toggle for `enabled`, each with the zh-TW label and help text from the schema

#### Scenario: GET returns defaults when nothing persisted

- **GIVEN** the user has never edited the plugin's settings (no `playground/_plugins/context-compaction/config.json` file)
- **WHEN** the reader loads the settings page
- **THEN** `GET /api/plugins/context-compaction/settings` SHALL return a body containing `recentChapters: 3` and `enabled: true` (the schema defaults, merged by the engine's plugin-settings handler)

#### Scenario: PUT validates type and persists

- **WHEN** the reader sends `PUT /api/plugins/context-compaction/settings` with body `{ "recentChapters": 5, "enabled": true }`
- **THEN** the engine SHALL validate the body's types against `settingsSchema` and persist it to `playground/_plugins/context-compaction/config.json`

#### Scenario: PUT rejects wrong types

- **WHEN** the reader sends `PUT /api/plugins/context-compaction/settings` with body `{ "recentChapters": "five" }`
- **THEN** the engine SHALL reject the request with a validation error
- **AND** no change SHALL be written to `playground/_plugins/context-compaction/config.json`

#### Scenario: Schema defaults match code defaults

- **WHEN** the test suite compares `settingsSchema.properties.recentChapters.default` and `settingsSchema.properties.enabled.default` to the `DEFAULTS` constant exported from `config.ts`
- **THEN** the values SHALL be identical
