# Delta Spec: state-modules

## ADDED Requirements

### Requirement: Status data loading in state plugin

The `state` plugin backend module (`plugins/state/handler.js`) SHALL export a `getDynamicVariables(context)` function that loads the status YAML file and returns it as the `status_data` template variable.

#### Scenario: Load current-status.yml for active story
- **WHEN** `getDynamicVariables` is called with `{ series, name, storyDir }` context
- **AND** `current-status.yml` exists in the story directory (`playground/:series/:name/current-status.yml`)
- **THEN** it SHALL return `{ status_data: "<file content>" }`

#### Scenario: Fall back to init-status.yml
- **WHEN** `getDynamicVariables` is called with `{ series, name, storyDir }` context
- **AND** `current-status.yml` does NOT exist in the story directory
- **AND** `init-status.yml` exists in the series directory (`playground/:series/init-status.yml`)
- **THEN** it SHALL return `{ status_data: "<file content>" }`

#### Scenario: No status file exists
- **WHEN** `getDynamicVariables` is called with `{ series, name, storyDir }` context
- **AND** neither `current-status.yml` nor `init-status.yml` exists
- **THEN** it SHALL return `{ status_data: "" }`

#### Scenario: File read error is handled gracefully
- **WHEN** `getDynamicVariables` encounters a file system error reading the status YAML
- **THEN** it SHALL return `{ status_data: "" }` without throwing

### Requirement: Plugin declares status_data parameter

The `state` plugin manifest (`plugins/state/plugin.json`) SHALL declare `status_data` in its `parameters` array so it is discoverable via `getParameters()` and included in Levenshtein suggestions.

#### Scenario: Plugin manifest includes status_data parameter
- **WHEN** `plugin.json` for the `state` plugin is examined
- **THEN** it SHALL contain a `parameters` entry with `{ "name": "status_data", "type": "string", "description": "Current status YAML content loaded from story or series init file" }`

## MODIFIED Requirements

### Requirement: Post-response hook (existing — unchanged)

The existing `post-response` hook handler that invokes the `state-patches` Rust binary is NOT modified by this change. The `register()` function is unchanged.

#### Scenario: Post-response hook still runs state-patches binary
- **WHEN** a chat response completes and the `post-response` hook fires
- **THEN** the state plugin SHALL invoke the `state-patches` binary exactly as before
