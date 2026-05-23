## ADDED Requirements

### Requirement: Plugin manifest `frontendImports` field

The plugin manifest schema SHALL accept an optional `frontendImports: readonly string[]` field. When present, each entry SHALL be a relative path (forward-slash or `./`-prefixed) to a sibling `.js` ES module that the plugin's `frontendModule` statically imports and which the SPA needs to fetch over HTTP. When absent, the field SHALL default to `[]`. The field SHALL NOT change any existing behaviour for plugins that do not ship sibling import targets.

The loader SHALL pass `frontendImports` through `validateFrontendImports(manifest, pluginDir)` (defined in the `plugin-asset-allowlist` capability) and store the validated, normalized, deduplicated result on the in-memory plugin entry as `validatedImports: readonly string[]`. Validation failures on individual entries SHALL be logged via `log.warn` and the offending entries SHALL be dropped; the rest of the manifest SHALL load normally.

The `PluginManifest` TypeScript type in `writer/types/plugin.ts` SHALL declare:

```ts
readonly frontendImports?: readonly string[];
```

#### Scenario: Manifest without `frontendImports` loads normally

- **GIVEN** a `plugin.json` with `name`, `version`, and `frontendModule: "ui.js"` but no `frontendImports` field
- **WHEN** the loader parses the manifest
- **THEN** the plugin SHALL load successfully and `validatedImports` SHALL equal `[]`

#### Scenario: Valid `frontendImports` are stored on the plugin entry

- **GIVEN** a `plugin.json` with `frontendImports: ["./lightbox.js", "sub/helper.js"]` and both files exist on disk inside the plugin directory
- **WHEN** the loader parses the manifest
- **THEN** the plugin's `validatedImports` SHALL equal `["lightbox.js", "sub/helper.js"]` (normalized, leading `./` stripped, deduplicated)

#### Scenario: Invalid `frontendImports` entries are dropped, not fatal

- **GIVEN** a `plugin.json` with `frontendImports: ["good.js", "../escape.js", "bad.txt"]` and only `good.js` exists on disk
- **WHEN** the loader parses the manifest
- **THEN** the plugin SHALL load successfully, `validatedImports` SHALL equal `["good.js"]`, and two `log.warn` events SHALL be emitted (one per dropped entry)
