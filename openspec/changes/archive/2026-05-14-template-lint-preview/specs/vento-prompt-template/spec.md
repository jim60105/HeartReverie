## ADDED Requirements

### Requirement: Strict SSTI whitelist forbids set, /set, include, and JS-escape tokens

The Vento template validator (`validateTemplate()`) SHALL classify any of the following tokens as `vento.unsafe-expression` errors and SHALL reject them at PUT-time, plugin-load-time, and render-time alike: `{{ set ... }}`, `{{ /set }}`, `{{ include "..." }}`, and any `{{> jsExpression }}`. The validator SHALL NOT be relaxed to support these constructs in any plugin or main-template context.

#### Scenario: set is rejected

- **WHEN** any consumer invokes `validateTemplate("{{ set x = 1 }}foo{{ /set }}")`
- **THEN** the result includes an offending fragment for `set`
- **AND** any caller passing that template to `PUT /api/templates`, `POST /api/templates/lint`, or `PluginManager.getPromptVariables()` is rejected with an error

#### Scenario: include is rejected

- **WHEN** any consumer invokes `validateTemplate('{{ include "./x.md" }}')`
- **THEN** the result includes an offending fragment for `include`

#### Scenario: JS-escape token is rejected

- **WHEN** any consumer invokes `validateTemplate("{{> someJsExpression() }}")`
- **THEN** the result includes an offending fragment for `{{>`

### Requirement: Lint pipeline uses compile() AST path

The engine SHALL expose `ventoEnv.compile(source, filename?, defaults?): VentoTemplate` (synchronous, parse-only) in its vendor ambient typings, and the lint pipeline SHALL use `compile()` rather than `runString()` (dry-run) to collect parse-time diagnostics. The pipeline SHALL preserve the parsed AST for downstream consumers (variable AST walk, future lint rules).

#### Scenario: compile() catches parse-time SourceError

- **GIVEN** a template that includes nested `{{ message }}` blocks
- **WHEN** the lint pipeline calls `ventoEnv.compile(source, "<lint>")` (sync)
- **THEN** the call throws a `SourceError` whose `name === "SourceError"`
- **AND** the lint pipeline maps this to a `vento.message-nested` diagnostic

#### Scenario: compile() does not invoke filesystem IO

- **WHEN** the lint pipeline parses a template referencing variables it does not have
- **THEN** the call throws a parse error OR returns an AST (no execution)
- **AND** no filesystem reads occur outside `writer/vendor` and the in-memory source

### Requirement: Lore passage templates are lintable via lore: path

The lint and preview pipelines SHALL accept template paths of the form `lore:global:<rel>`, `lore:series:<series>:<rel>`, and `lore:story:<series>:<story>:<rel>`, mirroring the three lore scopes resolved by `resolveLoreVariables()`. The variable catalog for `lore:` paths SHALL contain ONLY first-pass snapshot variables (`lore_*` + `series_name` + `story_name`) and SHALL NOT include plugin promptFragment variables, mirroring the engine's actual lore render order.

#### Scenario: Lore lint uses first-pass catalog

- **WHEN** the caller posts `POST /api/templates/lint` with `templatePath: "lore:series:demo:characters/alice.md"`
- **THEN** the variable catalog used for `vento.unknown-variable` checks contains `lore_*`, `series_name`, and `story_name`
- **AND** does NOT contain any plugin-fragment variable
- **AND** does NOT contain `user_input`, `previous_context`, or `plugin_fragments`

#### Scenario: Lore preview returns markdown body, not messages

- **WHEN** the caller posts `POST /api/templates/preview` with `templatePath: "lore:series:demo:characters/alice.md"`
- **THEN** the response `kind` is `"markdown"`
- **AND** `content` contains the rendered markdown string
- **AND** the response does NOT contain a `messages[]` array

### Requirement: Documentation removes set / include examples

The `docs/prompt-template.md` document SHALL NOT contain examples that use `{{ set ... }}`, `{{ /set }}`, or `{{ include "..." }}`. The document SHALL contain a top-level warning that these constructs are forbidden, with guidance to use named variables, plugin `promptFragments`, or `getDynamicVariables()` instead.

#### Scenario: Forbidden examples are absent

- **WHEN** a reader greps `docs/prompt-template.md` for `{{ set ` or `{{ include `
- **THEN** no occurrences are found

#### Scenario: Warning paragraph present

- **WHEN** a reader opens `docs/prompt-template.md`
- **THEN** there is a paragraph explicitly stating that `set` / `/set` / `include` are not supported and pointing to the alternative injection mechanisms

### Requirement: chapter_number is catalog-visible

The lint variable catalog SHALL include `chapter_number` (type `number`, source `core`) for `kind: "system"` and `kind: "plugin-fragment"`. The engine injects `chapter_number` into the render context for plugin promptFragments (see `writer/lib/template.ts:renderPromptFragments`); listing it as a core variable prevents false-positive `vento.unknown-variable` diagnostics in plugin fragments that legitimately reference it (for example `context-compaction/chapter-summary-instruction.md`).

#### Scenario: Plugin-fragment lint catalog includes chapter_number

- **GIVEN** a plugin promptFragment whose source references `{{ chapter_number }}`
- **WHEN** `POST /api/templates/lint` runs against that fragment
- **THEN** the response `diagnostics[]` does not contain a `vento.unknown-variable` warning naming `chapter_number`

#### Scenario: Preview fixture defaults chapter_number to 1

- **WHEN** `fixtureToContext({})` is invoked with an empty fixture
- **THEN** the returned context contains `chapter_number: 1`
- **AND** `injected[]` lists `"chapter_number"`
