## Context

The HeartReverie frontend uses a plugin system where each plugin registers `frontend-render` hooks via its `frontend.js` file. These hooks extract XML blocks (e.g., `<status>`, `<options>`, `<UpdateVariable>`) from chapter text, parse them, render HTML strings, and store them in `context.placeholderMap`. The core markdown renderer reinserts the HTML at placeholder positions within `html` tokens.

During the Vue refactor, Vue components (`StatusBar.vue`, `OptionsPanel.vue`, `VariableDisplay.vue`), TypeScript parsers, and type interfaces were created in `reader-src/` based on a spec that described a 5-variant `RenderToken` union. However, the implementation correctly chose plugin delegation instead. The Vue components were never connected to the rendering pipeline — `ChapterContent.vue` only branches on `html` and `vento-error` tokens. The dead code now coexists with the working plugin `frontend.js` files, causing confusion.

## Goals / Non-Goals

**Goals:**
- Remove all dead code from `reader-src/` that duplicates plugin `frontend.js` functionality
- Make sidebar relocation plugin-agnostic (generic `.plugin-sidebar` class)
- Update specs to accurately describe the plugin-rendered architecture
- Ensure zero behavior change — the rendering pipeline remains identical

**Non-Goals:**
- Rewriting plugins in TypeScript or Vue (plugins remain vanilla JS)
- Plugin CSS bundling system (CSS stays in global `base.css`)
- Changing the plugin hook contract (`frontend-render` context shape unchanged)
- Addressing other spec misalignments found in the audit (naming, missing features, CSP)

## Decisions

### Decision 1: Delete dead code, don't move it

The Vue components, parsers, and types in `reader-src/` are dead code — they duplicate logic that already exists in each plugin's `frontend.js`. Deleting them is the right action, not moving them. The plugins already have working vanilla JS implementations.

**Alternative considered**: Convert plugin `frontend.js` to import from `reader-src/` TypeScript modules. Rejected because plugins load via dynamic `import('/plugins/{name}/frontend.js')` at runtime — they can't import from the Vite-bundled TypeScript codebase without a plugin build step that doesn't exist.

### Decision 2: Generic `.plugin-sidebar` class for sidebar relocation

Replace `ContentArea.vue`'s hardcoded `.status-float` query with `.plugin-sidebar`. Any plugin that wants its rendered HTML relocated to the sidebar can add this class to its output. The `watchPostEffect` DOM relocation pattern in `ContentArea.vue` is appropriate for plugin-rendered HTML (it's `v-html`, not Vue components, so `<Teleport>` cannot apply).

**Alternative considered**: Plugin-specific sidebar hooks. Rejected — the CSS class approach is simpler and already works.

### Decision 3: Keep CSS in base.css with documentation

Plugin-rendered HTML arrives as raw strings via `v-html`. There's no mechanism for plugins to inject scoped CSS. The global `base.css` stylesheet must contain the styles for plugin output (`.char-header`, `.era-actions-container`, `.variable-content`, etc.). Adding comments to document which CSS blocks serve which plugin is sufficient.

**Alternative considered**: Inject `<style>` tags from plugin `frontend.js`. Rejected — adds complexity, risks duplicate styles, and breaks the clear separation between CSS (main project) and behavior (plugins).

## Risks / Trade-offs

- **[Risk]** Removing tests reduces total test count → **Mitigation**: The removed tests test dead code. Working plugin behavior is verified by integration tests and the rendering pipeline tests.
- **[Risk]** `.plugin-sidebar` is a convention, not an enforced contract → **Mitigation**: Documented in plugin-hooks spec. Same pattern as existing `displayStripTags` manifest convention.
- **[Risk]** CSS in `base.css` for plugin output creates implicit coupling → **Mitigation**: Acceptable trade-off given the plugin system's dynamic loading constraint. Documented with comments identifying each plugin's CSS block.
