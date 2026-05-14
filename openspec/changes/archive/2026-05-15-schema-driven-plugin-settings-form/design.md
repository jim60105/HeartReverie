## Context

The current plugin settings stack ships with two intentional limitations that have now become friction points for the next generation of in-tree plugins:

1. **`PluginManager.#validateAgainstSchema`** (`writer/lib/plugin-manager.ts` L1101-1166) only honours top-level `required` plus a typeof check on each property. Every other JSON-Schema keyword — `enum`, `minimum`, `maximum`, `pattern`, `items`, `items.enum`, nested `properties`, `format`, `additionalProperties` — is silently dropped. Plugins (`state.maxDiffEntries.minimum=50`, `scene-info-sidebar.visibleFields.items.enum`) therefore declare constraints the engine never enforces. The disk-resident `playground/_plugins/<name>/config.json` may already contain values that violate the *declared* schema.
2. **`PluginSettingsPage.vue`** (L171-186, L380-556) dispatches on schema shape via a hand-written `v-if/v-else-if` chain across seven widgets. Adding any widget requires editing this file; plugin authors cannot supply their own components (vanilla-ES-module plugins under `register(hooks)` cannot ship compiled Vue SFCs without breaking the existing module model and CSP). Schema-shaped UX is therefore capped at what the core file enumerates.

The combined effect: plugin authors write JSON Schema, but the engine treats most of it as documentation. The proposal converts this into a real schema-driven form engine.

Stakeholders: plugin authors (`HeartReverie/plugins/*` and the external `HeartReverie_Plugins/*` repo), the engine maintainers who own `plugin-manager.ts` and `PluginSettingsPage.vue`, and end users whose `config.json` files contain legacy values that must not be invalidated overnight.

Hard constraints inherited from `AGENTS.md`:
- Container runtime verification via `scripts/podman-build-run.sh` is mandatory before marking the change done.
- No external runtime dependencies (Ajv, json-schema-walker, jsondiffpatch) — keep the bundle and supply-chain surface area small.
- The implementation must respect the existing `register(hooks)` contract; the frontend plugin-load path cannot grow a "ship a Vue component" capability in phase 1.

## Goals / Non-Goals

**Goals:**

- Make every JSON-Schema keyword the proposal lists genuinely enforce on the server, with structured, i18n-ready error reporting on the wire.
- Preserve the user experience for the 14 in-tree plugins whose `settingsSchema` files are not edited by this change — they continue to render and persist byte-identically.
- Let `scene-info-sidebar.visibleFields` upgrade from `tags` to `multi-select` via *registry resolution alone* — no manifest edits — proving that schema-shape-driven widget routing actually works.
- Bound the blast radius of stricter validation: users with legacy out-of-range disk values can still load settings, can still edit unrelated fields, and only see blocking errors on fields they personally touch.
- Provide a forward-compatible escape hatch (`x-schema-version`) for any future major change that *will* be destructive.
- Keep the validator in-house and pure-function so the unit suite can exhaustively cover every keyword without spinning up a server or plugin manager.

**Non-Goals:**

- Full JSON Schema 2020-12 compatibility. We are deliberately not implementing `oneOf` / `anyOf` / `allOf` / `if-then-else` / external `$ref` / `patternProperties` / `unevaluatedProperties` / `dependentSchemas`. The proposal cites the cost (validator complexity and bundle size) and the absence of demand.
- A plugin-provided custom widget contract. The proposal documents the deferral; phase 2 will add a vanilla-DOM widget adapter.
- A new auth model, a new file-upload capability, or any change to the existing `plugin-settings:changed` event bus or settings storage path.
- Re-rendering / re-validating settings UI in reader mode. The settings entry point is writer-mode-only at the route layer; the backend API stays passphrase-protected as a separate defence layer.

## Decisions

### D1 — Hand-rolled validator over Ajv / @cfworker/json-schema

We extend `#validateAgainstSchema` to ~150 additional LOC structured as `writer/lib/schema/{types.ts,walker.ts,validators/*.ts}` rather than adopting Ajv.

Alternatives considered:
- **Ajv 2020-12**: ~50 KB gzip on the reader-mode bundle, separate Deno-server fetch from esm.sh, MIT-licensed but adds third-party execution surface, and ships generic English error messages that are awkward to swap for `messageKey` + `params`.
- **@cfworker/json-schema**: ~14 KB gzip, no deps; closer to acceptable but still bundles 2020-12 semantics we explicitly do not want and offers limited error-message customisation.
- **Hand-rolled**: small, exhaustively unit-testable, error model designed for our i18n needs (`{ path, keyword, messageKey, params }`), zero new runtime dependencies.

Rationale: the proposal's keyword list is finite and small (~12 keywords + 4 formats). The walker complexity is dominated by recursion into `properties` and `items`, which we need to write anyway to produce JSON-Pointer-shaped error paths (`items[2].notifyTitle`). The validator's surface area is small enough that the maintenance cost of Ajv adoption is higher than maintaining our own keyword set.

### D2 — Two-phase validation: `_changedPaths` + warnings, never bulk-reject

`PUT` accepts the raw settings object with an optional reserved `_changedPaths: string[]` field at the top level (stripped before persisting). The validator produces all errors. The server SHALL ALSO compute an actual diff between the incoming body (minus `_changedPaths`) and the on-disk `config.json`. The blocking-error scope is the union `actualDiff ∪ providedChangedPaths`: any error whose `path` falls at or under one of these is blocking (400); errors elsewhere downgrade to non-blocking warnings (200 + `warnings: ValidationError[]`). When `_changedPaths` is absent, the blocking scope is just `actualDiff`. This prevents a malformed or under-stated `_changedPaths` from masking a real failure on a changed field.

Rationale: previously-saved `config.json` files may already contain values that violate the *new* validator. Upgrading the engine must not corrupt the user's ability to edit unrelated settings. The diff-based fallback handles older clients that have not been redeployed.

Alternatives considered:
- **Bulk-strict**: simplest, but the first time a user opens a plugin page they would see their save button rejected because of an unrelated legacy value. Unacceptable.
- **Bulk-lenient with explicit "fix this field" prompts**: introduces a new UX surface (a "fix-up" modal); higher cost than partitioning.
- **Auto-coerce on load**: silently changing the user's saved values violates the principle of least surprise.

### D3 — `writeOnly` GET-mask + `null=unchanged` PUT short-circuit

`GET /settings` returns `null` in place of any `writeOnly: true` value. `PUT /settings` interprets `null` for a `writeOnly` field as "keep the existing disk value", short-circuited *before* any type/format/required check. `""` is "clear", any other value is "set + validate".

Rationale: passwords and API tokens are write-only — the frontend should never display them. The `null=unchanged` convention lets the form re-submit unchanged write-only fields without round-tripping the secret through the browser, while still letting users explicitly clear (`""`) or rotate (new value) the field. Short-circuiting before the type check prevents a confusing "string expected, got null" error on every save.

### D4 — `x-show-when` as pure UI behaviour with manifest-load-time `required` mutual exclusion

`x-show-when` is documented as a UI keyword. The validator must ignore it. Plugin manifest load rejects any property that appears in `required` *and* declares `x-show-when` — the combination is an unrecoverable dead-config because the user cannot fill an invisible required field.

Rationale: the alternative is to make the validator aware of visibility, which collapses into a partial `if-then-else` implementation. Keeping the validator unaware preserves the single-source-of-truth: schema validity is a function of the value and the standard keywords only. Visibility is a presentation concern.

Hidden fields retain their model value. Toggling visibility off does not clear the value (otherwise a user trying different settings would lose data). A "clear to default" option is provided per widget.

### D5 — `format: "path"` allowlist as `hardcoded ∩ x-path-roots`, never expansion

The engine ships with `playground/lore/`, `playground/chapters/`, and the plugin's own `_plugins/<name>/` as the hard-coded allowlist. A manifest MAY declare `x-path-roots: string[]` to *narrow* the set; the effective list is the intersection. Anything outside the hard-coded set is logged and discarded.

Rationale: plugins should not be able to grant themselves filesystem access to arbitrary paths simply by declaring a manifest field. Intersection-only enforces "the engine decides what is allowed; the manifest decides which subset of allowed paths this plugin actually wants exposed". Empty intersection (plugin declared roots, none of which are in the hard-coded set) rejects all `path` fields for that plugin — a louder failure mode than silent fallback.

`realpath` is invoked at PUT-time to defeat symlink traversal. Absolute paths, `..`, and symlinks are rejected at the syntactic layer first.

### D6 — `x-schema-version: 1` mandatory with auto-migration warn for legacy manifests

The manifest `settingsSchema` root declares `x-schema-version: number`. Phase 1 accepts only `1`. Missing → first-load audit treats as `1` and logs a single `warn` per plugin per process. Unknown major (e.g. `2`) → the plugin's settings load is disabled (the plugin itself keeps loading; its settings API returns schema defaults; `PUT` returns 409 with a `messageKey: "schema_version_mismatch"`; the warn log names the offending plugin and the unsupported version).

Rationale: the cost of adopting this fence is one log line per legacy manifest at startup. The benefit is that future destructive changes have a deterministic gate — no need to write migration code that pattern-matches schema shapes.

### D7 — Widget registry as a per-instance factory, not a module singleton

`createDefaultWidgetRegistry()` returns a fresh registry each call. The `PluginSettingsPage.vue` setup invokes it once per mount, then `provide()`s the registry into the `<SchemaField>` subtree.

Rationale: a module singleton couples test ordering and would make it impossible for unit tests to substitute a stub registry. Factory-per-instance keeps test isolation cheap, and the per-mount cost is negligible (the registry contains ~12 widgets — a single array push loop).

### D8 — Schema is JSON-Schema-compatible plus an `x-*` superset; validator ignores all unknown keywords

The validator does not maintain a "rejected unknown keywords" list. Any keyword it does not understand (including unknown `x-*` and unknown standard keywords) is silently ignored. This makes the schema files compatible with VS Code IntelliSense and `quicktype` while leaving room for UI/migration metadata.

Rationale: a stricter "reject unknown keyword" policy would force plugin authors to fork their schemas when targeting both the engine and external tooling. Ignore-on-unknown is the lowest-friction interop posture.

### D9 — `description` is plain text only; no markdown, no sanitizer

`description` strings are rendered as text content (`{{ description }}`), never as HTML. The proposal explicitly removed an earlier `x-description-md` idea.

Rationale: markdown rendering requires a sanitiser (script-injection prevention is mandatory for any string that ends up in plugin-controlled HTML), which is more code than the feature is worth. Authors who need long descriptions can use multi-line plain text or split a field into multiple smaller fields with their own descriptions.

### D10 — Phase-1 widget set is fixed; no plugin-supplied widgets

The widget registry is populated only by `createDefaultWidgetRegistry()` in phase 1. Plugins cannot append. The frontend `register(hooks)` shape is unchanged.

Rationale: introducing a plugin-supplied widget API requires defining a vanilla-DOM widget adapter (plugins cannot ship Vue SFCs). That contract is non-trivial (mount/update/unmount lifecycle, CSP-safe stylesheet injection, error containment) and is best deferred to phase 2 where it gets its own `plugin-core` delta and its own design review.

### D11 — Demo migration is `scene-info-sidebar` only and touches no manifest

`scene-info-sidebar.visibleFields` already declares `type: "array", items: { type: "string", enum: [...] }`. Phase 1 changes nothing in the manifest; the new widget registry simply *resolves* the multi-select widget instead of the tags widget for that schema shape. A snapshot test confirms the other 13 in-tree manifests render byte-identically.

Rationale: the smallest possible demonstration of the registry's value, while explicitly avoiding scope creep into multi-plugin manifest editing.

## Risks / Trade-offs

- **[Stricter validation breaks "save" on legacy configs]** → mitigated by D2 (`_changedPaths` partial-strict + diff fallback). Documented in §5.4 of the source proposal and covered by a 4-fixture legacy-compat test suite.
- **[`x-schema-version` warn spam at first startup]** → 14 manifests will each emit one `warn`. Acceptable: the warn message includes the exact `x-schema-version: 1` patch line authors need to apply on their next release. Release notes call this out as intentional migration noise, not an error.
- **[Hand-rolled validator drift from JSON-Schema semantics]** → mitigated by D8 (unknown-keyword ignore) which makes our schemas a *subset* of JSON Schema, not a divergent dialect. External tools still consume them correctly. A snapshot test runs the validator against every in-tree manifest with synthetic valid + invalid payloads to detect accidental semantic drift.
- **[Repeater widget DoS with N=1000 array items]** → mitigated with a simple visible-window virtualisation (mount ±10 rows around the scrollport) and a soft cap at 500 items with a UI warning. Hard cap is enforced by `maxItems` if the schema sets it.
- **[`x-path-roots` misconfiguration silently disables `format: "path"` for a plugin]** → mitigated by an explicit `log.warn` at manifest load whenever an `x-path-roots` entry is filtered out of the effective list. Empty effective list produces a louder error log naming the plugin.
- **[Two-phase validation could mask a real bug]** → mitigated by audit log at engine startup that enumerates every plugin's legacy violations, so operators can proactively triage rather than wait for user reports.
- **[Phase-1 widget set diverges from author wishes (e.g. date pickers, slider variants)]** → mitigated by the explicit phase 2 commitment in D10. Phase 1 documents the registry's `match`-based resolution so phase 2 can drop in additional widgets without re-architecture.
- **[Vue SFC compilation overhead from ~12 new components]** → measured as negligible: the components are leaves with no async chunks and minor template surface. The reader bundle adds ≈ 6–8 KB gzip per author estimate; verified during build.

## Migration Plan

1. Land the validator submodule (`writer/lib/schema/`) and its tests in a single PR with the existing `#validateAgainstSchema` redirected to it as a thin shim. No behavioural change yet on the wire — keep the old error envelope until step 3.
2. Land the legacy-compat fixtures and tests. Audit-log emits at startup for every plugin with a violating disk config. Operators get visibility but no behaviour change.
3. Flip the `PUT` error envelope to the structured shape. Update the frontend in the same PR to consume `errors[]`. Land the `POST /settings/validate` and `GET /settings/schema-meta` endpoints simultaneously.
4. Land the frontend `<SchemaField>` + `WidgetRegistry` + the 12 built-in widget SFCs. Keep `PluginSettingsPage.vue` rendering using the old switch as a feature flag (a boolean checked at setup time) until step 6 to allow rollback.
5. Land the `x-schema-version` audit + `x-path-roots` validation + `x-show-when` ↔ `required` reject in `PluginManager.loadPlugin`. Container smoke test confirms the 14 in-tree manifests load cleanly with one expected warn each.
6. Remove the feature flag; `PluginSettingsPage.vue` exclusively uses `<SchemaField>`. The `scene-info-sidebar` upgrade goes live via registry resolution. Snapshot test asserts the other 13 plugins render unchanged.
7. Add the writer-mode-only route guard. Reader-mode hits `/settings/plugins/*` → 404/redirect.
8. Author docs (`docs/plugin-system/settings-schema.md`) and release notes. Note the three BREAKING items.

Rollback: each step above is independently revertable. Steps 1–2 are no-op on the wire. Step 3 can be reverted by flipping the error envelope back. Step 4 has the feature flag. Steps 5–6 are coupled (the audit and the new renderer rely on each other for the `x-schema-version` log), so a rollback at step 5 implies reverting step 6 too. Step 7 is a router-only change with zero data impact.

## Open Questions

All open questions from the source planning document were resolved before drafting this design (see proposal §1 and §14 of `tmp/feat/B6-schema-driven-settings.md`):

- `x-*` superset vs JSON-Schema-strict subset → **superset, ignore unknown** (D8).
- `description` markdown support → **plain text only** (D9).
- Reader-mode settings access → **writer-mode-only route guard** (proposal).
- `format: "path"` allowlist authority → **hardcoded ∩ manifest** (D5).
- Schema versioning → **`x-schema-version: 1` mandatory with auto-migration warn for legacy manifests** (D6).

No open questions remain at design-approval time. The proposal explicitly defers plugin-supplied widget registration to phase 2 (which will require its own design document and a `plugin-core` capability delta).
