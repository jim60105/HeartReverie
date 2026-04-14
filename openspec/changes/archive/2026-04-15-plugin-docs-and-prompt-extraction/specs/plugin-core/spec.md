# Delta Spec: plugin-core

## MODIFIED Requirements

### Requirement: Plugin name identity preservation

Plugin manifest `name` fields and directory names SHALL remain unchanged during this refactor. The actual plugin names are: `status`, `options`, `state`, `thinking`, `context-compaction`, `de-robotization`, `imgthink`, `threshold-lord`, `t-task`, `user-message`, `writestyle`, `start-hints`. Delta specs and Vue components MAY use descriptive names for component file names, but plugin manifests, directory names, and any code referencing plugin names SHALL use these names.

#### Scenario: New plugin directory names
- **WHEN** the prompt extraction is complete
- **THEN** one new plugin directory SHALL exist: `plugins/start-hints/`
- **AND** it SHALL contain a valid `plugin.json` with `name` matching the directory name
