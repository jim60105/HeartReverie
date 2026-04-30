## Why

The current `normalizeQuotes()` utility in `reader-src/src/lib/markdown-pipeline.ts` rewrites every Unicode quote pair (`"` `"`, `«` `»`, `「` `」`, `｢` `｣`, `《` `》`, `„`) into ASCII `"` at frontend render time. The behaviour was ported from a SillyTavern legacy regex that existed solely to enable a CSS-driven dialogue-colorization feature that could only target ASCII straight quotes. Modern browsers expose the **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()` pseudo-element), which can paint arbitrary text ranges without modifying the DOM at all. Combined with the HeartReverie plugin system, this lets us colour every supported quote pair while leaving the original characters and the rendered HTML structure completely intact — so readers see the original CJK corner quotes (and other typographic marks) the LLM produced.

## What Changes

- **BREAKING**: Remove the `normalizeQuotes()` utility, its call site in `useMarkdownRenderer.ts`, its dedicated unit tests, and the corresponding requirement from the `md-renderer` spec. Rendered output SHALL preserve the original quote characters as authored by the LLM.
- Add a new built-in plugin `dialogue-colorize` (manifest `"type": "frontend-only"`) that walks live chapter DOM after Vue commits, finds matched dialogue quote pairs (the six pairs `"…"`, `"…"`, `«…»`, `「…」`, `｢…｣`, `《…》` previously normalized by `normalizeQuotes()`), creates `Range` objects for each match, and registers them via `CSS.highlights.set("dialogue-quote-<suffix>", new Highlight(...))`. The plugin ships a `frontendStyles` CSS file with `::highlight(dialogue-quote-<suffix>) { color: var(--dialogue-color, …) }` rules. **No DOM mutation occurs**; the plugin never inserts elements, never edits `tok.content`, never touches `innerHTML`.
- Add a new frontend hook stage `chapter:dom:ready` to the plugin hook system, dispatched from `ChapterContent.vue` after Vue has committed `v-html` updates to the chapter container DOM (using a `flush: "post"` watcher so the dispatch happens after Vue's reactive flush). Context: `{ container: HTMLElement, tokens: RenderToken[], rawMarkdown: string, chapterIndex: number }`. This is the canonical hook for plugins that need to inspect or annotate live rendered DOM nodes (as opposed to the pre-commit token list available via `chapter:render:after`).
- Browsers older than the Custom Highlight API baseline (Chrome 105, Safari 17.2, Firefox 140) SHALL fall back gracefully: the plugin SHALL detect `typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"` at registration time and become a no-op when the API is missing. In that fallback the original quote characters still render correctly; only the colour is absent.

## Capabilities

### New Capabilities
- `dialogue-colorize-plugin`: A built-in `frontend-only`-typed plugin (frontend module + CSS only) that colourizes dialogue-quoted runs in rendered chapters via the CSS Custom Highlight API, leaving the rendered HTML structure unchanged.

### Modified Capabilities
- `md-renderer`: Remove the `Quote character normalisation` requirement and add a new `Quote character preservation` requirement.
- `plugin-hooks`: Add a new frontend hook stage `chapter:dom:ready`.
- `vue-component-architecture`: Require `ChapterContent.vue` to dispatch `chapter:dom:ready` after Vue commits its `v-html` token render to the live DOM.

## Impact

- **Code removed**: `normalizeQuotes` export and its call site in `reader-src/src/lib/markdown-pipeline.ts` and `reader-src/src/composables/useMarkdownRenderer.ts`; the `normalizeQuotes` `describe` block in `reader-src/src/lib/__tests__/markdown-pipeline.test.ts`.
- **Code added**: New plugin directory `plugins/dialogue-colorize/` containing `plugin.json`, `frontend.js`, `styles.css`, `README.md`. New unit tests under `tests/plugins/dialogue-colorize/` and a frontend integration test under `reader-src/src/composables/__tests__/`.
- **Hook system**: New stage `"chapter:dom:ready"` in `reader-src/src/types/index.ts` `FrontendHookStage` union, new context type `ChapterDomReadyContext` in `reader-src/src/lib/plugin-hooks.ts`, registered in `KNOWN_FRONTEND_STAGES`.
- **Component change**: `ChapterContent.vue` gains a `flush: "post"` watcher on `[tokens, renderEpoch]` that dispatches `chapter:dom:ready` with the live root container element after each render commit (and once on mount).
- **Specs updated**: `openspec/specs/md-renderer/spec.md`, `openspec/specs/plugin-hooks/spec.md`, `openspec/specs/vue-component-architecture/spec.md`, and a new `openspec/specs/dialogue-colorize-plugin/spec.md`.
- **No backend or API surface changes**: the plugin is frontend-only and uses the existing `frontendStyles` CSS injection capability plus the new `chapter:dom:ready` hook.
- **No breaking change in disk/wire formats**: chapter `.md` files, prompt assembly, the LLM request body, and exports already preserve the original characters; rendered DOM is also unchanged. Only the PAINT layer differs.
- **Documentation**: Update `AGENTS.md` "Project Structure" and the hook-stages documentation block to add `dialogue-colorize/` and `chapter:dom:ready`. Refresh `docs/plugin-system.md` if it enumerates built-in plugins or hook stages.
- **Browser baseline**: targets Chrome 105+, Safari 17.2+, Firefox 140+. Older browsers receive a no-op fallback (no colour, no error).
