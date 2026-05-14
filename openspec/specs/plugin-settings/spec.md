# plugin-settings

## Purpose

Defines the plugin settings storage, API endpoints, schema declaration, and frontend/backend integration contracts for per-plugin configurable settings.

## Requirements

### Requirement: Plugin settings storage

Plugin settings SHALL be stored at `playground/_plugins/<pluginName>/config.json`. The directory SHALL be created on first `PUT` request if it does not already exist. The file SHALL contain valid JSON.

#### Scenario: Settings GET returns defaults when no config exists

- **GIVEN** a plugin declares `settingsSchema` with default values
- **AND** no `config.json` file exists for that plugin
- **WHEN** a client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond with 200 and the default values derived from the schema

#### Scenario: Settings GET returns saved config when it exists

- **GIVEN** a plugin has a saved `config.json`
- **WHEN** a client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond with 200 and the saved configuration values

### Requirement: Plugin settings API endpoints

The server SHALL expose the following endpoints:

- `GET /api/plugins/:name/settings` — returns current settings (merged defaults from schema + saved values from `config.json`), with `writeOnly` fields masked as `null` and any `x-previous-names` migration applied in-memory.
- `PUT /api/plugins/:name/settings` — validates the request body against the plugin's `settingsSchema` using two-phase validation (see "Two-phase validation with `_changedPaths`"), then saves to `config.json`.
- `POST /api/plugins/:name/settings/validate` — runs validation only; never writes (see "`POST /api/plugins/:name/settings/validate` endpoint").
- `GET /api/plugins/:name/settings-schema` — returns the plugin's declared JSON Schema (including all `x-*` keywords) for frontend form generation. Unknown `x-*` keywords MUST be passed through unchanged.
- `GET /api/plugins/:name/settings/schema-meta` — returns server-side metadata about the schema dialect (see "`GET /api/plugins/:name/settings/schema-meta` endpoint").

All endpoints SHALL be protected by the passphrase authentication middleware. All endpoints SHALL return `404` if the plugin does not declare a `settingsSchema`. All endpoints SHALL return `404` when the server is running in reader-only mode. `PUT` failures SHALL use the structured error envelope (see "Structured validation error envelope").

#### Scenario: Settings PUT saves valid config

- **GIVEN** a plugin declares `settingsSchema`
- **WHEN** a client sends `PUT /api/plugins/:name/settings` with a body that passes schema validation (including two-phase validation)
- **THEN** the server SHALL save the validated body (with `_changedPaths` stripped) to `playground/_plugins/<pluginName>/config.json` and respond with `200` and a body of `{ "warnings": [...] }`

#### Scenario: Settings PUT rejects invalid config with 400

- **GIVEN** a plugin declares `settingsSchema`
- **WHEN** a client sends `PUT /api/plugins/:name/settings` with a body whose blocking errors exist
- **THEN** the server SHALL respond with `400` and a body of `{ "errors": [...], "warnings": [...] }` per the structured envelope

#### Scenario: Settings API returns 404 for plugins without settingsSchema

- **WHEN** a client sends `GET /api/plugins/:name/settings` for a plugin that does not declare `settingsSchema`
- **THEN** the server SHALL respond with `404`

### Requirement: Plugin settings schema declaration

Plugins SHALL declare `settingsSchema` in `plugin.json` as a JSON Schema object defining the plugin's configurable settings. The schema SHALL declare a top-level `x-schema-version` integer (see "Mandatory `x-schema-version`"). The plugin manager SHALL validate the schema at load time, including the structural constraints from `conditional-field-visibility`, `settings-migration-aids`, and `path-typed-settings-allowlist`.

The schema SHALL support the keyword set listed in "Extended JSON Schema keyword support" plus the `x-*` extensions documented in this and sibling capabilities. The validator SHALL ignore unknown `x-*` keywords without error (superset policy); the frontend MAY consume them via widget descriptors.

The `description` field SHALL be plain text. The system SHALL NOT support a Markdown variant in phase 1.

#### Scenario: Plugin manager validates schema at load time

- **WHEN** the plugin manager loads a plugin with an invalid `settingsSchema` (any structural violation defined in this or sibling capabilities)
- **THEN** the manager SHALL reject the plugin with a descriptive validation error identifying the offending property path and the failing rule

#### Scenario: Unknown `x-*` keyword passes through

- **GIVEN** a schema declares a custom `x-display-hint: "compact"`
- **WHEN** the manifest is loaded and `GET /api/plugins/:name/settings-schema` is requested
- **THEN** the manager SHALL accept the manifest
- **AND** the response body SHALL include the unchanged `x-display-hint` keyword

### Requirement: Mandatory `x-schema-version`

A plugin's `settingsSchema` SHALL declare a top-level `x-schema-version` integer. Phase 1 SHALL accept only `x-schema-version: 1`. Manifests that omit the keyword SHALL be auto-migrated to `1` at load time with a warning logged once per plugin per process; manifests that declare any value other than `1` SHALL cause the plugin's settings to degrade to schema defaults (the plugin itself continues to load) with `GET /settings` returning the defaults and `PUT /settings` responding `409` with `messageKey: "schema_version_mismatch"`.

#### Scenario: Missing `x-schema-version` auto-migrates with a warning

- **GIVEN** a plugin manifest's `settingsSchema` does NOT declare `x-schema-version`
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL treat the schema as `x-schema-version: 1`
- **AND** log a single warning identifying the plugin name and recommending explicit declaration

#### Scenario: Unsupported `x-schema-version` degrades settings to defaults

- **WHEN** a plugin declares `x-schema-version: 2`
- **THEN** the plugin SHALL continue to load (other lifecycle hooks unaffected)
- **AND** `GET /api/plugins/:name/settings` SHALL respond `200` with the schema's default values
- **AND** `PUT /api/plugins/:name/settings` SHALL respond `409` with a structured envelope whose first error has `messageKey: "schema_version_mismatch"`

### Requirement: Extended JSON Schema keyword support

The validator SHALL implement the following keywords with the semantics described:

- Types: `string`, `number`, `integer`, `boolean`, `array`, `object`, `null`
- Numeric: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- String: `minLength`, `maxLength`, `pattern` (ECMAScript regex), `format` (whitelist below)
- Array: `items`, `minItems`, `maxItems`, `uniqueItems`
- Object: `properties`, `required`, `additionalProperties` (boolean only; phase 1 ignores schema form)
- Composition: `enum`, `const`
- Annotation: `title`, `description`, `default`, `writeOnly`
- UI-only x-keywords (validator MUST ignore): `x-show-when`, `x-options-url`, `x-format`, `x-path-roots`, `x-previous-names`, `x-legacy`, `x-schema-version`

`format` SHALL be limited to the whitelist `{"path", "color", "url", "email", "uuid"}`. Unknown formats SHALL be ignored (no error, no validation). The `path` format SHALL be enforced per the `path-typed-settings-allowlist` capability.

`writeOnly: true` SHALL cause `GET /api/plugins/:name/settings` to mask the field's saved value with `null` in the response body. Other fields SHALL be returned unchanged.

Unknown non-`x-*` keywords SHALL be ignored by the validator but emitted as `info` diagnostics in server logs.

#### Scenario: Unknown `format` is silently accepted

- **GIVEN** a field declares `format: "ipv4"` (not on the whitelist)
- **WHEN** the validator processes a value for that field
- **THEN** the validator SHALL NOT emit a `format` error

#### Scenario: `writeOnly` field is masked in GET response

- **GIVEN** `config.json` contains `{ "apiKey": "sk-abc123" }`
- **AND** the schema declares `properties.apiKey.writeOnly: true`
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** the response body SHALL contain `"apiKey": null`

### Requirement: Structured validation error envelope

`PUT /api/plugins/:name/settings` SHALL return validation failures with HTTP status `400` and a body of the shape:

```
{
  "errors": [ { "path": string, "keyword": string, "messageKey": string, "params": object } ],
  "warnings": [ ... same shape ... ]
}
```

The `warnings` array SHALL always be present (possibly empty) on both `400` and `200` responses, so clients can rely on a stable envelope shape. `path` SHALL be a JSON-Pointer-shaped path within the request body (e.g., `items[0].name`). `keyword` SHALL identify the failing JSON Schema keyword (e.g., `pattern`, `minLength`, `format`, `required`, `enum`). `messageKey` SHALL be a stable identifier suitable for client-side i18n lookup. `params` SHALL contain the keyword's parameters.

The frontend SHALL render the message by looking up `messageKey` in its i18n table; if missing, it SHALL fall back to a generic message including `keyword` and `params`.

#### Scenario: Validation failure includes structured details

- **WHEN** a `PUT` body contains an item whose `name` violates the schema's `pattern`
- **THEN** the `400` response body SHALL contain at least one error with `path` pointing at the violating value, `keyword: "pattern"`, a non-empty `messageKey`, and `params.pattern` equal to the regex source
- **AND** the body SHALL include a `warnings` array (possibly empty)

### Requirement: Two-phase validation with `_changedPaths`

`PUT /api/plugins/:name/settings` SHALL accept an optional `_changedPaths: string[]` field at the top level of the request body. This field SHALL NOT be persisted to `config.json` and SHALL NOT be validated against the user-facing schema. The field's shape SHALL be validated as `string[]`; a malformed `_changedPaths` SHALL produce a `400` with `keyword: "type"` at `path: "_changedPaths"`.

The server SHALL ALWAYS compute the actual diff between the incoming body (with `_changedPaths` stripped) and the on-disk `config.json`. The **blocking scope** SHALL be the union of the actual diff paths and any caller-supplied `_changedPaths`. An error is **blocking** when its `path` is at, or under, a path in the blocking scope (`path === scope` OR `path` starts with `scope` followed by `.` or `[`). All other errors are **warnings**.

When all errors are warnings, the server SHALL persist the validated body (with `_changedPaths` stripped) and respond `200` with `{ "errors": [], "warnings": [...] }`. When any blocking error exists, the server SHALL respond `400` with `{ "errors": [...], "warnings": [...] }` (warnings may be empty) and the file SHALL NOT be written.

#### Scenario: Errors outside the changed scope are demoted to warnings

- **GIVEN** `config.json` already contains an entry with a pre-existing pattern violation at `items[3].name`
- **WHEN** the client sends `PUT` with `_changedPaths: ["items[0]"]` and `items[3]` unchanged from disk
- **THEN** the server SHALL respond `200`
- **AND** the response body SHALL contain a `warnings` array with the `items[3].name` error
- **AND** `errors` SHALL be empty
- **AND** the file SHALL be written

#### Scenario: Errors inside the caller-stated changed scope block the save

- **GIVEN** the same pre-existing state
- **WHEN** the client sends `PUT` with `_changedPaths: ["items[3]"]` and the violation at `items[3].name` unchanged
- **THEN** the server SHALL respond `400` with `errors[0].path = "items[3].name"`
- **AND** the file SHALL NOT be written

#### Scenario: Under-stated `_changedPaths` cannot mask a real change failure

- **GIVEN** `config.json` has a valid `items[0].name = "alice"`
- **WHEN** the client sends `PUT` changing `items[0].name` to an invalid value, but with `_changedPaths: ["unrelated"]`
- **THEN** the server SHALL detect the actual diff at `items[0].name`, add it to the blocking scope
- **AND** respond `400` with `errors[0].path = "items[0].name"`

#### Scenario: Malformed `_changedPaths` is rejected

- **WHEN** the client sends `PUT` with `_changedPaths: "items[0]"` (string, not array)
- **THEN** the server SHALL respond `400` with `errors[0].path = "_changedPaths"` and `errors[0].keyword = "type"`

### Requirement: `POST /api/plugins/:name/settings/validate` endpoint

The server SHALL expose `POST /api/plugins/:name/settings/validate`. The request body SHALL be the candidate settings (same shape as `PUT`). The response SHALL always have HTTP status `200` and a body of the shape `{ "errors": [...], "warnings": [...] }` using the same error envelope as `PUT`. The endpoint SHALL NOT persist anything.

The endpoint SHALL be protected by the passphrase authentication middleware. The endpoint SHALL return `404` when the plugin does not declare `settingsSchema`.

#### Scenario: Validate endpoint never writes config

- **WHEN** a client sends `POST /api/plugins/:name/settings/validate` with any body
- **THEN** `config.json` SHALL NOT be modified

#### Scenario: Validate endpoint returns 200 even on validation failure

- **WHEN** the body fails validation
- **THEN** the response status SHALL be `200`
- **AND** the response body SHALL contain a non-empty `errors` array

### Requirement: `GET /api/plugins/:name/settings/schema-meta` endpoint

The server SHALL expose `GET /api/plugins/:name/settings/schema-meta`. The response body SHALL contain a JSON object with at least:

- `schemaVersion: number` — the manifest's `x-schema-version` (or `1` after auto-migration)
- `pathRoots: string[]` — the effective hard-coded root allowlist for `format: "path"` fields (sandbox roots resolved to repository-relative paths)
- `formats: string[]` — the supported `format` values for this server version

#### Scenario: Schema-meta returns the hard-coded path root list

- **WHEN** a client sends `GET /api/plugins/:name/settings/schema-meta` for any plugin with a schema
- **THEN** the response body's `pathRoots` SHALL be exactly `["playground/lore/", "playground/chapters/", "playground/_plugins/<pluginName>/"]` in the documented order

### Requirement: Plugin settings routes are writer-mode-only

`GET`, `PUT`, `POST /validate`, and `GET /schema-meta` for plugin settings SHALL be served only when the server is running in writer mode (full reader+writer build). When running in reader-only mode, the routes SHALL respond `404`.

#### Scenario: Reader-only deployment hides settings routes

- **GIVEN** the server is configured as reader-only
- **WHEN** a client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond `404`

### Requirement: Legacy disk warnings on GET

`GET /api/plugins/:name/settings` SHALL include an `x-legacy-warnings: ValidationError[]` sibling field whenever the on-disk `config.json` contains values that violate the current schema. The warnings SHALL use the same error shape as the PUT envelope. The presence of legacy warnings SHALL NOT block the GET (status `200`).

The `x-legacy-warnings` field SHALL be omitted (or empty array) when the disk is clean. The field SHALL NOT include errors caused by `x-previous-names`-renamed values that successfully migrated in-memory.

#### Scenario: Legacy disk violation is exposed but does not block GET

- **GIVEN** `config.json` contains `items[2].name = "INVALID-CAPS"` which violates the schema's `pattern`
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** the server SHALL respond `200`
- **AND** the response body SHALL contain `x-legacy-warnings` with at least one error at `path: "items[2].name"`

#### Scenario: Clean disk omits the field

- **GIVEN** `config.json` fully satisfies the schema
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** `x-legacy-warnings` SHALL be absent or an empty array

### Requirement: `writeOnly` rename ordering

When a property declares BOTH `x-previous-names` AND `writeOnly: true`, the server SHALL apply rename migration **first** (moving the legacy key's value to the new name in-memory), then apply `writeOnly` masking (replacing the migrated value with `null` in the GET response). The on-disk file SHALL NOT be modified by GET.

A `PUT` whose value for a renamed `writeOnly` field is `null` SHALL be interpreted as "keep the existing disk value": the server SHALL retain the value at either the new key or any matching `x-previous-names` key (whichever currently holds the value on disk). A subsequent successful save SHALL persist the value under the new key and clear the legacy key.

#### Scenario: Renamed writeOnly field is migrated then masked

- **GIVEN** `config.json` contains `{ "oldApiKey": "sk-secret" }`
- **AND** the schema declares `properties.newApiKey.x-previous-names: ["oldApiKey"]` AND `properties.newApiKey.writeOnly: true`
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** the response body SHALL contain `"newApiKey": null`
- **AND** the response body SHALL NOT contain `"oldApiKey"` or the literal secret value
- **AND** `config.json` SHALL remain unchanged

#### Scenario: PUT null on renamed writeOnly field keeps the legacy value

- **GIVEN** the setup above
- **WHEN** the client sends `PUT` with `{ "newApiKey": null }`
- **THEN** the server SHALL respond `200`
- **AND** the new `config.json` SHALL contain `"newApiKey": "sk-secret"` (migrated from `oldApiKey`)
- **AND** the new `config.json` SHALL NOT contain `oldApiKey`

### Requirement: Plugin API routes

Backend modules MAY export a `registerRoutes(app, basePath)` function. The core SHALL mount these routes at `/api/plugins/:name/` with passphrase authentication middleware applied. This allows plugins to expose custom HTTP endpoints (e.g., proxy to external services).

#### Scenario: Plugin routes are accessible at `/api/plugins/:name/custom-path`

- **GIVEN** a plugin exports a `registerRoutes` function that registers a handler at `/proxy/sd-models`
- **WHEN** a client sends a request to `GET /api/plugins/:name/proxy/sd-models` with a valid passphrase
- **THEN** the server SHALL route the request to the plugin's handler and return its response

#### Scenario: Plugin routes are protected by passphrase

- **GIVEN** a plugin has registered custom routes
- **WHEN** a client sends a request to a plugin route without a valid passphrase
- **THEN** the server SHALL respond with 401

### Requirement: Settings-aware prompt-fragment rendering

`PluginManager.getPromptVariables()` SHALL consult each plugin's resolved settings before including any `manifest.promptFragments[].file` contribution. When the resolved `settings.enabled === false`, every fragment entry for that plugin SHALL resolve to the empty string, including unnamed fragments contributed to `plugin_fragments`.

The same gate SHALL apply inside `PluginManager.getDynamicVariables()`: when the owning plugin's resolved `enabled` is `false`, the engine MUST NOT invoke that plugin's dynamic-variable provider, and any name that provider would have set MUST resolve to its template default (typically empty string).

#### Scenario: Disabled plugin contributes nothing to assembled prompt

- **WHEN** a plugin's resolved `enabled` is `false`
- **AND** the engine assembles a system prompt
- **THEN** none of the plugin's `promptFragments[]` files appear in the rendered output
- **AND** none of the plugin's `getDynamicVariables()` output appears in the rendered output

### Requirement: Frontend `register` context exposes resolved plugin settings

The frontend hook-dispatcher SHALL pass a register context whose shape is `{ register, on, getSettings }` (in addition to any pre-existing fields). `getSettings(name?)` SHALL return a deep-frozen snapshot of the most recently resolved settings for the plugin (or, when called with another plugin's name, that plugin's settings).

The returned snapshot SHALL be synchronous. The dispatcher SHALL update the underlying store on every `plugin-settings:changed` event so subsequent calls within new hook invocations see the latest values.

#### Scenario: Plugin reads its own settings during a frontend-render hook

- **WHEN** a plugin's frontend `register()` runs and calls `context.getSettings()`
- **THEN** the return value is the resolved settings object for that plugin
- **AND** the object is frozen (mutation throws in strict mode / has no effect otherwise)

### Requirement: `plugin-settings:changed` broadcast

A successful `PUT /api/plugins/:name/settings` SHALL cause the reader to emit a `plugin-settings:changed` event with payload `{ name, settings }` on its event bus.

The settings store SHALL refresh its cached entry for `name` from the event payload (no follow-up fetch) and bump the reactive revision counter. The chapter renderer SHALL debounce 50 ms and re-dispatch `frontend-render` and `display-strip-tags` for the currently-mounted chapter when the changed plugin contributes to either hook. The action-button strip SHALL re-fetch `/api/plugins/action-buttons`.

The broadcast SHALL NOT fire for non-2xx PUT responses.

#### Scenario: Settings save triggers re-render

- **WHEN** the user saves new settings on the plugin-settings page
- **AND** the PUT returns 2xx
- **THEN** the chapter view updates within 100 ms without a page reload

### Requirement: Settings-aware action-button visibility

`GET /api/plugins/action-buttons` SHALL filter out every button whose owning plugin's resolved `enabled` is `false`.

The frontend hook dispatcher SHALL additionally no-op every `action-button:click` invocation when the originating plugin's `context.getSettings().enabled` is `false`, as a stale-cache safety net.

#### Scenario: Disabled plugin's button is hidden

- **WHEN** a plugin's `enabled` is `false` and the reader requests action buttons
- **THEN** none of that plugin's buttons appear in the response
