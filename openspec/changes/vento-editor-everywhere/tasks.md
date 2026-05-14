## 1. Backend lint API: source-form request shape

- [x] 1.1 Extend `writer/routes/templates.ts` `POST /api/templates/lint` handler to detect the source-form request body shape `{ kind, source, series?, story?, scope?, role?, pluginName? }` (no `templatePath`). Branch around `parseTemplatePath()`.
- [x] 1.2 In the source-form branch, look up the kind: `system` / `plugin-fragment` / `lore` / `prompt-message-body` and validate required fields (`pluginName` for plugin-fragment; `scope` for lore; `role` for prompt-message-body). Return `400` with a descriptive error body when required fields are missing.
- [x] 1.3 For `kind: "prompt-message-body"` synthesize the parse buffer `{{ message "<role>" }}\n${source}\n{{ /message }}`. After lint produces diagnostics on the wrapped buffer, drop diagnostics that point inside the synthetic prefix/suffix and translate the remaining diagnostic offsets back to the original source.
- [x] 1.4 Call the existing `buildVariableCatalog(kind, { series, story, pluginName })` (in `writer/lib/template-lint.ts`) and run the same `ventoEnv.compile()` + diagnostic-collection pipeline. Reject `runString` execution as in the path-form branch.
- [x] 1.5 Add Deno backend tests in `tests/writer/routes/templates_test.ts` covering: (a) source-form `kind: "system"` with unknown variable → warning; (b) source-form `kind: "lore"` excludes plugin variables; (c) source-form `kind: "prompt-message-body"` wraps source and detects nested `{{ message }}`; (d) missing required field for each kind → 400.

## 2. Backend catalog API: kind query parameter

- [x] 2.1 Extend `GET /api/templates/variables` to accept a `kind` query parameter (default `system`). Validate that `kind` is one of `system | plugin-fragment | lore | prompt-message-body`; reject other values with `400`.
- [x] 2.2 Thread `kind`, `series`, `story`, `pluginName` through to `buildVariableCatalog()`. Confirm `kind=lore` returns the restricted catalog (no plugin/system variables) and that `kind=prompt-message-body` returns the same catalog as `kind=system`.
- [x] 2.3 Add Deno backend tests for the new query parameter in `tests/writer/routes/templates_test.ts`: `kind=lore` excludes plugin variables; `kind=plugin-fragment&pluginName=...` includes only that plugin's manifest variables; default `kind` (omitted) preserves the existing system catalog.
- [x] 2.4 Re-run `deno task test:backend`; all green.

## 3. Frontend API client

- [x] 3.1 Extend `reader-src/src/lib/template-api.ts` `lintTemplate(...)` to overload: existing `(templatePath, source)` form stays; new `({ kind, source, ... })` source-form maps to the new backend shape. Keep TypeScript types tight.
- [x] 3.2 Add `fetchVariableCatalog({ kind, series?, story?, pluginName? }): Promise<{ variables: VariableEntry[]; warnings: string[] }>` calling the new query-parameterised endpoint.
- [ ] 3.3 Add Vitest tests in `reader-src/src/lib/__tests__/template-api.test.ts` for both new client paths (mock fetch, assert URL + body).

## 4. Extract shared editor component

- [x] 4.1 Rename `reader-src/src/components/TemplateEditor.vue` → `reader-src/src/components/VentoCodeEditor.vue`. Update any internal `name:` references, JSDoc, and the file header.
- [x] 4.2 Make `templatePath` prop optional. When `templatePath` is provided, the editor's internal lint trigger uses the path-form request; when omitted, the host must pass a `lintRequest` callback or `lintParams` (`{ kind, role?, scope?, series?, story?, pluginName? }`) prop so the editor can build a source-form request itself.
- [x] 4.3 Add `minLines?: number` (default `3`), `maxLines?: number` (default `30`), `enableSaveShortcut?: boolean` (default `false`) props. Translate `minLines`/`maxLines` into a host `<div>` `min-height`/`max-height` based on resolved `line-height` (with a `1.2 × font-size` fallback). Beyond `maxLines`, content scrolls inside the editor's viewport (CodeMirror default).
- [x] 4.4 Gate the existing `Mod-s` keymap on `enableSaveShortcut`. When `false`, the keymap entry is not registered at all (so `preventDefault` does NOT fire).
- [x] 4.5 Replace any current `defineExpose({ getView, ... })` with `defineExpose({ focus, insertAtCursor })`. Implement `insertAtCursor(text)` by dispatching `EditorView.dispatch({ changes: { from: selectionHead, insert: text }, selection: { anchor: selectionHead + text.length } })` and refocusing.
- [x] 4.6 Add `reader-src/src/components/__tests__/VentoCodeEditor.test.ts` covering: mount + `update:source`, readOnly blocks input, `insertAtCursor` inserts at caret, `Mod-s` is no-op when `enableSaveShortcut=false`, `Mod-s` emits `save-request` when `true`, `maxLines` triggers internal scrollbar.

## 5. Update Template Editor page consumer

- [x] 5.1 Update `reader-src/src/components/TemplateEditorPage.vue` to import `VentoCodeEditor`, pass `enable-save-shortcut="true"`, pass the existing `templatePath` (path-form).
- [x] 5.2 Ensure the existing "insert variable" controls on the Template Editor page now call `editorRef.value?.insertAtCursor(...)` instead of poking the EditorView directly.
- [x] 5.3 Re-run `TemplateEditorPage.test.ts`; fix any breakage from the rename + API surface change.

## 6. PromptEditor message card wiring

- [x] 6.1 In `reader-src/src/components/PromptEditorMessageCard.vue`, remove the `<textarea class="card-body">` and the `useAutoresize` hookup that drove the three-line floor.
- [x] 6.2 Mount `<VentoCodeEditor>` in its place. Bind `:source="props.card.body"` and `@update:source="(v) => emit('update:body', v)"`. Pass `lint-params="{ kind: 'prompt-message-body', role: props.card.role }"` (or equivalent — the actual prop name from task 4.2). Pass `enable-save-shortcut="false"`, `min-lines="3"`, `max-lines="20"`.
- [x] 6.3 In `reader-src/src/components/PromptEditor.vue` (the page), fetch the catalog ONCE via `fetchVariableCatalog({ kind: 'prompt-message-body', series, story })` when series/story changes, and pass the resulting `variables[]` prop reference to every card. Show a fallback empty array on fetch error (logs the error).
- [x] 6.4 Implement lazy-lint: in `VentoCodeEditor`, suppress the initial mount lint when `lazy-lint` prop is `true` (defaults `false` for back-compat with Template Editor page). Set `lazy-lint="true"` from card mounts. Trigger the first lint on either first user edit OR first `focus` event, whichever comes first.
- [x] 6.5 Re-implement "插入變數" helper to call `editorRef.value?.insertAtCursor(\`{{ ${name} }}\`)`. Restore focus after insertion.
- [x] 6.6 Update `reader-src/src/components/__tests__/PromptEditorMessageCard.test.ts` (and `PromptEditor.test.ts`): assert `<textarea class="card-body">` is gone, `VentoCodeEditor` is mounted with the right props, typing emits `update:body`, the variable helper inserts at caret, unknown variable lints, nested `{{ message }}` raises `vento.message-nested`. Catalog is fetched once across N cards.
- [x] 6.7 Remove dead CSS rules for `.card-body` and the `useAutoresize` import if no remaining consumer exists.

## 7. Lore editor wiring

- [x] 7.1 In `reader-src/src/components/lore/LoreEditor.vue`, remove the `<textarea class="field-textarea">` and its `v-model` on `content`.
- [x] 7.2 Mount `<VentoCodeEditor>` in its place. Compute the lint params: `{ kind: 'lore', scope, series?, story? }` derived from the loaded record. Bind `:source="content"` and `@update:source="(v) => content.value = v"`. Pass `enable-save-shortcut="false"`, `min-lines="5"`, `max-lines="40"`.
- [x] 7.3 When the editor's filename is empty/invalid (new draft), skip lint entirely (pass a `lint-disabled` prop OR omit `lint-params` so the editor falls back to no-network lint).
- [x] 7.4 Fetch the lore catalog via `fetchVariableCatalog({ kind: 'lore', series, story })` when the editor opens a record, pass to the editor as `variables`.
- [x] 7.5 Update `reader-src/src/components/lore/__tests__/LoreEditor.test.ts` to assert textarea absent, `VentoCodeEditor` mounted with `kind: 'lore'`, lint flags unknown lore variable, lint does NOT fire for empty-filename drafts, save button still calls `PUT /api/lore/...`.
- [x] 7.6 Remove `.field-textarea` CSS rules.

## 8. Cross-page integration test

- [x] 8.1 Build and run the container: `bash HeartReverie/scripts/podman-build-run.sh`. Confirm clean startup logs (`podman logs heartreverie 2>&1 | grep -i "error\|warn"`).
- [ ] 8.2 Use `functions.skill(agent-browser)` against `http://localhost:8080/`. Smoke-test:
  - `/settings/template-editor` end-to-end (open system.md, edit, lint, save).
  - `/settings/prompt-editor` — open a 5-card prompt, confirm only ONE `GET /api/templates/variables?kind=prompt-message-body...` request in the network panel; type `{{ user_input }}` → no warning; type `{{ wat }}` → warning; type `{{ message "user" }}x{{ /message }}` inside a system-role card → `vento.message-nested` error.
  - `/settings/lore` — open a passage, type `{{ lore_character }}` (assuming such a tag exists) → no warning. Type `{{ user_input }}` → warning. Click "Create new passage" with empty filename → no lint network calls.
  - Theme switch (default → light → dark) recolours all three editors live (highlight + gutters + active line).

## 9. Documentation

- [x] 9.1 Update `HeartReverie/docs/prompt-template.md` to mention that the same Vento editor is available everywhere Vento content is edited; remove any guidance that implies the prompt-editor or lore-editor only accepts plain text.
- [x] 9.2 Update `HeartReverie/README.md` settings overview if it describes the prompt-editor or lore pages as textarea-based.

## 10. Validation

- [x] 10.1 Run `openspec validate vento-editor-everywhere --strict`.
- [x] 10.2 Run full frontend Vitest and backend `deno task test:backend`; all green.
- [x] 10.3 Hand off for archive.
