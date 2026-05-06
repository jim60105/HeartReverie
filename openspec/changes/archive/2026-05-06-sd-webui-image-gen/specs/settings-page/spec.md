# settings-page

> Modified capability in change `sd-webui-image-gen`

## ADDED Requirements

### Requirement: Dynamic plugin settings tabs

The settings page sidebar SHALL dynamically discover plugins that declare `settingsSchema` via the `/api/plugins` endpoint (checking `hasSettings: true`). For each such plugin, the sidebar SHALL render a navigation link using the plugin's `name` as the label, linking to `/settings/plugins/:name`. The settings router SHALL register a wildcard child route at `plugins/:name` that lazy-loads a generic `PluginSettingsPage.vue` component.

#### Scenario: Plugin with settings appears in sidebar

- **WHEN** the user navigates to any `/settings/*` route and a loaded plugin declares `settingsSchema`
- **THEN** the sidebar SHALL display a link labeled with the plugin's name under a "Plugins" section, linking to `/settings/plugins/<pluginName>`

#### Scenario: Plugin settings page renders schema-driven form

- **WHEN** the user navigates to `/settings/plugins/sd-webui-image-gen`
- **THEN** the page SHALL fetch the plugin's settings schema and current values, and render form inputs matching the schema types (text for string, number input for integer/number, select for enum, checkbox for boolean)

#### Scenario: Settings saved via form submission

- **WHEN** the user modifies a field and clicks save on the plugin settings page
- **THEN** the page SHALL PUT the updated values to `/api/plugins/:name/settings` and display a success notification

#### Scenario: Dynamic dropdown options from x-options-url

- **WHEN** a schema field declares `x-options-url: "/api/plugins/sd-webui-image-gen/proxy/sd-models"`
- **THEN** the settings form SHALL fetch that URL and render the response as dropdown `<option>` elements for that field
