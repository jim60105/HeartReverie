# Delta Spec: vento-prompt-template

## MODIFIED Requirements

### Requirement: Template variables (status_data source change)

The `status_data` template variable SHALL change from a core-provided variable to a plugin-provided variable. The variable name, type (`string`), and content remain identical. The `system.md` template reference `{{ status_data }}` requires no modification — only the provider changes.

#### Scenario: status_data provided by plugin
- **WHEN** the system prompt is rendered and the `state` plugin is loaded
- **THEN** `status_data` SHALL be present in the Vento template context with the same content as before (from `current-status.yml` or `init-status.yml`)
- **AND** it SHALL be provided via the plugin's `getDynamicVariables` mechanism, NOT as a core variable

#### Scenario: status_data absent when state plugin not loaded
- **WHEN** the system prompt is rendered and the `state` plugin is NOT loaded
- **THEN** `status_data` SHALL be undefined (or empty string) in the template context
- **AND** the `{{ if status_data }}` conditional in `system.md` SHALL cause the `<status_current_variable>` block to be omitted from the rendered output

#### Scenario: All variables still passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all variable categories: `previous_context`, `user_input`, `isFirstRound`, `plugin_prompts`, `series_name`, `story_name`, `lore_all`, dynamic `lore_<tag>` variables, `lore_tags`, and plugin-provided dynamic variables (including `status_data` from the state plugin)
- **AND** `status_data` SHALL NOT appear in the core variable enumeration

### Requirement: Template prompt structure (status block unchanged)

The `{{ if status_data }}...<status_current_variable>{{ status_data }}</status_current_variable>...{{ /if }}` block in `system.md` SHALL remain unchanged. No modification to the template file is needed.

#### Scenario: Status variable rendering unchanged
- **WHEN** the template is rendered and `status_data` is non-empty
- **THEN** the rendered output SHALL include `<status_current_variable>` with the status content, identical to current behavior

#### Scenario: Status block omitted when empty
- **WHEN** the template is rendered and `status_data` is empty or undefined
- **THEN** the `<status_current_variable>` block SHALL NOT appear in the rendered output
