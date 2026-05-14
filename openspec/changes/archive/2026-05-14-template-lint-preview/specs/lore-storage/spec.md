## ADDED Requirements

### Requirement: Lore passages support lint and preview via lore: path

The lore storage layer SHALL be reachable from the templates route through three address forms:

- `lore:global:<rel>` resolving to `${PLAYGROUND_DIR}/_lore/<rel>`
- `lore:series:<series>:<rel>` resolving to `${PLAYGROUND_DIR}/<series>/_lore/<rel>`
- `lore:story:<series>:<story>:<rel>` resolving to `${PLAYGROUND_DIR}/<series>/<story>/_lore/<rel>`

The scope identifier (`global` / `series` / `story`) SHALL match the three scopes enumerated by `resolveLoreVariables()`. `<series>` and `<story>` segments SHALL reject `:`, `/`, `\`, NUL, `..`, a leading `_`, and the reserved name `lost+found`; other Unicode characters (e.g. CJK series names like `艾爾瑞亞`) ARE permitted because they round-trip through `Deno.readDir` and the existing playground tooling. `<rel>` SHALL be subject to `isPathContained` + `Deno.realPath` containment under the corresponding scope root and SHALL reject `..` traversal.

#### Scenario: Known scope and safe path resolves

- **GIVEN** `playground/demo/_lore/character/alice.md` exists
- **WHEN** the templates route resolves `templatePath: "lore:series:demo:character/alice.md"`
- **THEN** the resolved absolute path is `${PLAYGROUND_DIR}/demo/_lore/character/alice.md`

#### Scenario: Unknown scope is rejected

- **WHEN** the templates route receives `templatePath: "lore:bogus-scope:x.md"`
- **THEN** the response status is `400`
- **AND** the response body identifies the unknown scope

#### Scenario: Traversal is rejected

- **WHEN** the templates route receives `templatePath: "lore:series:demo:../../etc/passwd"`
- **THEN** the response status is `400`
- **AND** no file outside the lore directory is touched

### Requirement: Lore lint catalog uses first-pass snapshot variables only

The variable catalog used to check `vento.unknown-variable` for `lore:` template paths SHALL contain only `lore_*` (every tag from `resolveLoreVariables()`), `series_name`, and `story_name`. It SHALL NOT include `previous_context`, `user_input`, `isFirstRound`, `plugin_fragments`, any plugin-fragment-declared variable, or any plugin `parameters` entry. This matches the actual engine render order in which lore is rendered before any plugin fragment.

#### Scenario: Plugin variable in lore template flagged as unknown

- **GIVEN** a plugin declares fragment variable `think_before_reply`
- **WHEN** a lore passage source references `{{ think_before_reply }}`
- **AND** `POST /api/templates/lint` is invoked with `templatePath: "lore:series:demo:..."`
- **THEN** the diagnostic includes `vento.unknown-variable` for `think_before_reply`

#### Scenario: Lore tag variable is recognised

- **GIVEN** the resolved lore tags include `character` and `scenario`
- **WHEN** a lore passage source references `{{ lore_character }}`
- **THEN** no `vento.unknown-variable` diagnostic is emitted for `lore_character`
