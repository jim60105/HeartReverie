## ADDED Requirements

### Requirement: Plugin manifest declares a human-readable displayName

Each plugin's `plugin.json` (or `plugin.yaml`) manifest SHALL include a `displayName` field whose value is a non-empty string intended as a short, human-readable label for the reader UI (sidebar navigation, drawer menus, future plugin pickers). The `displayName` field is distinct from `name` (which is the kebab-case slug, the URL parameter, the settings-storage key, and the impersonation-guard match against the plugin directory name) and from `description` (which is a paragraph-shaped blurb).

The `displayName` field SHALL be required. The manifest loader (`writer/lib/plugin-loader-manifest.ts::parseManifestFile`) SHALL reject and skip any plugin whose manifest:

- omits the `displayName` field, OR
- contains a `displayName` value that is not a `string`, OR
- contains a `displayName` whose value, after `String.prototype.trim()`, has length 0.

The rejection SHALL emit a `log.warn` (consistent with the existing missing-`name` rejection log) that identifies the plugin directory path and the reason. The plugin SHALL NOT appear in the in-memory plugin registry exposed by `pluginManager.getPlugins()`, SHALL NOT appear in the JSON returned by `GET /api/plugins`, and SHALL NOT have any backend hooks or routes registered.

The TypeScript `PluginManifest` interface in `writer/types/plugin.ts` SHALL declare `displayName` as a required (non-optional) `readonly string` property.

The validator SHALL NOT impose an upper length bound, a character-class constraint (no zh-TW-only check), or a uniqueness check across plugins. Cosmetic concerns (truncation, duplicate labels) are surfaced through UI styling and operator review, not the schema.

#### Scenario: Manifest with non-empty displayName loads successfully

- **WHEN** a plugin directory contains a `plugin.json` whose `name` matches the directory and whose `displayName` is a non-empty string after trim (e.g. `"displayName": "章節書籤"`)
- **THEN** the loader SHALL parse the manifest, retain the `displayName` value verbatim on the in-memory plugin record, and register the plugin
- **AND** `pluginManager.getPlugins()` SHALL include this plugin in its result

#### Scenario: Manifest missing displayName is rejected

- **WHEN** a plugin directory contains a `plugin.json` with a valid `name` field but no `displayName` field
- **THEN** the loader SHALL emit a `log.warn` identifying the plugin directory and the missing `displayName` field
- **AND** the loader SHALL return `null` from `parseManifestFile`, causing the plugin to be skipped
- **AND** the plugin SHALL NOT appear in `pluginManager.getPlugins()` or in `GET /api/plugins`

#### Scenario: Manifest with non-string displayName is rejected

- **WHEN** a plugin directory contains a `plugin.json` whose `displayName` is not a string (e.g. `"displayName": 123`, `"displayName": null`, `"displayName": ["章節書籤"]`, or `"displayName": { "zh-TW": "章節書籤" }`)
- **THEN** the loader SHALL emit a `log.warn` identifying the plugin directory and reject the manifest
- **AND** the plugin SHALL NOT be loaded

#### Scenario: Manifest with empty or whitespace-only displayName is rejected

- **WHEN** a plugin directory contains a `plugin.json` whose `displayName` is `""`, `"   "`, `"\t"`, or any string whose `trim()` length is 0
- **THEN** the loader SHALL emit a `log.warn` identifying the plugin directory and reject the manifest
- **AND** the plugin SHALL NOT be loaded

#### Scenario: displayName is not coerced from the slug

- **WHEN** the loader processes any manifest, regardless of whether the `name` slug would form a plausible human-readable string
- **THEN** the loader SHALL NOT synthesise a `displayName` value from `name`, `description`, or any other field as a fallback
- **AND** the only path to a loaded plugin SHALL be an explicit, valid `displayName` field present in the manifest itself

#### Scenario: displayName accepts arbitrary scripts and punctuation

- **WHEN** a plugin manifest sets `displayName` to a value containing CJK characters, Latin characters, emoji, punctuation, or any mix thereof (e.g. `"章節書籤"`, `"SD WebUI 圖像生成"`, `"OpenRouter"`, `"🪝 Hook Inspector Logger"`)
- **THEN** the loader SHALL accept the value verbatim
- **AND** the validator SHALL NOT impose a script, length, or uniqueness constraint at this layer

### Requirement: GET /api/plugins exposes displayName

The `GET /api/plugins` endpoint registered in `writer/routes/plugins.ts` SHALL include a `displayName: string` field on every returned plugin record. The value SHALL be the verbatim `displayName` string from the plugin's manifest as accepted by the loader (no normalisation, trimming, or transformation beyond what the loader already applied — which is none). Because the loader's validation guarantees every loaded plugin has a non-empty `displayName`, this field SHALL always be present and non-empty in the API response for every plugin record; clients MAY rely on it without a defined-and-non-empty guard.

The field SHALL appear at the top level of each plugin record (a peer of `name`, `version`, `description`, `type`, `tags`, `hasSettings`, etc.), not nested inside `description` or any other field.

#### Scenario: API response includes displayName for every plugin

- **WHEN** a client requests `GET /api/plugins`
- **THEN** the response SHALL be a JSON array
- **AND** every element SHALL contain a `displayName` field whose value is a non-empty string
- **AND** the value SHALL be exactly the value declared in that plugin's `plugin.json` manifest

#### Scenario: API response separates slug and label

- **WHEN** a client requests `GET /api/plugins` and inspects a single plugin record
- **THEN** the record SHALL contain both a `name` field (the slug, e.g. `"chapter-bookmark"`) and a `displayName` field (the label, e.g. `"章節書籤"`) as distinct top-level string fields
- **AND** the two fields SHALL be independent — modifying `displayName` in the manifest SHALL NOT affect the response's `name`, and vice versa
