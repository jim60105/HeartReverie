## Why

The Template Editor (`/settings/template-editor`) ships a fully-featured CodeMirror 6 Vento editor with syntax highlighting, autocomplete, hover docs, lint diagnostics, theme-reactive colours, and a known variable catalog — yet two other places in the same Settings area still expose plain `<textarea>` elements for editing the exact same Vento content:

- `/settings/prompt-editor` → `PromptEditorMessageCard.vue` — the per-message body that drives `system.md` blocks (`{{ message "system" }}` … `{{ /message }}`). Users edit Vento here without highlighting, autocomplete, or `vento.unknown-variable` warnings.
- `/settings/lore` → `lore/LoreEditor.vue` — the lore-passage `content` field. Lore passages are rendered through the same Vento environment and may reference `lore_*`, `series_name`, `story_name`, but today edits happen in a raw textarea with zero feedback.

This inconsistency forces authors to round-trip into the Template Editor (or trial-and-error) just to validate variables they could see live everywhere else. We can land the same editing experience by extracting the editor as a reusable component and mounting it in both places.

## What Changes

- **Extract** the CodeMirror Vento editor that today lives inside `reader-src/src/components/TemplateEditor.vue` into a standalone, prop-driven Vue component (working name `VentoCodeEditor.vue`) that owns: Vento language support, autocomplete, hover docs, lint diagnostics, the theme-reactive `ventoHighlightStyle`, the theme-tokenised gutter styles, and the resize / focus behaviour.
- **Wire the new component into `PromptEditorMessageCard.vue`** replacing the `.card-body` `<textarea>` (lines 207–214). The editor MUST emit the same `v-model`-style `update:body` events, retain the existing autosave debounce, preserve the read-only state path, and feed lint with the **new `kind: "prompt-message-body"` scope** so the backend wraps the body in `{{ message "<role>" }}` … `{{ /message }}` before parsing. This catches nested-message errors (`vento.message-nested`) that would otherwise hide until prompt serialization.
- **Wire the new component into `lore/LoreEditor.vue`** replacing the `.field-textarea` `<textarea>` (lines 200–208). The editor MUST keep the existing `v-model` contract on the `content` ref, and use a `kind: "lore"` lint scope (catalog: `lore_*`, `series_name`, `story_name` — no plugin variables, no `user_input`).
- **Backend changes are required** (despite the original draft saying otherwise):
  - `POST /api/templates/lint` SHALL accept an alternative request shape that carries `{ kind, source, series?, story?, role?, pluginName? }` *without* a real on-disk `templatePath`, so virtual mount sites (an unsaved lore draft, an in-memory prompt-editor card) can request diagnostics. For `kind: "prompt-message-body"` the route SHALL synthesize a `{{ message "<role>" }}\n${source}\n{{ /message }}` buffer before parsing and SHALL map diagnostic offsets back to the original `source` range.
  - A catalog endpoint (extending the existing `GET /api/templates/variables` or a new sibling) SHALL accept a `kind` query parameter and return the catalog `buildVariableCatalog()` already computes per kind (`system`, `plugin-fragment`, `lore`, `prompt-message-body`). The lore catalog SHALL honour the `series` / `story` query parameters so the right `lore_*` tags resolve.
- **Lint catalog plumbing**: host components compute the appropriate `kind` + scope inputs, request the catalog via the new endpoint, and pass it to the editor as `variables`. The editor stays catalog-agnostic — no new HTTP coupling inside `VentoCodeEditor.vue`.
- **`Mod-s` keymap is opt-in**: the existing `Mod-s` binding inside the Template Editor always preventDefaults and emits `save-request`. The shared component SHALL add a `enableSaveShortcut?: boolean` prop (default `false`) so hosts that do not handle saves don't swallow the shortcut. The Template Editor page sets it to `true`.
- **Variable insertion is encapsulated**: the editor SHALL expose a narrow imperative method `insertAtCursor(text: string): void` (via `defineExpose`) instead of leaking the raw `EditorView`. The existing "插入變數" helper in `PromptEditorMessageCard.vue` consumes this method.
- **Preview** is intentionally OUT of scope here. The two reuse sites edit content that already has its own surrounding workflow (message ordering / save action; lore record save); we are not adding the default/current-story preview pane to either page. Only lint + completion + hover + theme styling carry over.
- **Tests**: add Vitest coverage for the extracted component (`VentoCodeEditor.test.ts`) covering mount/unmount, prop reactivity, lint catalog wiring, theme-token reflow; update existing tests for `PromptEditorMessageCard.test.ts` and `lore/LoreEditor.test.ts` (or add them if missing) to assert the editor replaces the textarea and re-emits content changes.
- **Documentation**: update `docs/prompt-template.md` and any user-facing settings copy to mention that prompt-message bodies and lore content now provide the same highlighting + linting as the Template Editor.

No backward compatibility required (0 users in the wild). Old textarea code paths are removed, not deprecated.

## Capabilities

### New Capabilities

_(none — the Vento editor capability is already covered by `template-editor`; this change extracts its UI portion for reuse.)_

### Modified Capabilities

- **Modified Capabilities**:
  - `prompt-editor-message-cards`: per-message body editor swaps to shared CodeMirror Vento editor with `kind: "prompt-message-body"` lint scope (body wrapped in `{{ message }}` before parsing).
  - `lore-editor-ui`: passage content editor swaps to the shared editor with `kind: "lore"` lint scope.
  - `template-editor`: page consumes the same extracted component instead of inlining its own editor (refactor).
  - `vento-prompt-template` / template-editor backend: `POST /api/templates/lint` gains a `kind`+`source` request shape that bypasses `parseTemplatePath` for virtual sites, and `GET /api/templates/variables` (or sibling) gains a `kind` query parameter so non-system catalogs are reachable.

## Impact

- **Frontend code**:
  - New: `reader-src/src/components/VentoCodeEditor.vue` (renamed from `TemplateEditor.vue`) + test.
  - Modified: `reader-src/src/components/TemplateEditorPage.vue`, `PromptEditorMessageCard.vue`, `lore/LoreEditor.vue`, and their test files.
  - Likely touched: `reader-src/src/lib/template-api.ts` — add `lintBySource({ kind, source, ... })` and `fetchVariableCatalog({ kind, series?, story?, pluginName? })`.
- **Backend code**:
  - `writer/routes/templates.ts` — extend `POST /api/templates/lint` to accept the kind+source request shape; extend variables endpoint to honour `kind` query parameter; for `kind: "prompt-message-body"` wrap source in `{{ message "<role>" }}` … `{{ /message }}` before parsing and translate diagnostic offsets back. Backend tests cover the three new request shapes.
- **Build / deps**: no new dependencies.
- **Tests**: ~+1 Vitest file (component), ~+2 updated Vitest files (card + lore editor), ~+1 backend test file extension.
- **Verification**: per project policy, after implementation we build via `scripts/podman-build-run.sh` and exercise both pages with `functions.skill(agent-browser)` to confirm highlighting + lint warnings appear in the prompt-editor message body and lore content fields, with theme switches re-tinting all three editors live.
