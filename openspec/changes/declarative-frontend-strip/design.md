## Context

The plugin system currently supports a `frontend-strip` hook stage where plugins register JavaScript handlers to remove XML tags from rendered output. All 5 plugins using this hook follow an identical pattern: a single `context.text.replace(regex, '')` call at priority 100. Each requires a separate `frontend.js` file, a `frontendModule` declaration in `plugin.json`, and dynamic `import()` at runtime — pure boilerplate for a regex replacement.

Meanwhile, the backend already has a declarative `stripTags` manifest field that handles prompt-time tag stripping (from previousContext) without code. The frontend has no equivalent. Since no external plugins exist, removing `frontend-strip` entirely is safe.

## Goals / Non-Goals

**Goals:**

- Introduce `displayStripTags` in `plugin.json` for declarative frontend tag stripping (same format as `promptStripTags`: plain tag names or `/regex/flags` strings)
- Remove the `frontend-strip` hook stage from `FrontendHookDispatcher`
- Delete all 5 strip-only `frontend.js` files: `t-task`, `user-message`, `imgthink`, `context-compaction`, `threshold-lord`
- Apply declarative strip patterns in `md-renderer.js` using plugin metadata from `/api/plugins`
- Rename `stripTags` to `promptStripTags` in all plugin manifests, backend code, types, and documentation to clearly distinguish prompt-time stripping from display-time stripping
- Update 3 render-only plugins' manifests (`options`, `status`, `state-patches`) to remove unnecessary `tags` field if it was only used for `frontend-strip` registration

**Non-Goals:**

- Changing the `frontend-render` hook system — render plugins still use JavaScript modules
- Modifying the backend `promptStripTags` compilation mechanism — it already works declaratively (only the field name changes)
- Supporting dynamic/conditional strip logic — all current patterns are static regex replacements
- Adding `displayStripTags` validation on the backend beyond passing data through the API

## Decisions

### Decision 1: Reuse the `promptStripTags` format for `displayStripTags`

The existing `promptStripTags` (formerly `stripTags`) field supports both plain tag names (auto-wrapped as `<tag>[\s\S]*?</tag>`) and regex pattern strings (`/pattern/flags`). `displayStripTags` will use the identical format, letting plugin authors use the same mental model. The `t-task` plugin uses a regex pattern (`/<T-task\b[^>]*>[\s\S]*?<\/T-task>/g`) because its tag has attributes; others use plain names.

**Alternative considered:** A simpler `string[]` of tag names only. Rejected because `t-task` needs regex pattern support for attribute matching.

### Decision 2: Apply strip patterns in `md-renderer.js` directly

The `plugin-loader.js` already fetches `/api/plugins` metadata. It will collect `displayStripTags` entries from all plugins and pass the combined patterns to `md-renderer.js` as a compiled regex (or array), which applies them during the strip phase — replacing the old `frontendHooks.dispatch('frontend-strip', ...)` call.

**Alternative considered:** Keep `frontend-strip` as a hook and auto-register handlers from `displayStripTags`. Rejected because it adds unnecessary indirection — the hook stage exists only for these regex replacements.

### Decision 3: Remove `frontend-strip` hook stage entirely

Since all 5 uses are simple regex replacements and no external plugins exist, the `frontend-strip` stage is removed from `FrontendHookDispatcher`. The `plugin-hooks.js` dispatcher will no longer accept `frontend-strip` as a valid stage name.

**Alternative considered:** Keep the hook as deprecated. Rejected because there are no external consumers and keeping dead code adds maintenance burden.

### Decision 4: Backend API exposes `displayStripTags` in plugin metadata

The `GET /api/plugins` endpoint already returns plugin metadata including `tags` and `hasFrontendModule`. It will additionally include `displayStripTags` arrays so the frontend can collect patterns without needing separate endpoints. The backend does not validate or compile the patterns — it passes them through as strings.

### Decision 5: Plugins with only `displayStripTags` (no `frontendModule`) skip module loading

After this change, plugins that only strip tags declaratively (no `frontend-render` handler) will not need a `frontendModule` field at all. The `plugin-loader.js` will apply their `displayStripTags` from metadata alone. This removes the need for 5 `frontend.js` files.

Plugins that still need `frontend-render` (options, status, state-patches) keep their `frontendModule` and are loaded as before.

### Decision 6: Rename `stripTags` to `promptStripTags`

To clearly distinguish the two strip tag mechanisms — prompt-time stripping (backend, from previousContext) vs display-time stripping (frontend, from rendered output) — the existing `stripTags` manifest field is renamed to `promptStripTags`. This aligns with SillyTavern's naming conventions where regex effects are scoped by where they apply: prompt vs display. The rename touches all plugin manifests, `PluginManifest` type definition, `PluginManager` code, tests, and documentation.

**Alternative considered:** Keep `stripTags` unchanged. Rejected because having `stripTags` alongside `displayStripTags` creates confusion about scope — the `prompt` prefix makes the distinction explicit.

## Risks / Trade-offs

**[Reduced extensibility]** → Acceptable because all current strip patterns are static regex replacements. If a future plugin needs dynamic/conditional stripping, a `frontend-render` handler can achieve the same result by modifying `context.text` during the render phase.

**[Pattern compilation in frontend]** → Patterns are compiled once during plugin loading, not per render. The combined regex is cached. Performance impact is negligible.

**[Breaking change for `frontend-strip` hook]** → No external plugins exist. The hook stage name is removed from the dispatcher. This is a clean break.
