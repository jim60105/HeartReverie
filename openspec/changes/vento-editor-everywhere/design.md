## Context

The Template Editor change (archived as `2026-05-14-template-lint-preview`) introduced three frontend modules that together form the Vento authoring stack:

- `reader-src/src/components/TemplateEditor.vue` — a CodeMirror 6 EditorView host. Its `<script setup>` already takes only the props that matter for editing (`source`, `templatePath`, `variables`, `readOnly`, `series`, `story`) and emits `update:source` / `lint` / `save-request`. It does **not** know about the file tree, the preview modal, the readonly pill, or any page chrome — those live in `TemplateEditorPage.vue`.
- `reader-src/src/lib/cm-vento.ts` — language support, `ventoLinter`, and `ventoHighlightStyle`.
- `reader-src/src/lib/cm-vento-complete.ts` — autocomplete + hover docs source.
- `reader-src/src/lib/template-api.ts` — `lintTemplate({ templatePath, source })` HTTP client.

The two reuse sites are tiny, focused components:

- `PromptEditorMessageCard.vue` (~250 lines) — one card per message in the system prompt builder. The card already manages role, header, autocomplete-by-variable, and an autosave debounce; the only Vento-aware piece is the `<textarea class="card-body">` that drives `card.body`.
- `lore/LoreEditor.vue` (~400 lines) — the right pane that edits one lore record. Its `<textarea class="field-textarea">` drives a `content` ref.

Both currently treat the body as opaque text; neither has any link into the lint API or the variable catalog.

## Goals / Non-Goals

**Goals:**
- Single component (`VentoCodeEditor.vue`) is the only place the CodeMirror EditorView is constructed in the reader-src tree.
- The Template Editor page, the prompt-editor message cards, and the lore editor mount the same component and see identical highlighting, completion, hover docs, lint diagnostics, gutter colours, and theme reactivity.
- Lint scope is configurable per host: prompt-editor message → `kind: "system"`; lore editor → `kind: "lore"`; template editor → forwards whatever the file tree selected.
- Existing Vitest coverage stays green; new component has its own Vitest mount tests.

**Non-Goals:**
- No preview pane in the prompt-editor or lore-editor pages. Their existing save/apply flows are untouched.
- No backend changes. `POST /api/templates/lint` already accepts the three `kind` values we need.
- No new dependencies. We're rearranging modules that already shipped.
- No reduction in the Template Editor's own feature set (preview modal, readonly pill, save toolbar). Those keep living in `TemplateEditorPage.vue`.

## Decisions

### Decision 1 — Rename `TemplateEditor.vue` → `VentoCodeEditor.vue`

The current `TemplateEditor.vue` already has the exact reusable surface we need. Renaming makes the reuse intent obvious and prevents future contributors from inferring "this is the Template Editor page's editor, don't touch it."

Alternatives considered:
- *Keep the name and re-export from a new file.* — Adds indirection without value; the file is the editor.
- *Inline the editor again in each page.* — Defeats the purpose.

### Decision 2 — Hosts own the lint catalog inputs; the editor stays catalog-agnostic

`VentoCodeEditor.vue` already takes `variables: VariableEntry[]` as a prop. Hosts compute the catalog by calling a new helper (`buildVariableCatalog({ kind, series, story, pluginName })`) that wraps the existing `/api/templates/list-variables`-style logic OR calls a fresh helper that runs the same scope rules locally if the endpoint is missing. We will reuse whatever the Template Editor page does today — likely a call to `lintTemplate` returns the catalog as part of the response, OR `template-api.ts` exposes a separate `fetchVariableCatalog` helper. (Verify during apply.)

Rationale: the editor must not bake in scope rules — that's how we end up with three subtly different catalogs over time. Hosts know their context and pass the right catalog in.

Alternatives considered:
- *Editor fetches its own catalog from a `kind` prop.* — Couples the component to the HTTP layer; harder to test.
- *Skip the catalog entirely in reuse sites.* — Strips the main value (autocomplete + unknown-variable warnings).

### Decision 3 — Backend lint API accepts a virtual `{ kind, source, ... }` request shape

The current `POST /api/templates/lint` route runs `parseTemplatePath(templatePath)` before linting and only accepts the four real path forms (`system.md`, `plugin:<name>:<rel>`, `lore:global:<rel>`, `lore:series:<series>:<rel>`, `lore:story:<series>:<story>:<rel>`). The proposed virtual paths like `system:<message-id>` are rejected outright.

The change therefore adds an alternative request body:

```jsonc
{
  "kind": "system" | "plugin-fragment" | "lore" | "prompt-message-body",
  "source": "...",
  "series": "demo",          // optional, required for kind="lore" w/ series scope
  "story": "intro",          // optional, required for kind="lore" w/ story scope
  "scope": "global"|"series"|"story", // required for kind="lore"
  "role": "system"|"user"|"assistant", // required for kind="prompt-message-body"
  "pluginName": "..."        // optional, required for kind="plugin-fragment"
}
```

The route SHALL branch on the presence of `kind` (without `templatePath`) and:
- Skip `parseTemplatePath` entirely.
- For `kind: "prompt-message-body"` synthesize a parse buffer `{{ message "<role>" }}\n${source}\n{{ /message }}` and translate diagnostic offsets back to the original source span (subtract the prepended wrapper length, drop any diagnostics that point inside the synthetic wrapper).
- Build the variable catalog through the existing `buildVariableCatalog(kind, { series, story, pluginName })` helper.

For backwards compatibility (the Template Editor page itself), the existing `{ templatePath, source }` shape continues to work.

A sibling catalog endpoint follows the same kind-based shape:

```
GET /api/templates/variables?kind=lore&series=demo&story=intro
GET /api/templates/variables?kind=prompt-message-body
```

Currently `GET /api/templates/variables` hardcodes `kind: "system"`; this change adds the `kind` query parameter (default remains `system` for backwards compat) and threads `series` / `story` / `pluginName` through `buildVariableCatalog`.

Alternatives considered:
- *Synthesize a fake `templatePath` that smuggles `kind` and ids into the string.* — Fragile, leaks into URL paths and logs.
- *Make `templatePath` optional and infer kind from a separate field but reuse the route.* — That IS what this decision proposes.
- *Lint client-side only.* — Would duplicate ~600 LOC of parser/catalog logic into the SPA bundle.

### Decision 4 — Prompt-message-body lint wraps the source in `{{ message }}` before parsing

A message card body is a fragment that becomes nested inside `{{ message "<role>" }}` … `{{ /message }}` only at `serializeMessageCards()` time. Linting the raw fragment as `kind: "system"` would silently accept a user who pastes a nested `{{ message "..." }}` block — the resulting serialised prompt would emit a nested-message error at runtime that no editor ever previewed.

By having the backend wrap the body in a real `{{ message "<role>" }}` … `{{ /message }}` and parse the wrapped string, the existing `vento.message-nested` rule fires naturally on the fragment. The route SHALL filter out any diagnostic whose offset falls inside the synthetic wrapper range and SHALL subtract the wrapper prefix length from every other offset so the SPA's CodeMirror lint markers land on the user's actual text.

### Decision 5 — `Mod-s` keymap is opt-in via `enableSaveShortcut` prop

The current Template Editor binds `Mod-s` unconditionally inside the editor:

```ts
{
  key: "Mod-s",
  preventDefault: true,
  run: () => { emit("save-request"); return true; },
}
```

If we move this keymap into the shared component and reuse it in pages that DON'T have an explicit save flow (prompt editor relies on autosave-on-input; lore has a button but no shortcut convention), `Cmd/Ctrl+S` gets swallowed and produces no feedback.

The shared component SHALL add an `enableSaveShortcut?: boolean` prop (default `false`) that gates the keymap entry. `TemplateEditorPage.vue` passes `true`; the other two hosts leave it at the default.

### Decision 6 — Variable-helper inserts via a narrow imperative method

The proposal originally suggested exposing the raw `EditorView` via `defineExpose({ getView })`. This leaks CodeMirror's full mutation API to every host and invites accidental misuse (changing readonly state, dispatching arbitrary effects, etc.).

Replace with a single method:

```ts
defineExpose({
  insertAtCursor(text: string): void,
  focus(): void,
})
```

The "插入變數" helper in `PromptEditorMessageCard.vue` calls `editorRef.value?.insertAtCursor(\`{{ ${name} }}\`)`. The Template Editor page does the same for its existing insert helpers.

### Decision 7 — New lore drafts use a `__draft__.md` placeholder rel

When a user clicks "Create new passage" but hasn't typed a filename yet, `lore/LoreEditor.vue` has no valid `rel`. The new `kind: "lore"` request shape sidesteps `parseTemplatePath`, but the SPA still needs to know which `scope`, `series`, and `story` to pass for the catalog. The component SHALL synthesise these from the editor's already-loaded record context (scope tab + current series/story) and omit `rel` entirely (the kind+catalog flow has no use for it). If the user has typed an invalid filename, lint requests SHALL be skipped (no diagnostics) until the filename is either empty (use draft scope) or valid.

### Decision 8 — Per-card lint debounce + shared catalog fetch

For prompt-editor pages with N cards, we MUST NOT issue N catalog fetches and N immediate lint POSTs at mount time. The page (`PromptEditor.vue`) SHALL fetch the `kind: "prompt-message-body"` catalog **once** for the current series/story and pass the same `variables` prop reference to every card. Lint requests SHALL be debounced per card at 500ms (matching the Template Editor's existing debounce) and SHALL NOT fire on initial mount — only after the first user edit OR when the card first receives keyboard focus, whichever comes first. This bounds the API burst to user-driven activity.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Renaming `TemplateEditor.vue` breaks imports in `TemplateEditorPage.vue` and its tests. | Single grep + replace across reader-src; covered by the existing Vitest suite. Apply phase runs full Vitest before commit. |
| The new lint request shape silently regresses existing Template Editor scenarios. | Backend keeps the `{ templatePath, source }` shape working; new shape is additive. Backend tests cover both code paths. |
| Diagnostic offset translation for `kind: "prompt-message-body"` is off-by-one and lint markers land on the wrong character. | Compute the wrapper prefix length once (constant for a given `role`) and unit-test the offset translation against three known parse-error positions (start, middle, end of source). |
| `vento.message-nested` (currently in `vento-message-tag` spec) doesn't fire on the synthetic wrapper. | Confirm the existing rule looks at the AST, not the source string; the AST view of the wrapped buffer will contain a nested `{{ message }}` node, which is exactly what the rule already detects. |
| Performance: mounting one CodeMirror view per message card could be heavy. | Decision 8 above: lazy lint on first edit/focus, shared catalog fetch. Verify with podman + agent-browser; 10-card smoke test in tasks. |
| Per-card CodeMirror mount on a 10-card prompt is jarring (~250ms first paint). | Acceptable on settings pages; if the user reports lag, mount visible cards only via `IntersectionObserver`. Out of scope for first cut. |
| Autocomplete popover clipping inside small editor containers. | Existing Template Editor `.cm-tooltip` styling uses `position: absolute` above the page; verify both new mount points have z-index headroom. Add scoped `z-index` overrides if needed. |
| Removed textarea auto-resize → fixed-height scroll box surprises authors with long bodies. | Editor's `minLines` defaults to 3; add `maxLines?: number` prop (default `30`) and have the editor's host `<div>` grow to `min(content, maxLines)` lines, then scroll inside. Document in spec scenario. |
| `Mod-s` opt-in misconfiguration: developer forgets to set `enableSaveShortcut={true}` on the Template Editor page → users lose save shortcut. | Vitest assertion in `TemplateEditorPage.test.ts` that the rendered editor has `enableSaveShortcut === true`. |

## Migration Plan

No deployment migration. Frontend ships as a single build; on next reload, users get the new editor in both pages.

Rollback: revert the change commit. No data migration touched anything user-owned.

## Open Questions

_All previously-open questions resolved by the rubber-duck pass:_

1. **Lint catalog source** — Resolved by Decision 3: the SPA calls `GET /api/templates/variables?kind=...` directly and passes the result into the editor as `variables`. Lint responses no longer carry the catalog.
2. **`Mod-s` save shortcut** — Resolved by Decision 5: opt-in via `enableSaveShortcut` prop; only the Template Editor page enables it.
3. **Lore autosave** — Stays out of scope; the existing "儲存" button continues to be the save trigger.
4. **New-lore-draft `templatePath`** — Resolved by Decision 7: `kind: "lore"` request shape never needs `rel`; lint is skipped while the filename is invalid.
