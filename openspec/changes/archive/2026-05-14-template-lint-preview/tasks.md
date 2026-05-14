# Tasks

## 1. Backend

- [x] 1.1 Add `writer/routes/templates.ts` registering five endpoints: `GET /api/templates`, `GET /api/templates/variables`, `POST /api/templates/lint`, `POST /api/templates/preview`, `PUT /api/templates`.
- [x] 1.2 Expose `ventoEnv` from `createTemplateEngine()` to routes via `AppDeps.templateEngine: TemplateEngine`:
  - Update `writer/types.ts` to add the new field.
  - `writer/server.ts` populates the field when assembling deps.
  - `writer/app.ts` imports and calls `registerTemplateRoutes(app, deps)` alongside the existing `registerPromptRoutes`.
- [x] 1.3 Create `writer/lib/path-safety.ts`, extracting `isPathContained` from `plugin-manager.ts:61-64`; have `plugin-manager.ts` import the helper (no behaviour change).
- [x] 1.4 Create `writer/lib/template-lint.ts` with `buildVariableCatalog`, `checkUnknownVariables` (AST walk), `positionFromError`, and `matchMultiMessageTag` (reuse `errors.ts`). Pipeline uses the `compile()` path (no `runString` probe).
- [x] 1.5 Create `writer/lib/template-preview.ts` with pure-function `renderSystemPromptForPreview(source, fixture, mode)`. `mode === "default" | "inline"` MUST NOT take `pluginManager`/`storyDir`/`series`/`story`; `mode === "current"` delegates to `buildPromptFromStory`.
- [x] 1.6 Add `writer/fixtures/template-preview.json` (default fixture for `mode: "default"`).
- [x] 1.7 Extend `writer/vendor/ventojs.d.ts` (or sibling `.d.ts`) with `Environment.compile(source: string, filename?: string): Promise<Template>` ambient signature; add `writer/vendor/__tests__/ventojs-compile.test.ts` ambient pin test. Lint pipeline (task 1.4) uses this `compile()` path.
- [x] 1.8 `PUT /api/templates` handler validates source with `validateTemplate()` and returns `422` on non-empty findings. When `templatePath` starts with `plugin:`, return `403` BEFORE SSTI validation.
- [x] 1.9 Backup-on-write helper: `Deno.lstat` → reject symlinks (`400`); copy existing target to `<target>.bak` (rotate to `<target>.bak.<timestamp>` if `.bak` exists); write to `<parent>/.<basename>.tmp.<uuid>`; `Deno.rename` to final.
- [x] 1.10 Backend unit tests (`writer/routes/__tests__/templates.test.ts` + `writer/lib/__tests__/template-lint.test.ts`): lint diagnostics including `vento.message-*`, concurrent PUT atomicity, lore lint, plugin runtime SSTI, plugin PUT `403`, `set`/`include` hard rejection, and `compile()` ambient pin.
- [x] 1.11 Plugin runtime SSTI enforcement (BREAKING):
  - During plugin discovery/initialization (before hook registration), run `validateTemplate()` over every `promptFragments[].file` source; non-empty result → log `error`, do NOT register the plugin's hooks/settings/fragments.
  - In `renderSystemPrompt()`, re-validate each fragment before composing; failure skips that fragment with a `warn` log (catches on-disk edits between load and render).
  - Tests cover: plugin with `{{> ... }}` fails to load with zero observable side effects (no hooks, no settings); sibling clean plugins remain active; render-time skip path triggered by an on-disk edit after load.
  - Release notes BREAKING CHANGES list affected fragments + migration steps.
- [x] 1.12 Lore lint support:
  - `templates.ts` parses `lore:global:<rel>`, `lore:series:<series>:<rel>`, and `lore:story:<series>:<story>:<rel>` and resolves through the three scope roots (`${PLAYGROUND_DIR}/_lore/`, `${PLAYGROUND_DIR}/<series>/_lore/`, `${PLAYGROUND_DIR}/<series>/<story>/_lore/`) with realpath containment + segment validation.
  - Lint pipeline accepts lore source with the restricted catalog (`lore_*` + `series_name` + `story_name`).
  - Preview returns the rendered markdown for lore entries (`kind: "markdown"`, no messages array).
  - `GET /api/templates` adds `kind: "lore"` entries grouped by scope.
  - Tests cover lint pipeline, catalog restriction, traversal rejection, and invalid `<series>`/`<story>` segments.

## 2. Helper drift check

- [x] 2.1 Add `scripts/check-vento-helpers.ts`: compare `reader-src/src/lib/template.ts` `VENTO_HELPERS` const against `ventojs` filter registry; fail on non-empty diff. Wire into `deno task check` / CI step.

## 3. Frontend

- [x] 3.0 Add `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lint`, `@vueuse/core`, and `diff` to `deno.json` `imports`; run `deno cache reader-src/src/main.ts` to update the lockfile.
- [x] 3.1 Add `reader-src/src/lib/cm-vento.ts`, `cm-vento-complete.ts`, `template-api.ts`:
  - `template-api.ts` injects `X-Passphrase` + JSON headers via `useAuth().getAuthHeaders()`.
  - `cm-vento-complete.ts` imports `VENTO_HELPERS` from `reader-src/src/lib/template.ts`; after `|>` show full helper list with hover docs.
  - `cm-vento.ts` flags `set`/`/set`/`include`/`{{> ... }}` tokens as errors with remediation hint「使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 getDynamicVariables() 注入內容」.
- [x] 3.2 Add `TemplateEditorPage.vue` + `TemplateEditor.vue` + `TemplateFileTree.vue`:
  - File tree groups `system.md`, plugin fragments, and lore entries (by scope).
  - Plugin-fragment tree nodes show 「唯讀」 badge; no save button rendered for them.
- [x] 3.3 Integrate `PromptPreview.vue` for the right pane; lore entries fall back to a markdown block.
- [x] 3.4 Register `/settings/template-editor` route.
- [x] 3.5 Add `SettingsLayout` sidebar entry alongside the existing prompt-editor entry.
- [x] 3.6 Component tests: lore tree node rendering, helper autocomplete list rendering, plugin node read-only badge + missing save button, lint-warning toast does not block save.

## 4. Documentation

- [x] 4.1 Update `docs/prompt-template.md`:
  - Add "Template Editor" chapter.
  - Remove all `set` and `include` examples; rewrite to use named variables, plugin promptFragments, or `getDynamicVariables()`-injected content.
  - Add 「Prompt 模板不支援 `set` / `include`，請改以變數注入」 warning.
  - Add 「Lore 篇章可在 Template Editor 中編輯」 section.
  - State 「plugin promptFragments 一律 read-only，須於 plugin repo 中編輯」.
- [x] 4.2 Update `docs/plugin-system.md` with plugin-fragment read-only rule + load-time SSTI enforcement (BREAKING).
- [x] 4.3 Short README note pointing to the new editor.
- [x] 4.4 Release notes BREAKING CHANGES section: plugin runtime SSTI scope and migration steps.

## 5. Integration verification

- [x] 5.1 Per `AGENTS.md` Mandatory Integration Verification: `scripts/podman-build-run.sh`, scan logs for errors/warnings, then `curl` each new endpoint:
  - `GET /api/templates` returns the expected `system.md`/plugin/lore listing.
  - `POST /api/templates/lint` flags a planted `set` token as `vento.unsafe-expression`.
  - `POST /api/templates/preview` renders `default` fixture without IO.
  - `PUT /api/templates` produces `.bak` and rejects symlinks/`plugin:` paths.
  - Lore `lore:<scope>:<file>` lint + preview round-trips.

## 6. Final rubber-duck pass — adopted fixes

- [x] 6.1 Add `GET /api/templates/source?templatePath=...` read-only endpoint (route + spec scenarios + tests + frontend client). Fixes blocker where save would overwrite files with empty content.
- [x] 6.2 `GET /api/templates` lists every plugin promptFragment (named + unnamed) via new `PluginManager.enumerateFragmentRefs()` helper — previously unnamed fragments were missing from the listing.
- [x] 6.3 `getDynamicVariablesWithWarnings()` on `PluginManager` so the variable catalog can surface a `warnings[]` entry naming the throwing plugin, as required by the spec.
- [x] 6.4 `WRITE_MUTEX` cleanup leak fixed by storing the chained promise in a variable so the identity check actually matches at release time.
- [x] 6.5 Lint `checkUnknownVariables()` strips string literals from tag expressions before identifier scan — `{{ message "user" }}` no longer reports `user` as unknown.
- [x] 6.6 `deno task check:vento-helpers` added so the three-way drift script can be run uniformly in CI.

## 7. Post-deployment bug-fix batch (user-reported)

- [x] 7.1 Modal CSS — `.modal { background: var(--btn-bg) }` → `var(--panel-bg)`; `.modal-backdrop { background: rgba(0,0,0,0.4) }` → `var(--page-overlay)` so the dialog reads as opaque in every theme (`reader-src/src/components/TemplateEditorPage.vue`).
- [x] 7.2 system.md empty in editor — `GET /api/templates/source` for `kind: "system"` falls back to `ROOT_DIR/system.md` when `PROMPT_FILE` is absent; `GET /api/templates` mirrors the fallback in the system-entry `sizeBytes` (`writer/routes/templates.ts`). Spec `template-editor/spec.md` updated.
- [x] 7.3 "目前故事" current-fixture preview — `TemplateEditorPage.vue` wires `useStorySelector()` into `series`/`story` refs, adds a `hasCurrentStory` guard, and notifies the user (without opening the modal) when no story is loaded.
- [x] 7.4 Cancel-current modal radio resync — `cancelCurrentMode()` calls `syncPreviewModeRadios()` (`nextTick` + native `name="te-preview-mode"` + `value="default"/"current"` so the browser group toggle resyncs after Vue's reactive value is unchanged).
- [x] 7.5 Lore tree shows `(0)` — `GET /api/templates` now walks `playground/_lore` + every `<series>/_lore` + every `<series>/<story>/_lore` via new `enumerateAllLore()` helper, ignoring `series`/`story` query parameters (`writer/routes/templates.ts`). Spec `template-editor/spec.md` updated with a new scenario.
- [x] 7.6 CJK-friendly path segments — `SEGMENT_RE` relaxed to `/^[^:\/\\\x00]+$/` + `isValidSegment()` helper (forbids `:`, path separators, NUL, `..`, leading `_`, `lost+found`); `parseTemplatePath` plugin/series/story branches use the helper; `enumerateAllLore` filters via the helper. Spec `lore-storage/spec.md` updated.
- [x] 7.7 `chapter_number` unknown-variable false-positive in plugin fragments — added to `CORE_VARIABLES` (`writer/lib/template-lint.ts`); defaulted to `1` in `fixtureToContext` (`writer/lib/template-preview.ts`); injected as `1` in `renderCurrentMode` plugin-fragment branch. Spec `vento-prompt-template/spec.md` updated.
- [x] 7.8 Toolbar height jitter — `.te-toolbar { min-height: 48px; box-sizing: border-box }`; `.te-save-btn` and `.te-readonly-pill` both normalised to `height: 32px` with matching padding-x so swapping between writable and read-only templates no longer pushes the toolbar.
- [x] 7.9 Low-contrast save button — `.te-save-btn` switched from `color: var(--text-title)` (red on red) to `color: var(--text-on-accent)`, a new theme token (`#fff` in default/light/dark `themes/*.toml`).
- [x] 7.10 CodeMirror highlight theme-reactive — `defaultHighlightStyle` replaced by `ventoHighlightStyle` (CSS-var-based, defined in `reader-src/src/lib/cm-vento.ts`) so token colours follow the active theme without a Compartment swap; `@lezer/highlight` added to `deno.json`.
- [x] 7.11 Gutter colours theme-tokenised — `.cm-gutters`, `.cm-activeLineGutter`, `.cm-lineNumbers .cm-gutterElement` now resolve through `--section-head-bg`, `--text-italic`, `--btn-active-bg`, `--text-label`, `--border-color`.
- [x] 7.12 Spec wording cleanup — `template-editor` `engine-system` → `system`, lint/preview debounce window split (300 ms / 500 ms), modal copy "N 個章節" simplified; `vento-prompt-template` `compile()` declared synchronous to match the ventojs vendor.
