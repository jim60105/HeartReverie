# settings-migration-aids

## Purpose

Defines schema-level rename and orphan-key migration aids: the `x-previous-names` keyword for property renames and the `x-legacy` namespace for relocating orphan on-disk keys. Both keep the on-disk file write-through clean while never leaking legacy keys to the frontend.

## Requirements

### Requirement: `x-previous-names` rename migration on GET

A schema property MAY declare an `x-previous-names: string[]` keyword listing prior names the property was known by. When `GET /api/plugins/:name/settings` reads `config.json` and finds a value at one of the previous names but not at the current name, the server SHALL move the value to the current name in-memory for the response. The on-disk file SHALL NOT be rewritten by a GET request.

The first subsequent successful `PUT` SHALL persist the migrated layout (the legacy key SHALL NOT be re-written by `PUT`).

The plugin manager SHALL reject a manifest at load time when:

- The same string appears in two different properties' `x-previous-names`
- A property's `x-previous-names` contains the property's own current name
- `x-previous-names` is present but is not an array of strings

#### Scenario: Legacy key value is mapped to new name on GET

- **GIVEN** `config.json` contains `{ "oldName": "value" }`
- **AND** the schema declares `properties.newName.x-previous-names: ["oldName"]`
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** the response body SHALL include `"newName": "value"` and SHALL NOT include `"oldName"`
- **AND** `config.json` SHALL remain unchanged

#### Scenario: Subsequent PUT persists the migrated layout

- **GIVEN** the GET above has returned the migrated payload
- **WHEN** the client sends `PUT /api/plugins/:name/settings` with the migrated payload
- **THEN** `config.json` SHALL be written with the new key only (no `oldName` key remains)

#### Scenario: Conflicting previous-name declarations are rejected

- **GIVEN** two properties each declare `x-previous-names` containing the same string `"shared"`
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL reject the manifest with an error citing both properties

### Requirement: `x-legacy` namespace for orphan keys

A schema MAY declare a top-level `x-legacy: true` flag. When set, any keys present in `config.json` that are not described by the current schema and not matched by any `x-previous-names` SHALL be relocated on disk into a top-level reserved namespace key `x-legacy` (an object) during the next successful `PUT`. The `x-legacy` namespace SHALL NOT be returned by `GET /api/plugins/:name/settings` and SHALL NOT be required by `PUT`.

`PUT` SHALL preserve the `x-legacy` namespace by reading the current file, merging the validated request body, and writing the result with the `x-legacy` object untouched. Legacy keys SHALL NEVER appear in any HTTP response body (neither at the top level nor as `x-legacy.*`).

#### Scenario: Orphan keys are moved into the x-legacy namespace across PUT

- **GIVEN** `config.json` contains a top-level key `"deprecatedAux": "v"` that the schema does not describe
- **AND** the schema has `x-legacy: true`
- **WHEN** the client sends a successful `PUT /api/plugins/:name/settings` with a body that does not mention `deprecatedAux`
- **THEN** the new `config.json` SHALL contain `"x-legacy": { "deprecatedAux": "v" }`
- **AND** the top-level `deprecatedAux` key SHALL NOT remain at the top level

#### Scenario: Legacy keys never leak to the frontend

- **GIVEN** the same setup
- **WHEN** the client sends `GET /api/plugins/:name/settings`
- **THEN** the response body SHALL NOT include `deprecatedAux`
- **AND** the response body SHALL NOT include an `x-legacy` field

#### Scenario: Without `x-legacy`, unknown keys are rejected on PUT

- **GIVEN** the schema does NOT declare `x-legacy: true`
- **AND** the schema sets `additionalProperties: false` at top level
- **WHEN** the client sends a `PUT` with a key not described by the schema
- **THEN** the server SHALL respond with `400` and an `additionalProperties` validation error
