## Context

Plugin `frontend.js` files are vanilla ES modules served by the backend and loaded at runtime via dynamic `import()` in the browser. They cannot `import` from bundled Vue/Vite modules. The original shared `reader/js/utils.js` was removed when the frontend migrated to Vue SPA (`reader-src/`). Commit `9d3f546` inlined `escapeHtml` into each plugin to avoid broken imports, producing 4 identical copies.

Current plugin serving: `registerPluginRoutes()` in `writer/routes/plugins.ts` iterates registered plugins and creates a route for each `frontendModule` at `/plugins/${name}/${path}`. Files outside a plugin directory are not served.

## Goals / Non-Goals

**Goals:**
- Consolidate duplicated `escapeHtml` into a single shared module at `plugins/_shared/utils.js`
- Serve shared modules via a backend route at `/plugins/_shared/*`
- Update 4 plugin `frontend.js` files to import from the shared module
- Ensure third-party plugins (loaded from `PLUGIN_DIR`) can also import shared utils

**Non-Goals:**
- Moving other plugin logic into shared modules (future work)
- Changing the plugin loading mechanism or hook system
- Bundling plugins with Vite

## Decisions

### 1. File location: `plugins/_shared/utils.js`

**Rationale**: The `_` prefix conventionally signals "not a plugin" and sorts first in directory listings. It lives alongside plugin directories, making relative imports natural (`../_shared/utils.js`). The `PluginManager` already skips directories without valid `plugin.json`, so `_shared` won't be loaded as a plugin.

**Alternative considered**: `reader-src/public/js/plugin-utils.js` — would be bundled/copied by Vite, but conceptually belongs with plugins, not the frontend app.

### 2. Import style: relative path from plugin frontend.js

Each plugin will use: `import { escapeHtml } from '../_shared/utils.js';`

ES module relative imports resolve against the module's own URL, so from `/plugins/status/frontend.js`, `../_shared/utils.js` resolves to `/plugins/_shared/utils.js`.

**Alternative considered**: Absolute path `/plugins/_shared/utils.js` — works but couples to URL structure; relative is more portable.

### 3. Backend serving: static file route for `_shared` directory

Add a route in `registerPluginRoutes()` that serves all `.js` files from the `_shared` directory under the built-in `plugins/` directory. Apply the same containment check used for plugin modules (path must stay within `_shared/`).

Only the built-in plugin directory gets a `_shared` route — `PLUGIN_DIR` (external) does not have its own `_shared`. External plugins can import from the built-in `_shared` via the same URL.

### 4. Security: containment check + `.js` extension only

The route will only serve files ending in `.js` from within the `_shared` directory. Path traversal is prevented by resolving the full path and checking it starts with the `_shared` directory prefix (same pattern as existing plugin serving).

## Risks / Trade-offs

- **[Risk] Browser caching**: Shared module changes require cache invalidation for all plugins → No versioning needed now; standard browser cache-control applies.
- **[Risk] Import path breaks if plugins move**: If plugin directory structure changes, relative imports break → Acceptable since plugin structure is stable and documented.
- **[Trade-off]**: Convention-based (`_shared` prefix) rather than config-based exclusion → Simpler, but `PluginManager` must not try to load `_shared` as a plugin. Already handled: it requires `plugin.json`.
