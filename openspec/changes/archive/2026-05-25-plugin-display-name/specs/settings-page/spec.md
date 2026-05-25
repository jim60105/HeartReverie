## MODIFIED Requirements

### Requirement: Dynamic plugin settings tabs

The settings page sidebar SHALL dynamically discover plugins that declare `settingsSchema` via the `/api/plugins` endpoint (checking `hasSettings: true`). For each such plugin, the sidebar SHALL render a navigation link whose **visible link text** is the plugin's `displayName` field from the `/api/plugins` response (the manifest's human-readable zh-TW label), and whose **route target** is `/settings/plugins/:name` where `:name` is the plugin slug (the `name` field, used unchanged as URL parameter, Vue `:key`, and settings-storage key). The settings router SHALL register a wildcard child route at `plugins/:name` that lazy-loads a generic `PluginSettingsPage.vue` component.

`reader-src/src/components/SettingsLayout.vue` SHALL construct each `PluginTab` view-model by reading `displayName` from the `/api/plugins` payload and assigning it to the tab's `label` field. The component SHALL NOT fall back to `name` if `displayName` is missing or empty — the backend's manifest loader already rejects such plugins, so `displayName` is guaranteed to be a non-empty string in any record returned by `/api/plugins`.

#### Scenario: Plugin with settings appears in sidebar with zh-TW label

- **WHEN** the user navigates to any `/settings/*` route and a loaded plugin (e.g. `chapter-bookmark`) declares `settingsSchema` and a manifest `displayName` of `"章節書籤"`
- **THEN** the sidebar SHALL display a `<router-link>` under the "插件" section whose visible text is `章節書籤`
- **AND** the link's `:to` SHALL resolve to `/settings/plugins/chapter-bookmark` (using the plugin slug `name`, not `displayName`)
- **AND** the link's Vue `:key` SHALL be the slug `name`

#### Scenario: Plugin slug is preserved in route param

- **WHEN** the user clicks a plugin's sidebar link
- **THEN** the destination route SHALL be `/settings/plugins/<slug>` where `<slug>` is the plugin's `name` field
- **AND** bookmarked or shared URLs of the form `/settings/plugins/<slug>` SHALL continue to resolve correctly regardless of any change to that plugin's `displayName`

#### Scenario: Plugin settings page renders schema-driven form

- **WHEN** the user navigates to `/settings/plugins/sd-webui-image-gen`
- **THEN** the page SHALL fetch the plugin's settings schema and current values, and render form inputs matching the schema types (text for string, number input for integer/number, select for enum, checkbox for boolean)

#### Scenario: Settings saved via form submission

- **WHEN** the user modifies a field and clicks save on the plugin settings page
- **THEN** the page SHALL PUT the updated values to `/api/plugins/:name/settings` and display a success notification

#### Scenario: Dynamic dropdown options from x-options-url

- **WHEN** a schema field declares `x-options-url: "/api/plugins/sd-webui-image-gen/proxy/sd-models"`
- **THEN** the settings form SHALL fetch that URL and render the response as dropdown `<option>` elements for that field

## ADDED Requirements

### Requirement: Plugin settings page renders zh-TW displayName in heading and save notification

`reader-src/src/components/PluginSettingsPage.vue` SHALL render the page-title heading and the save-success notification body using the current plugin's `displayName` (the zh-TW manifest label), not the slug. The route param (`pluginName`), the `/api/plugins/:name/...` API URLs, the settings-storage key, and the `name` field emitted on the `plugin:settingsSaved` event SHALL continue to use the slug unchanged — only the user-visible strings are switched to `displayName`.

The page SHALL obtain `displayName` by reading the `/api/plugins` payload (the same source `SettingsLayout.vue` uses) and matching on the slug from the route param. While the page is still loading the plugin list, the heading MAY transiently display the slug or an empty placeholder, but once the lookup resolves it SHALL be replaced with the `displayName`. Because the loader guarantees every loaded plugin has a non-empty `displayName`, and because the route only resolves for plugins that exist in `/api/plugins`, no fallback-to-slug path is required for the steady state.

#### Scenario: Plugin settings page heading renders displayName

- **WHEN** the user navigates to `/settings/plugins/dialogue-colorize` and the plugin's manifest declares `displayName: "對話著色"`
- **THEN** the page SHALL render `<h2 class="page-title">對話著色 設定</h2>`
- **AND** the heading SHALL NOT contain the slug `dialogue-colorize`

#### Scenario: Save notification uses displayName

- **WHEN** the user saves changes on the plugin settings page for `dialogue-colorize` (with `displayName: "對話著色"`) and the PUT request succeeds
- **THEN** the success toast body SHALL include `對話著色` (the `displayName`)
- **AND** the toast body SHALL NOT include the slug `dialogue-colorize`

#### Scenario: API URLs and route param continue to use the slug

- **WHEN** the user is on `/settings/plugins/dialogue-colorize` and the page issues fetches for schema, settings, schema-meta, and validation, or PUTs the save request
- **THEN** every request URL SHALL be of the form `/api/plugins/dialogue-colorize/...` (the slug `name`, unchanged)
- **AND** the `plugin:settingsSaved` event emitted after a successful save SHALL carry `name: "dialogue-colorize"` (the slug, not the `displayName`)
- **AND** route resolution, browser history, and shared/bookmarked URLs SHALL be unaffected by any change to that plugin's `displayName`
