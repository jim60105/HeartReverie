## Why

Plugin authors who want a richer settings UI today have to either (a) ship their own Vue component (not possible for vanilla-ES-module plugins under our `register(hooks)` contract) or (b) accept the seven hard-coded widgets baked into `PluginSettingsPage.vue`. Meanwhile the backend `#validateAgainstSchema` only enforces top-level `required` + bare `typeof` checks: documented bounds like `state.maxDiffEntries.minimum=50` are silently ignored, and `scene-info-sidebar.visibleFields` items are not validated against their declared `items.enum`. The result is a "schema-shaped" contract that neither side honours.

This change converts the existing lightweight schema mechanism into a real schema-driven form engine: a strict-enough backend validator paired with a recursive `<SchemaField>` Vue renderer fed from a widget registry. Plugin authors gain ~10 new widgets (select, multi-select, repeater, nested fieldset, color, masked-secret, file/path picker, range-bounded number, x-show-when conditional visibility, writeOnly placeholder) without writing a single Vue component, while engine-side enforcement finally matches the schemas plugins already declare.

## What Changes

- **BREAKING**: `settingsSchema` MUST declare `x-schema-version: 1` at its root. Missing manifests are auto-migrated in-memory to `v1` with a one-time warn log at startup; unknown major versions cause the plugin's settings to degrade to schema defaults (the plugin itself still loads; the API for that plugin's settings returns the defaults; PUT returns 409 with a migration message).
- **BREAKING**: `PUT /api/plugins/:name/settings` failure response shape changes from `{ error: string }` to `{ title, status, detail, errors: ValidationError[] }` (RFC 7807 + structured per-field errors). The frontend `error.value` string-sniff at `PluginSettingsPage.vue:51` is replaced by inline per-field rendering.
- **BREAKING**: Manifest validation rejects any property that simultaneously appears in `required` and declares `x-show-when` (the field would be hidden but mandatory — an unrecoverable dead-config for users).
- Backend validator extended to enforce: `enum`, `const`, `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`, `minLength`/`maxLength`/`pattern`, `items` (including `items.enum`, `minItems`/`maxItems`/`uniqueItems`), nested `properties` recursion, and a curated `format` whitelist (`path`, `color`, `url`, `email`, `uuid`). Secrets are modeled with `writeOnly: true`, not a `format` value.
- Backend route `POST /api/plugins/:name/settings/validate` added: dry-run validation that returns the same structured `errors[]` without writing.
- Backend route `GET /api/plugins/:name/settings/schema-meta` added: returns the engine's introspection of supported keywords + registered widget kinds so authors can debug.
- `GET /api/plugins/:name/settings` masks `writeOnly` fields with `null` and dispatches a sibling `x-legacy-warnings: ValidationError[]` array describing any disk-resident values that violate the current schema (without blocking the load).
- `PUT /api/plugins/:name/settings` accepts an optional `_changedPaths: string[]` body field. Errors on changed paths are blocking (400); errors on unchanged paths degrade to warnings (200 with `warnings[]`). Without `_changedPaths`, fallback to "strict only on fields whose persisted value actually changed". `null` on a `writeOnly` field is short-circuited to "keep existing value" before any type check.
- `format: "path"` fields are constrained by a hard-coded directory allowlist (`playground/lore/`, `playground/chapters/`, the plugin's own `PLAYGROUND_DIR/_plugins/<pluginName>/`). Plugins MAY narrow further via `x-path-roots: string[]` (intersection-only: never expansion). Empty intersection → all `path` fields rejected for that plugin.
- New frontend recursive `<SchemaField>` + `WidgetRegistry` factory (`createDefaultWidgetRegistry()`) injected via `provide`/`FormContext` (no module-level singleton — testability). Widgets included in phase 1: `select`, `multi-select` (chip-and-checkbox), `tags`, `repeater` (array-of-object), `object-fieldset` (nested object), `color`, `masked-secret`, `range-number`, `path-picker`, `checkbox`, `combobox`, `text`. **Phase 1 does NOT allow plugins to register custom widgets** — that requires a vanilla-DOM widget adapter contract not yet specified; deferred to phase 2.
- `x-show-when` keyword added (sibling-scoped, declarative): `{ field, equals|notEquals|in }`. Pure UI behaviour; the validator ignores it. Hidden fields retain their model value (no auto-clear).
- `x-previous-names: string[]` keyword added: on GET, if the legacy key exists and the new key doesn't, value is silently migrated; subsequent PUT clears the legacy key. Dropped-field values are preserved under an `x-legacy` namespace inside the on-disk `config.json`.
- `PluginSettingsPage.vue` UI: replace the single "儲存設定" button with `儲存 / 取消 / 重設為預設值`, an "unsaved changes" badge derived from `originalSettings` vs `settings`, and a collapsible diff panel.
- Settings UI route (`/settings/plugins/*`) becomes **writer-mode-only**. Reader-mode hits the route → 404/redirect. The passphrase middleware on the API stays unchanged (defence-in-depth).
- Demo migration: `scene-info-sidebar.visibleFields` switches from the `tags` widget to the new `multi-select` widget purely via registry resolution — **no `plugin.json` edits**, no schema changes.
- New author-facing doc `docs/plugin-system/settings-schema.md` (the keyword reference, `x-show-when` cookbook, allowlist semantics, `writeOnly`/`x-previous-names`/`x-legacy` lifecycle, writer-only UI exposure note).

## Capabilities

### New Capabilities

- `settings-form-widget-registry`: defines `WidgetRegistry`, the built-in widget set, `createDefaultWidgetRegistry()` factory, and the priority-based `resolve(schema)` algorithm. Codifies the phase-1 prohibition on plugin-supplied widgets.
- `conditional-field-visibility`: defines the `x-show-when` keyword grammar (sibling-scoped `field` + one of `equals|notEquals|in`), the validator's mandatory ignorance of it, the model-value retention rule on visibility toggle, and the manifest-load-time reject when a `x-show-when` field is also marked `required`.
- `settings-migration-aids`: defines `x-previous-names` (auto-migration of renamed keys at GET time) and the `x-legacy` namespace inside on-disk `config.json` for orphaned values; specifies that `x-legacy` is never echoed back to the frontend.
- `path-typed-settings-allowlist`: defines the hard-coded default root list, the intersection-only `x-path-roots` merge semantics, the manifest-load-time `string[]` shape validation, and the `realpath`-based runtime check at PUT time.

### Modified Capabilities

- `plugin-settings`: requirements widen to enumerate every newly-validated keyword, the `x-schema-version` requirement, the `format` whitelist, the structured-error response shape, the `_changedPaths` partial-strict PUT contract, the `writeOnly` GET-mask + PUT-null-unchanged short-circuit, the new `POST /settings/validate` and `GET /settings/schema-meta` endpoints, the writer-mode-only UI route, and the `x-*` superset / unknown-keyword ignore policy.
- `plugin-creation-skill`: authoring guidance updated to cover the new keywords, the `x-show-when` ↔ `required` mutual exclusion rule, `writeOnly` lifecycle, `x-path-roots` declaration patterns, `description` as plain text (no markdown), and `x-schema-version: 1` as the now-required root field.

## Impact

- **Backend (HeartReverie/writer/lib/)**: new `writer/lib/schema/` submodule (types, walker, per-keyword validators, format checkers). `plugin-manager.ts` becomes a thin wrapper plus the audit-on-load hooks (`x-schema-version`, `x-path-roots`, advanced-features log line). Estimated ~500 LOC, fully pure-function and unit-testable.
- **Backend routes (HeartReverie/writer/routes/plugin-settings.ts)**: error response reshape; two new routes; `_changedPaths` partial-strict + `writeOnly` null-unchanged logic.
- **Frontend (HeartReverie/reader-src/src/components/)**: `PluginSettingsPage.vue` shrinks dramatically; new `components/plugin-settings/` directory with `<SchemaField>`, `WidgetRegistry`, and one Vue SFC per built-in widget kind. Reader router gains a writer-only guard for `/settings/plugins/*`.
- **No `HeartReverie_Plugins/` changes** — out of scope.
- **Built-in plugin manifests (HeartReverie/plugins/\*/plugin.json)**: behavior change only — `scene-info-sidebar.visibleFields` rendering swaps from `tags` to `multi-select` via registry resolution. No manifest edits. A snapshot test guards byte-identity for the other 13 manifests.
- **On-disk `playground/_plugins/<plugin>/config.json`**: format unchanged, but the file may grow an `x-legacy` namespace when fields are dropped between versions.
- **Documentation**: new `docs/plugin-system/settings-schema.md`; release notes call out the three BREAKING items.
- **Tests**: new `tests/writer/lib/schema_validator_test.ts`, `tests/writer/lib/schema_validator_legacy_compat_test.ts`, expansion of `tests/writer/routes/plugin_settings_test.ts`, per-widget Vitest specs under `reader-src/src/components/plugin-settings/__tests__/`, and the AGENTS-mandated podman smoke (`scripts/podman-build-run.sh` + `curl` round-trips against a `tests/fixtures/plugins/schema-driven-demo/` fixture).
- **No external runtime dependencies added** — the validator stays in-house; rationale and the Ajv-rejection note are recorded in `design.md`.
