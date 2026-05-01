## Why

The `/settings/prompt-editor` page currently scrolls as a single document: when the user pastes a long template into the textarea or the rendered preview is taller than the viewport, the whole settings page (sidebar, toolbar, both panes) is pushed down together, hiding the toolbar and the preview header. Each pane should manage its own scroll so the toolbar and preview header stay pinned and the user can scroll the editor and the preview independently of each other.

## What Changes

- Constrain the settings layout to exactly the viewport height **only when the prompt-editor route is active** so that the document body never produces a scrollbar while the user is on `/settings/prompt-editor`. Other settings tabs (`/settings/lore`, `/settings/llm`) are not modified by this change. The route-scoped cap is implemented in plain CSS via the `:has(.editor-page)` selector against the layout root, written in the non-scoped global stylesheet so no Vue scoped-style attribute games are needed.
- Make `.editor-textarea` (inside `PromptEditor.vue`) the only scroll container for the template text — its toolbar and variable pills remain pinned while the textarea scrolls internally.
- Make `.preview-content` (inside `PromptPreview.vue`) the only scroll container for the rendered preview text — the preview header, meta, and error rows remain pinned while the `<pre>` content scrolls internally. Add `min-height: 0; margin: 0; box-sizing: border-box` to `.preview-content` to harden the clip context (default `<pre>` margin would otherwise leak outside the clip).
- Decouple the two panes' scroll positions: scrolling the editor textarea SHALL NOT scroll the preview, and vice versa. Each pane has its own independent scroll container (no shared CSS scroll-sync, no `scroll-padding-block` linkage).
- On the mobile/stacked layout (≤767px) the same route-scoped rule holds: each stacked pane caps its height share of the viewport and scrolls its own content; the page itself remains non-scrolling. Mobile-narrow viewports may produce visually cramped panes when the toolbar/variable-pills row wraps onto multiple lines — this is accepted as a known trade-off (see design.md).
- No backward compatibility shim is needed — the project is pre-release with zero external users.

## Capabilities

### New Capabilities
<!-- None: this is a behaviour fix to existing UI surfaces. -->

### Modified Capabilities
- `settings-page`: when the prompt-editor route is rendered (i.e., `.editor-page` exists in the DOM), the settings layout SHALL constrain its own height to the viewport so the prompt-editor page can manage internal scroll regions; the document body is no longer the scroll container for `/settings/prompt-editor`. This rule does NOT apply to other `/settings/*` routes — the cap is route-scoped via the `:has(.editor-page)` selector.
- `prompt-editor`: the editor textarea SHALL be the sole scroll container for template text within the prompt-editor page; the page itself and the toolbar/pills row do not scroll.
- `prompt-preview`: the preview `<pre>` content SHALL be the sole scroll container for rendered prompt text within the prompt-editor page; the header/meta rows stay pinned and the preview's scroll position is independent of the editor's.

## Impact

- **Affected files**:
  - `reader-src/src/styles/base.css` — add a top-level rule `.settings-layout:has(.editor-page) { height: 100vh; height: 100dvh; overflow: hidden; }` so the cap is route-scoped without disturbing other settings tabs and without Vue scoped-style attribute issues.
  - `reader-src/src/components/SettingsLayout.vue` — leave `.settings-layout`'s default `min-height: 100vh` unchanged (other tabs continue to grow as today); ensure `.settings-content` keeps its `min-height: 0` flex-clip chain.
  - `reader-src/src/components/PromptEditorPage.vue` — verify the existing `flex: 1; min-height: 0` chain on `.editor-page`, `.editor-page-main`, and `.editor-page-preview` cleanly clips children (no behavioural change expected, but reviewed as part of this work).
  - `reader-src/src/components/PromptEditor.vue` — make the textarea wrap a strict `flex: 1; min-height: 0; overflow: hidden` clip and keep the textarea itself sized to fill it with native textarea scrolling.
  - `reader-src/src/components/PromptPreview.vue` — keep `.preview-root` as `flex: 1; min-height: 0; overflow: hidden`; harden `.preview-content` with `min-height: 0; margin: 0; box-sizing: border-box` in addition to the existing `flex: 1; overflow: auto` so default `<pre>` margins do not break the clip chain.
- **Tests**: extend Vitest coverage with **CSS contract tests** (asserting raw stylesheet text or class declarations, not computed layout) since the test environment is Happy DOM and does not perform real layout. Layout-effect scenarios (body `scrollTop`, pinned-toolbar visibility) are validated via manual browser smoke, not unit tests. The unit-level scroll-isolation test asserts only the absence of scroll-sync behaviour (mutating one container's `scrollTop` does not mutate the other's), labelled narrowly.
- **APIs/dependencies**: none. Pure CSS + flex-chain change; no new packages, no backend changes.
- **No data migration**: zero external users; no persisted UI state to migrate.
- **Browser support**: `:has()` is supported in Chrome/Edge ≥ 105, Firefox ≥ 121, Safari ≥ 15.4 (all current at time of writing). HeartReverie already requires modern browsers (File System Access API ≥ Chrome 86, secure-context-only). `100dvh` has equivalent support; `100vh` is declared as a fallback.
