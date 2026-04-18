# Plugin Core

## MODIFIED Requirements

### Requirement: Plugin manifest format

Each plugin SHALL have a `plugin.json` (or `plugin.yaml`) manifest file in its root directory. The manifest SHALL contain the following fields: `name` (string, unique identifier), `version` (semver string), `description` (string), `type` (one of `full-stack`, `prompt-only`, `frontend-only`, `hook-only`), `prompts` (array of relative paths to prompt files to contribute), `frontend` (array of relative paths to frontend ES module scripts), `frontendStyles` (array of relative paths to CSS files to inject into the frontend), `hooks` (object mapping hook stage names to handler file paths), and `dependencies` (array of plugin names this plugin depends on). The `name` and `version` fields SHALL be required; all other fields SHALL be optional with sensible defaults (empty arrays/objects).

#### Scenario: Valid full-stack plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with `name`, `version`, `type` set to `full-stack`, `prompts`, `frontend`, and `hooks` fields
- **THEN** the loader SHALL parse the manifest and register the plugin with all declared capabilities

#### Scenario: Minimal prompt-only plugin manifest
- **WHEN** a plugin directory contains a `plugin.json` with only `name`, `version`, and `prompts` fields
- **THEN** the loader SHALL parse the manifest successfully, defaulting `type` to `prompt-only`, `frontend` to `[]`, `frontendStyles` to `[]`, `hooks` to `{}`, and `dependencies` to `[]`

#### Scenario: Invalid manifest missing required fields
- **WHEN** a plugin directory contains a `plugin.json` without a `name` or `version` field
- **THEN** the loader SHALL log an error identifying the plugin directory and the missing field(s), and SHALL skip loading that plugin

#### Scenario: YAML manifest format
- **WHEN** a plugin directory contains a `plugin.yaml` instead of `plugin.json`
- **THEN** the loader SHALL parse the YAML manifest identically to JSON and register the plugin

#### Scenario: Manifest declares frontendStyles
- **WHEN** a plugin directory contains a `plugin.json` with `"frontendStyles": ["styles.css"]` and the file exists within the plugin directory
- **THEN** the loader SHALL parse the manifest, record the CSS asset, and register the plugin with its declared stylesheets available for frontend injection
