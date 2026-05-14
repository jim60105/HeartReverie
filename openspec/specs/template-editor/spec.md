# template-editor Specification

## Purpose
TBD - created by archiving change template-lint-preview. Update Purpose after archive.
## Requirements
### Requirement: Templates listing endpoint

The system SHALL provide `GET /api/templates` returning all editable / inspectable template references including the engine system prompt, every plugin promptFragment, and every lore passage, each carrying an `editable` flag.

#### Scenario: Returns engine system prompt, plugin fragments, and lore passages

- **GIVEN** the engine container is running with at least one plugin contributing `promptFragments` and a story with lore files
- **WHEN** the caller `GET /api/templates` with a valid passphrase
- **THEN** the response contains a `templates: TemplateRef[]` array
- **AND** each `TemplateRef` has fields `{ id, label, path, kind, pluginName?, loreScope?, editable, sizeBytes }`
- **AND** `kind` is one of `"system" | "plugin-fragment" | "lore"`
- **AND** plugin-fragment entries have `editable === false`
- **AND** system and lore entries have `editable === true`

#### Scenario: Rejects unauthenticated request

- **WHEN** the caller `GET /api/templates` without a valid passphrase
- **THEN** the response status is `401`

#### Scenario: Lists every lore passage regardless of loaded story

- **GIVEN** playground contains `_lore/world.md`, `series-a/_lore/character/alice.md`, and `series-a/story-1/_lore/scene/opening.md`
- **WHEN** the caller `GET /api/templates` (with or without `series`/`story` query parameters)
- **THEN** `entries[]` includes all three with `templatePath` values
  `lore:global:world.md`, `lore:series:series-a:character/alice.md`, and `lore:story:series-a:story-1:scene/opening.md`
- **AND** directories whose name starts with `_` or equals `lost+found` are skipped
- **AND** CJK series/story directory names (e.g. `艾爾瑞亞`) are walked and listed

### Requirement: Template source read endpoint

The system SHALL provide `GET /api/templates/source?templatePath=<path>` returning `{ templatePath, source }` for any template kind enumerated by `GET /api/templates` (system, plugin-fragment, lore). The endpoint SHALL be read-only and SHALL apply the same path-safety rules as `PUT /api/templates`. Plugin-fragment paths SHALL be readable (so the editor can show their contents in the read-only view) even though `PUT` refuses them with `403`. For files that do not yet exist on disk the endpoint SHALL return `source: ""` (HTTP 200) rather than `404`, so the editor can offer the user a blank buffer for a not-yet-created `system.md` or lore file.

#### Scenario: Reads existing template source

- **GIVEN** `system.md` already exists with content "Hello"
- **WHEN** the caller `GET /api/templates/source?templatePath=system.md` with a valid passphrase
- **THEN** the response is `{ templatePath: "system.md", source: "Hello" }`

#### Scenario: Returns empty source for missing file

- **GIVEN** `system.md` (PROMPT_FILE) does not exist
- **AND** `ROOT_DIR/system.md` (engine default) also does not exist
- **WHEN** the caller `GET /api/templates/source?templatePath=system.md`
- **THEN** the response status is `200` and `source` is `""`

#### Scenario: Falls back to engine default system.md

- **GIVEN** `system.md` (PROMPT_FILE) does not exist
- **AND** `ROOT_DIR/system.md` exists with content "Default"
- **WHEN** the caller `GET /api/templates/source?templatePath=system.md`
- **THEN** the response is `{ templatePath: "system.md", source: "Default" }`
- **AND** `GET /api/templates` reports the system entry with `sizeBytes === byteLength("Default")`

#### Scenario: Reads plugin-fragment source even though PUT is forbidden

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:fragments/think.md`
- **THEN** the response status is `200` and `source` contains the fragment file contents

#### Scenario: Rejects path-traversal attempts

- **WHEN** the caller `GET /api/templates/source?templatePath=lore:global:../../etc/passwd`
- **THEN** the response status is `400`

### Requirement: Variable catalog introspection endpoint

The system SHALL provide `GET /api/templates/variables?series=&story=` returning a flat list of available template variables drawn from (a) the engine core variable set, (b) plugin `promptFragments[].variable` declarations from manifests, (c) plugin `parameters` declarations from manifests, (d) plugin `getDynamicVariables()` runtime returns, and (e) lore `lore_*` variables. Plugin **manifest-declared** variables ((b)+(c)) SHALL always be returned regardless of `series`/`story`. Plugin **runtime dynamic** variables ((d)) and lore variables ((e)) SHALL be returned ONLY when both `series` and `story` query params are provided and resolve to an existing story; otherwise those sources SHALL be omitted (catalog SHALL NOT execute `getDynamicVariables()` without context). Runtime dynamic variable collection SHALL isolate per-plugin errors: a throwing plugin SHALL produce a `warnings[]` entry naming the plugin and SHALL NOT prevent the catalog from returning.

#### Scenario: Returns merged catalog with source attribution

- **GIVEN** plugins contributing fragment variables and dynamic variables exist
- **WHEN** the caller `GET /api/templates/variables?series=demo&story=ch01`
- **THEN** the response `variables[]` contains entries with `{ name, type, source, pluginName? }`
- **AND** `source` is one of `"core" | "lore" | "plugin-fragment" | "plugin-dynamic" | "vento-helper"`
- **AND** core variables (`previous_context`, `user_input`, `isFirstRound`, `series_name`, `story_name`, `chapter_number`, `plugin_fragments`) appear with `source: "core"`
- **AND** lore variables `lore_<tag>` appear with `source: "lore"`

#### Scenario: Returns manifest-only catalog without series

- **WHEN** the caller `GET /api/templates/variables` without `series`/`story` params
- **THEN** the response contains core + plugin-fragment (manifest) + plugin-parameters entries
- **AND** does NOT include `plugin-dynamic` runtime entries
- **AND** does NOT include lore entries

#### Scenario: Throwing plugin does not block catalog

- **GIVEN** plugin A's `getDynamicVariables()` throws
- **WHEN** the caller `GET /api/templates/variables?series=demo&story=ch01`
- **THEN** the response `warnings[]` contains an entry naming plugin A
- **AND** variables from sibling plugins still appear in `variables[]`

### Requirement: Template lint endpoint

The system SHALL provide `POST /api/templates/lint` accepting `{ templatePath, source, series?, story? }` and returning a `diagnostics: Diagnostic[]` array, where each diagnostic has `{ ruleId, severity, line, column, message }`. The lint pipeline SHALL parse the template via `ventoEnv.compile(source)` and SHALL NOT execute (`runString`) the template.

#### Scenario: Returns parse error for malformed template

- **WHEN** the caller posts `{ source: "{{ for x of }}", templatePath: "system.md" }`
- **THEN** `diagnostics[]` contains a diagnostic with `ruleId === "vento.parse-error"` and `severity === "error"`
- **AND** the diagnostic includes line/column information

#### Scenario: Returns unsafe-expression error for forbidden tokens

- **WHEN** the caller posts a source containing `{{ set x = ... }}`, `{{ include "./x.md" }}`, or `{{> jsExpression }}`
- **THEN** `diagnostics[]` contains a `vento.unsafe-expression` error
- **AND** the diagnostic message includes a remediation hint pointing to named variables / plugin promptFragments / `getDynamicVariables()`

#### Scenario: Returns message-nested error for nested message blocks

- **WHEN** the caller posts a source containing nested `{{ message }}` blocks
- **THEN** `diagnostics[]` contains a `vento.message-nested` error captured at parse time

#### Scenario: Returns unknown-variable warning

- **WHEN** the source references a variable not in the catalog
- **THEN** `diagnostics[]` contains a `vento.unknown-variable` warning (not error)
- **AND** the warning does NOT block save in the UI

#### Scenario: Returns long-template error

- **WHEN** the source exceeds 500,000 characters
- **THEN** `diagnostics[]` contains a single `vento.long-template` error and no parse is attempted

### Requirement: Template preview endpoint with three fixture modes

The system SHALL provide `POST /api/templates/preview` accepting `{ templatePath, source, fixture: "default" | "current" | object, series?, story? }` and returning a discriminated-union response:

- For `templatePath === "system.md"` (or overrides): `{ kind: "messages", messages, variables, ventoError?, fixtureUsed }` — full system prompt rendered to `messages[]`.
- For `templatePath` beginning with `plugin:` or `lore:`: `{ kind: "markdown", content, variables, ventoError?, fixtureUsed }` — the fragment rendered as a standalone Vento string (no message-tag composition, no `no-user-message` enforcement).

The `default` and inline (object) fixture modes SHALL execute pure-Vento rendering without contacting `pluginManager`, `storyDir`, or `PLAYGROUND_DIR`. The `current` mode SHALL reuse the existing `buildPromptFromStory()` pipeline for `system.md`, or render the fragment in isolation with the live first-pass lore snapshot for `lore:` paths.

#### Scenario: system.md default fixture renders messages without IO

- **GIVEN** the engine's bundled `writer/fixtures/template-preview.json` exists
- **WHEN** the caller posts `{ source: "{{ message \"user\" }}{{ user_input }}{{ /message }}", fixture: "default", templatePath: "system.md" }`
- **THEN** the response `kind` is `"messages"`
- **AND** `messages[]` contains at least one entry with role and content
- **AND** the server log shows no filesystem reads under `playground/` or plugin directories

#### Scenario: Plugin fragment preview returns markdown shape

- **WHEN** the caller posts `{ source: "Hello {{ user_input }}", fixture: "default", templatePath: "plugin:thinking:fragments/think.md" }`
- **THEN** the response `kind` is `"markdown"`
- **AND** `content` contains the rendered fragment text
- **AND** the response does NOT contain a `messages[]` array
- **AND** no `vento.no-user-message` error is raised

#### Scenario: Lore preview returns markdown shape

- **WHEN** the caller posts `{ source, fixture: "default", templatePath: "lore:series:demo:characters/alice.md" }`
- **THEN** the response `kind` is `"markdown"`
- **AND** `content` is the rendered passage body

#### Scenario: Inline fixture accepts user JSON override

- **WHEN** the caller posts `{ source, fixture: { user_input: "test" }, templatePath: "system.md" }`
- **THEN** the response renders using the inline fixture's variable values
- **AND** does NOT trigger plugin `getDynamicVariables()` or lore resolution

#### Scenario: Current mode requires series and story for system.md

- **WHEN** the caller posts `{ source, fixture: "current", templatePath: "system.md" }` without `series`/`story`
- **THEN** the response status is `400`
- **AND** the response body identifies the missing parameters

#### Scenario: Current mode renders against real story

- **WHEN** the caller posts `{ source, fixture: "current", templatePath: "system.md", series: "demo", story: "ch01" }`
- **THEN** the response renders using `buildPromptFromStory("demo", "ch01")`
- **AND** invokes plugin `getDynamicVariables` and lore resolution

#### Scenario: Auto-injected fixture fields reported

- **WHEN** the fixture is missing `previous_context`
- **THEN** the response `variables.injected[]` lists `"previous_context"` as auto-defaulted

### Requirement: Template write endpoint with atomic write and backup

The system SHALL provide `PUT /api/templates` accepting `{ templatePath, source }`. The handler SHALL invoke `validateTemplate(source)`; on non-empty result return `422` with `{ expressions: string[] }`. The handler SHALL refuse any `templatePath` starting with `plugin:` with status `403`. On success the handler SHALL write atomically (temp file + rename) and create a `.bak` backup before overwriting an existing file.

#### Scenario: Plugin-fragment write returns 403

- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "plugin:thinking:fragments/think.md"` and any `source`
- **THEN** the response status is `403`
- **AND** the plugin's fragment file on disk is unchanged

#### Scenario: SSTI violation returns 422

- **WHEN** the caller posts `PUT /api/templates` with `source` containing `{{> dangerousJs }}`
- **THEN** the response status is `422`
- **AND** the response body contains `expressions: string[]` with the offending fragment(s)
- **AND** the target file is unchanged

#### Scenario: Successful write creates backup

- **GIVEN** `system.md` already exists with old content
- **WHEN** the caller posts a valid PUT
- **THEN** the response is `200` with `{ ok: true, backupPath: "<target>.bak" }`
- **AND** `system.md.bak` contains the previous content
- **AND** `system.md` contains the new content

#### Scenario: Subsequent write rotates backup

- **GIVEN** `system.md.bak` already exists from a prior write
- **WHEN** a second PUT succeeds
- **THEN** the new backup is named `system.md.bak.<timestamp>`
- **AND** the original `.bak` is preserved

#### Scenario: Symlink target is rejected

- **WHEN** `templatePath` resolves to a symlink (verified by `Deno.lstat`)
- **THEN** the response status is `400`
- **AND** the symlink is not followed

#### Scenario: Concurrent writes do not corrupt file

- **WHEN** two PUTs with different sources race against the same `templatePath`
- **THEN** the final file contents are byte-for-byte equal to exactly one of the two sources
- **AND** the `.bak` (or `.bak.<ts>`) contains the prior version

### Requirement: Template editor UI route

The system SHALL register the route `/settings/template-editor` rendering a three-pane layout (templates list, editor, preview) using CodeMirror 6 with a Vento-aware StreamLanguage. The page SHALL gate save on lint errors, allow save with warnings (toast only), and present a two-step confirmation modal before switching the preview fixture to `"current"`.

#### Scenario: Page renders three panes

- **WHEN** the user navigates to `/settings/template-editor` after entering a valid passphrase
- **THEN** the page renders a templates tree (engine, plugin-fragment, lore groups), a CodeMirror editor, and a preview panel
- **AND** plugin-fragment entries display a "唯讀" (read-only) badge and no save button

#### Scenario: Editor debounces lint and preview on keystroke

- **GIVEN** the editor has a template loaded
- **WHEN** the user types into the editor
- **THEN** after 300 ms of inactivity the page calls `POST /api/templates/lint`, and after 500 ms `POST /api/templates/preview`
- **AND** preview is skipped when lint returns any error-severity diagnostic

#### Scenario: Save blocked on lint error

- **GIVEN** the editor buffer contains a parse error
- **WHEN** the user clicks Save
- **THEN** the page shows a toast "請先修復 N 個錯誤"
- **AND** does NOT call `PUT /api/templates`

#### Scenario: Save allowed with warning

- **GIVEN** the editor buffer has lint warnings but no errors
- **WHEN** the user clicks Save
- **THEN** the page shows a toast with the warning count
- **AND** calls `PUT /api/templates` after the user confirms the diff modal

#### Scenario: Current-fixture switch requires confirmation

- **WHEN** the user toggles preview fixture to `"current"`
- **THEN** a modal asks "將從磁碟載入章節，僅在記憶體渲染、不寫回任何檔案"
- **AND** the fixture change applies only after the user confirms

### Requirement: Bundled default fixture

The engine SHALL ship a `writer/fixtures/template-preview.json` fixture inside the container image, containing at minimum `series_name`, `story_name`, `user_input`, `isFirstRound: false`, `previous_context[]`, `lore`, and `pluginVariables` keys with representative example values.

#### Scenario: Fixture file is present after build

- **WHEN** the engine container is built and started
- **THEN** the path `writer/fixtures/template-preview.json` exists inside the container
- **AND** the file is valid JSON parseable by `JSON.parse`
- **AND** loading it does not require additional permissions beyond `--allow-read`

### Requirement: Vento helper drift CI check

The repository SHALL ship `scripts/check-vento-helpers.ts` which compares the `VENTO_HELPERS` const exported from `reader-src/src/lib/template.ts` against the actual filter set registered on `ventoEnv` and SHALL exit non-zero when the set difference is non-empty.

#### Scenario: Matching sets pass

- **GIVEN** `VENTO_HELPERS` lists exactly the filters registered on `ventoEnv`
- **WHEN** CI runs `deno task check:vento-helpers`
- **THEN** the script exits with status `0`

#### Scenario: Missing helper fails CI

- **GIVEN** `ventoEnv` registers a new filter `foo` not in `VENTO_HELPERS`
- **WHEN** CI runs the check script
- **THEN** the script exits non-zero
- **AND** the output names the missing helper

### Requirement: Path-safety helper exported for reuse

The engine SHALL expose `isPathContained(base: string, candidate: string): boolean` from `writer/lib/path-safety.ts`, callable by both the plugin manager and the templates route. The helper SHALL return `false` whenever `candidate` escapes `base`, including via `..` segments and via absolute-path injection.

#### Scenario: Path within base returns true

- **GIVEN** `base = "/app/plugins"` and `candidate = "/app/plugins/thinking/fragments/x.md"`
- **WHEN** the caller invokes `isPathContained(base, candidate)`
- **THEN** the result is `true`

#### Scenario: Traversal returns false

- **GIVEN** `candidate = "/app/plugins/../etc/passwd"`
- **WHEN** the caller invokes `isPathContained(base, candidate)`
- **THEN** the result is `false`

