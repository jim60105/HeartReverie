## MODIFIED Requirements

### Requirement: Compaction configuration

The context-compaction plugin SHALL support configuration via `compaction-config.yaml` files at two levels:
1. **Story level**: `playground/{series}/{name}/compaction-config.yaml` — highest priority
2. **Series level**: `playground/{series}/compaction-config.yaml` — fallback

If no configuration file exists at either level, the plugin SHALL use default values. Configuration SHALL support the following fields: `recentChapters` (integer, default 3, the L2 window size) and `enabled` (boolean, default true, allows disabling compaction per story/series).

#### Scenario: Story-level config overrides series-level
- **WHEN** both story-level and series-level `compaction-config.yaml` exist with different `recentChapters` values
- **THEN** the story-level value SHALL be used

#### Scenario: No config files exist
- **WHEN** no `compaction-config.yaml` exists at story or series level
- **THEN** the plugin SHALL use default values: `recentChapters: 3`, `enabled: true`

#### Scenario: Compaction disabled via config
- **WHEN** `compaction-config.yaml` contains `enabled: false`
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded
