## ADDED Requirements

### Requirement: Vento editor is a shared, reusable component

The CodeMirror 6 Vento editor previously bundled inline as `reader-src/src/components/TemplateEditor.vue` SHALL be exposed as a standalone, prop-driven Vue component at `reader-src/src/components/VentoCodeEditor.vue`. The component SHALL be the single source of truth for the Vento editing experience and SHALL be consumed by every page that edits Vento content — `/settings/template-editor` (via `TemplateEditorPage.vue`), `/settings/prompt-editor` (via `PromptEditorMessageCard.vue`), and `/settings/lore` (via `lore/LoreEditor.vue`).

The component's external surface SHALL include:

- **Inputs** (props): `source: string`, `templatePath?: string` (real on-disk path for the Template Editor page; omitted by host sites that use the source-form lint request), `variables: VariableEntry[]`, `readOnly?: boolean`, `series?: string`, `story?: string`, `minLines?: number` (default `3`), `maxLines?: number` (default `30`), `enableSaveShortcut?: boolean` (default `false`).
- **Outputs** (emits): `update:source` (string payload of the current buffer), `lint` (array of `Diagnostic` payloads), `save-request` (no payload, emitted on `Mod-s` ONLY when `enableSaveShortcut` is `true`).
- **Exposed methods** (via `defineExpose`): `focus(): void`, `insertAtCursor(text: string): void`. The component SHALL NOT expose the raw `EditorView` or any other CodeMirror internal — hosts mutate the buffer only through these narrow methods.
- **Behaviour**: Vento language support, autocomplete via `ventoCompletions`, hover docs, lint diagnostics (using either `{ templatePath, source }` when `templatePath` is provided OR the source-form `{ kind, source, ... }` request otherwise), the theme-reactive `ventoHighlightStyle`, the theme-tokenised gutter styles, and a `Mod-s` keymap that is enabled only when `enableSaveShortcut` is `true`. Editor host `<div>` height SHALL be `min(content-line-count, maxLines)` lines with `min-height` of `minLines` lines; content beyond `maxLines` scrolls inside the editor. No file-tree, preview modal, save toolbar, or page chrome SHALL live inside this component — those belong to host pages.

The original `TemplateEditor.vue` file MAY be renamed in place to `VentoCodeEditor.vue`. `TemplateEditorPage.vue` SHALL be updated to import the renamed component; no behaviour observable through the `template-editor` capability's other requirements changes as a result.

#### Scenario: Three call sites import the same component

- **WHEN** a reader greps `reader-src/src/components/` for imports of `VentoCodeEditor`
- **THEN** the matches include `TemplateEditorPage.vue`, `PromptEditorMessageCard.vue`, and `lore/LoreEditor.vue`
- **AND** no other Vue Single File Component in `reader-src/src/components/` constructs its own `EditorView` from `@codemirror/view` to host Vento content

#### Scenario: Component is prop-driven and emits update:source

- **GIVEN** a host mounts `<VentoCodeEditor :source="value" template-path="..." :variables="[]" @update:source="(v) => value = v" />`
- **WHEN** the user types `hello`
- **THEN** the host's `value` ref SHALL update to `"hello"`
- **AND** the component SHALL emit one `lint` event after the debounced lint completes

#### Scenario: readOnly prop disables editing

- **GIVEN** `<VentoCodeEditor :source="..." :read-only="true" ... />`
- **WHEN** the user attempts to type into the editor
- **THEN** the buffer SHALL NOT change and no `update:source` SHALL be emitted

#### Scenario: insertAtCursor inserts at the current selection

- **GIVEN** a `VentoCodeEditor` is mounted and focused with the caret at offset N
- **WHEN** the host calls `editorRef.value.insertAtCursor("{{ user_input }}")`
- **THEN** the editor buffer SHALL contain `{{ user_input }}` inserted at offset N (content before N preserved, content from N onward pushed right)
- **AND** the caret SHALL be at offset N + length-of-inserted-text
- **AND** the editor SHALL emit one `update:source` with the new buffer

#### Scenario: Mod-s is gated by enableSaveShortcut

- **GIVEN** `<VentoCodeEditor ... :enable-save-shortcut="false" />` (the default)
- **WHEN** the user presses `Mod-s` while the editor has focus
- **THEN** the editor SHALL NOT emit `save-request`
- **AND** the editor SHALL NOT call `preventDefault` on the key event

- **GIVEN** `<VentoCodeEditor ... :enable-save-shortcut="true" />`
- **WHEN** the user presses `Mod-s` while the editor has focus
- **THEN** the editor SHALL emit `save-request` exactly once and call `preventDefault` on the key event

#### Scenario: maxLines triggers internal scrolling

- **GIVEN** `<VentoCodeEditor ... :max-lines="10" />`
- **WHEN** the editor renders source containing 30 newline-separated lines
- **THEN** the editor host `<div>` SHALL have a height equivalent to 10 lines
- **AND** the additional 20 lines SHALL be reachable via the editor's internal scrollbar

#### Scenario: Theme switch retints highlight and gutters live

- **GIVEN** the user is editing in a `VentoCodeEditor` mounted on any of the three host pages
- **WHEN** the active theme changes from `default` to `light`
- **THEN** the Vento token colours SHALL re-resolve to the new theme's CSS variables WITHOUT remounting the EditorView or swapping a CodeMirror Compartment
- **AND** the gutter (`.cm-gutters`), active-line gutter, and line-number cells SHALL update to the new theme tokens

## MODIFIED Requirements

### Requirement: Variable catalog introspection endpoint

The system SHALL provide `GET /api/templates/variables?kind=&series=&story=&pluginName=` returning a flat list of available template variables drawn from (a) the engine core variable set, (b) plugin `promptFragments[].variable` declarations from manifests, (c) plugin `parameters` declarations from manifests, (d) plugin `getDynamicVariables()` runtime returns, and (e) lore `lore_*` variables. The `kind` query parameter SHALL accept `system | plugin-fragment | lore | prompt-message-body`; when omitted, it defaults to `system` (back-compat with pre-existing callers). The catalog returned SHALL match what `buildVariableCatalog(kind, { series, story, pluginName })` produces for the engine's own lint pipeline. Specifically:

- `kind=system` (default) and `kind=prompt-message-body`: core + plugin-fragment (manifest) + plugin-parameters + (when `series`+`story` resolve to an existing story) plugin-dynamic + lore.
- `kind=lore`: core-lore subset only — `lore_<tag>` for every tag resolved from the supplied `series`+`story`, plus `series_name` and `story_name`. NO plugin variables, NO `user_input`/`previous_context`/`isFirstRound`/`plugin_fragments`/`chapter_number`.
- `kind=plugin-fragment`: core + plugin-fragment + plugin-parameters + plugin-dynamic (for the named `pluginName`, when supplied).

Plugin **manifest-declared** variables ((b)+(c)) SHALL always be returned for kinds `system` / `prompt-message-body` / `plugin-fragment` regardless of `series`/`story`. Plugin **runtime dynamic** variables ((d)) and lore variables ((e)) SHALL be returned ONLY when both `series` and `story` query params are provided and resolve to an existing story; otherwise those sources SHALL be omitted (catalog SHALL NOT execute `getDynamicVariables()` without context). Runtime dynamic variable collection SHALL isolate per-plugin errors: a throwing plugin SHALL produce a `warnings[]` entry naming the plugin and SHALL NOT prevent the catalog from returning.

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

#### Scenario: kind=lore returns the restricted lore catalog

- **GIVEN** the story `demo/intro` resolves lore tags `character` and `scenario`
- **WHEN** the caller `GET /api/templates/variables?kind=lore&series=demo&story=intro`
- **THEN** the response `variables[]` contains `lore_character`, `lore_scenario`, `series_name`, `story_name`
- **AND** does NOT contain any `source: "plugin-fragment"` or `source: "plugin-dynamic"` entry
- **AND** does NOT contain `user_input`, `previous_context`, `isFirstRound`, `plugin_fragments`, or `chapter_number`

#### Scenario: kind=prompt-message-body returns the system catalog

- **WHEN** the caller `GET /api/templates/variables?kind=prompt-message-body&series=demo&story=intro`
- **THEN** the response `variables[]` matches what `kind=system` would return for the same `series`/`story`

#### Scenario: Throwing plugin does not block catalog

- **GIVEN** plugin A's `getDynamicVariables()` throws
- **WHEN** the caller `GET /api/templates/variables?series=demo&story=ch01`
- **THEN** the response `warnings[]` contains an entry naming plugin A
- **AND** variables from sibling plugins still appear in `variables[]`

### Requirement: Template lint endpoint

The system SHALL provide `POST /api/templates/lint` accepting EITHER of two request shapes:

1. **Path-form**: `{ templatePath, source, series?, story? }` — used by the Template Editor page for templates that live on disk (system.md, plugin fragments, lore files). `templatePath` is parsed by `parseTemplatePath()`; the lint kind is inferred from the path prefix.
2. **Source-form**: `{ kind, source, series?, story?, scope?, role?, pluginName? }` — used by hosts that mount the shared editor on virtual / in-memory content (prompt-editor message cards, lore drafts). The route SHALL skip `parseTemplatePath` entirely when `templatePath` is absent. The `kind` field SHALL be one of `system | plugin-fragment | lore | prompt-message-body`. For `kind=lore`, `scope` SHALL be `global | series | story` and `series`/`story` SHALL be provided as the scope requires. For `kind=plugin-fragment`, `pluginName` SHALL be provided. For `kind=prompt-message-body`, `role` SHALL be one of `system | user | assistant` and the lint pipeline SHALL synthesize a parse buffer equal to `{{ message "<role>" }}\n${source}\n{{ /message }}` before invoking `ventoEnv.compile()`. Diagnostics whose offset falls inside the synthetic wrapper SHALL be dropped from the response, and all remaining diagnostics SHALL have their line/column offsets translated back so they reference positions in the original user-supplied `source` (not the wrapped buffer).

Both shapes return the same `diagnostics: Diagnostic[]` payload. Each diagnostic has `{ ruleId, severity, line, column, message }`. The lint pipeline SHALL parse the template via `ventoEnv.compile()` and SHALL NOT execute (`runString`) the template.

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

#### Scenario: Source-form lint with kind=lore uses the lore catalog

- **GIVEN** the story `demo/intro` resolves lore tags `character` only
- **WHEN** the caller posts `{ kind: "lore", scope: "story", series: "demo", story: "intro", source: "{{ lore_weapon }}" }`
- **THEN** `diagnostics[]` contains one `vento.unknown-variable` warning naming `lore_weapon`
- **AND** the same source posted with `kind: "system"` would NOT produce that warning (because `lore_weapon` exists in the system catalog when the story resolves it as a tag; the point here is that the lore scope excludes plugin and engine variables, not the converse)

#### Scenario: Source-form lint with kind=prompt-message-body detects nested message tag

- **WHEN** the caller posts `{ kind: "prompt-message-body", role: "system", source: "{{ message \"user\" }}foo{{ /message }}" }`
- **THEN** the backend SHALL synthesize the parse buffer `{{ message "system" }}\n{{ message "user" }}foo{{ /message }}\n{{ /message }}`
- **AND** `diagnostics[]` contains a `vento.message-nested` error whose `line`/`column` reference the user-typed `{{ message "user" }}` token in the original `source` (not the synthetic wrapper)

#### Scenario: Source-form lint without role rejects prompt-message-body

- **WHEN** the caller posts `{ kind: "prompt-message-body", source: "anything" }` without `role`
- **THEN** the response status is `400`
- **AND** the error body identifies the missing `role` field
