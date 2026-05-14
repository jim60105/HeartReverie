# Implementation Tasks

## 1. Backend: validator core

- [x] 1.1 Add `writer/lib/schema-validator.ts` with hand-rolled validator supporting the keyword set in `plugin-settings/spec.md` (Extended JSON Schema keyword support). Export `validate(schema, value, options): { errors: ValidationError[] }`.
- [x] 1.2 Define `ValidationError` type as `{ path: string, keyword: string, messageKey: string, params: Record<string, unknown> }`.
- [x] 1.3 Implement JSON-Pointer-shaped `path` accumulation (e.g., `items[0].name`) during recursion.
- [x] 1.4 Implement format dispatch with the whitelist (`path`, `color`, `url`, `email`, `uuid`). Unknown formats: no-op.
- [x] 1.5 Implement `format: "path"` enforcement using realpath + hard-coded root allowlist (delegated to a `path-allowlist.ts` helper). Honor per-field `x-path-roots` intersection.
- [x] 1.6 Write Deno unit tests for every keyword (one happy + one failing case each) under `tests/writer/lib/schema-validator.test.ts`.

## 2. Backend: manifest load-time hard rules

- [x] 2.1 In `writer/lib/plugin-manager.ts`, expand manifest schema gate (around L237-262) to require `x-schema-version: 1` (or absent → auto-migrate + warn once per plugin).
- [x] 2.2 Walk the schema at load time; reject when `x-show-when.field` is not a sibling, when `x-show-when` has zero or multiple comparison operators, or when a property declaring `x-show-when` also appears in `required`.
- [x] 2.3 Reject when `x-previous-names` is not `string[]`, names a property's own current name, or collides across two properties.
- [x] 2.4 Reject when `x-path-roots` is not `string[]` or its intersection with the hard-coded root list is empty.
- [x] 2.5 Write Deno tests in `tests/writer/lib/plugin-manager-schema-load.test.ts` for each rejection rule (one passing + one failing manifest per rule).

## 3. Backend: settings IO with legacy compat

- [x] 3.1 In `plugin-manager.ts`, implement `x-previous-names` GET-time rename (in-memory only; no disk rewrite).
- [x] 3.2 Implement `x-legacy: true` orphan-key relocation into the on-disk `x-legacy` namespace across each successful PUT. Strip `x-legacy` from all HTTP responses.
- [x] 3.3 Implement `writeOnly` masking in `GET /api/plugins/:name/settings` response. Apply rename migration BEFORE masking when both `x-previous-names` and `writeOnly` are declared.
- [x] 3.4 Implement `writeOnly` short-circuit on PUT: `null` value = keep existing (skip type check, retain value at either current name OR a matching `x-previous-names` key, then persist under the current name); `""` = clear; other = set + validate.
- [x] 3.5 Implement `x-legacy-warnings` sibling field in GET response: run validator against disk values, emit errors as warnings, skip those resolved by `x-previous-names` migration.
- [x] 3.6 Write Deno tests for legacy/migration/writeOnly paths in `tests/writer/lib/plugin-settings-io.test.ts` including the renamed-writeOnly ordering scenario.

## 4. Backend: structured error envelope and two-phase validation

- [x] 4.1 In `writer/routes/plugin-settings.ts`, replace the string-sniff at L51 with the structured envelope `{ errors, warnings }`. Both fields SHALL be present on every response (including 400).
- [x] 4.2 Accept optional `_changedPaths: string[]` in PUT body. Strip before persisting. Validate as `string[]`; reject malformed payloads with `400` and `errors[0].path = "_changedPaths", errors[0].keyword = "type"`.
- [x] 4.3 ALWAYS compute the diff between incoming body and on-disk config. Set the blocking scope to the union `actualDiff ∪ providedChangedPaths`. Classify each validation error as blocking (path ⊆ scope) or warning. Respond 400 if any blocking errors exist; otherwise 200 + warnings (errors empty).
- [x] 4.4 Add Deno tests covering: blocking only, warnings only, mixed, missing `_changedPaths` fallback, under-stated `_changedPaths` cannot mask a real change failure, malformed `_changedPaths`.
- [x] 4.5 Return `409` with `messageKey: "schema_version_mismatch"` from PUT when the plugin's `x-schema-version` is unsupported; return schema defaults from GET in the same condition.

## 5. Backend: new endpoints

- [x] 5.1 Add `POST /api/plugins/:name/settings/validate` route. Always 200 + envelope. No disk writes. Test that two consecutive calls do not modify `config.json`.
- [x] 5.2 Add `GET /api/plugins/:name/settings/schema-meta` returning `{ schemaVersion, pathRoots, formats }`. Test schema-meta exposes the documented `pathRoots` order.
- [x] 5.3 Gate all four routes (`GET`, `PUT`, `POST /validate`, `GET /schema-meta`) on writer-mode-only. In reader-only, respond 404. Test with both modes.
- [x] 5.4 Add Deno integration tests in `tests/writer/routes/plugin-settings-routes.test.ts`.

## 6. Backend: audit logging

- [x] 6.1 Log a single structured entry per successful PUT: plugin name, changed paths, warning count, validator duration.
- [x] 6.2 Log a single warning entry per `x-schema-version` auto-migration, once per plugin per process.

## 7. Frontend: widget registry foundations

- [x] 7.1 Add `reader-src/src/lib/widget-registry.ts` exporting `WidgetRegistry` class and `createDefaultWidgetRegistry()` factory.
- [x] 7.2 Implement priority-based `resolve(schema)` falling back to the built-in `text` widget.
- [x] 7.3 Define `FormContext` injection key with type `{ registry: WidgetRegistry, errors: ValidationError[], schemaMeta: SchemaMeta }`.
- [x] 7.4 Write Vitest unit tests for the resolver covering: exact-priority ordering, fallback, multiple-tie behavior.

## 8. Frontend: built-in widgets

- [x] 8.1 Implement each built-in widget as a SFC under `reader-src/src/components/widgets/`: `TextWidget.vue`, `NumberWidget.vue`, `CheckboxWidget.vue`, `SelectWidget.vue`, `MultiSelectWidget.vue`, `TagsWidget.vue`, `ColorWidget.vue`, `MaskedSecretWidget.vue`, `RangeNumberWidget.vue`, `PathPickerWidget.vue`, `ComboboxWidget.vue`, `ObjectFieldsetWidget.vue`, `RepeaterWidget.vue`.
- [x] 8.2 Each widget accepts `{ schema, path, modelValue, errors, context }` and emits `update:modelValue`.
- [x] 8.3 `MaskedSecretWidget` displays `null` as "(saved)" placeholder and emits `""` to clear vs string to set.
- [x] 8.4 `PathPickerWidget` consumes the intersection of `context.schemaMeta.pathRoots` and the field's `x-path-roots` (when declared) to constrain its picker UI; falls back to free-text input.
- [x] 8.5 `SelectWidget` / `MultiSelectWidget` / `ComboboxWidget` honour `x-options-url`: fetch on mount with the passphrase header, populate options from `{ options: [{value,label}] }`, fall back to declared `enum` on fetch failure with an inline error displayed.
- [x] 8.6 Vitest unit tests per widget for input → emit and error-display behavior, including dynamic options happy/error paths.

## 9. Frontend: `<SchemaField>` recursive renderer

- [x] 9.1 Add `reader-src/src/components/SchemaField.vue` that resolves the widget via the registry and renders it.
- [x] 9.2 Implement error-scoping: filter `errors` to the current `path` and pass only those to the widget.
- [x] 9.3 Evaluate `x-show-when` at render time; do NOT render the field when the predicate is false; retain the model value across hide/show. The form's `_changedPaths` builder SHALL exclude paths whose nearest enclosing field currently evaluates `x-show-when` to false.
- [x] 9.4 Vitest tests for: nested object renders, repeater rows render recursively, error filtering, show/hide retention, hidden-field exclusion from `_changedPaths`.

## 10. Frontend: `PluginSettingsPage.vue` rewrite

- [x] 10.1 Replace `getFieldType()` (L171-186) and inline widget templates (L380-556) with a single root `<SchemaField>` provided a fresh `createDefaultWidgetRegistry()` instance per mount.
- [x] 10.2 Fetch `/settings`, `/settings-schema`, and `/settings/schema-meta` on mount; pass through `FormContext`.
- [x] 10.3 Wire Save → `PUT` with `_changedPaths` computed from form dirty tracking; render `errors` and `warnings` from the envelope.
- [x] 10.4 Wire Reset → re-fetch `/settings` (discard local edits).
- [x] 10.5 Wire Cancel → `router.back()` after a confirmation prompt if the form is dirty.
- [x] 10.6 Implement debounced `POST /settings/validate` on edit (300 ms) to surface non-blocking warnings live.
- [x] 10.7 Vitest tests for the page mounted against mock fetch (happy save, blocking errors, warnings-only).

## 11. Frontend: i18n table

- [x] 11.1 Add error `messageKey` lookup table for every keyword the validator emits: `required`, `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`, `uniqueItems`, `additionalProperties`, `format`.
- [x] 11.2 Add a generic fallback formatter using `keyword` + `params` when `messageKey` is unknown.

## 12. Demo migration

- [x] 12.1 Confirm `scene-info-sidebar.visibleFields` schema (`type: array, items: { enum: [...] }`) resolves to the `multi-select` widget via the registry. No `plugin.json` edits.
- [x] 12.2 Add a snapshot test enumerating every plugin manifest in `HeartReverie_Plugins/` and asserting each `settingsSchema`-bearing manifest is still accepted by the manifest gate.
- [x] 12.3 Browser smoke: open the settings page for `scene-info-sidebar` and verify the multi-select widget renders instead of the old tags input.

## 13. Documentation

- [x] 13.1 Update `HeartReverie/docs/plugin-system.md` (or the relevant settings section) with the new keyword set, `x-schema-version`, `writeOnly`, `x-show-when`, `x-previous-names`, `x-legacy`, `x-path-roots`.
- [x] 13.2 Update the plugin-creation skill references (`.agents/skills/heartreverie-create-plugin/references/manifest-schema.md`) to match the new authoring guidance from `plugin-creation-skill/spec.md`.

## 14. Integration verification

- [x] 14.1 `cd HeartReverie && scripts/podman-build-run.sh`. Container starts cleanly. `podman logs heartreverie 2>&1 | grep -iE "error|warn"` SHALL contain ONLY the expected one-per-plugin `x-schema-version` migration warnings (one warn line per `settingsSchema`-bearing manifest in `HeartReverie_Plugins/`) and zero error lines. Any unexpected warn or any error is a failure.
- [x] 14.2 `curl -H "X-Passphrase: $PASSPHRASE" localhost:8080/api/plugins/scene-info-sidebar/settings/schema-meta` returns the documented payload.
- [x] 14.3 `curl -H "X-Passphrase: $PASSPHRASE" -X POST localhost:8080/api/plugins/scene-info-sidebar/settings/validate -d '{...invalid...}'` returns 200 with non-empty `errors`.
- [x] 14.4 `curl -X PUT ... -d '{...invalid_changed_path...}'` returns 400 with the structured envelope.
- [x] 14.5 agent-browser smoke: load reader, open scene-info-sidebar settings, verify multi-select renders, save a valid change, observe 200 + chapter re-render.

## 15. Final validation

- [x] 15.1 Run full backend test suite (`cd HeartReverie && deno task test`) — all green.
- [x] 15.2 Run frontend test suite (`cd HeartReverie/reader-src && npm test -- --run`) — all green.
- [x] 15.3 `openspec validate schema-driven-plugin-settings-form --strict` passes.
- [x] 15.4 Final rubber-duck sync review (model gpt-5.5). Address findings.
- [x] 15.5 Commit inner repo with conventional message + Co-authored-by trailer; bump submodule in outer repo.
