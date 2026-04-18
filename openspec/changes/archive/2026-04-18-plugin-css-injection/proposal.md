## Why

Plugin CSS styles (status panel, options panel) are currently hardcoded in the core `reader-src/src/styles/base.css`. This couples the frontend appearance to specific plugins and prevents external plugins from shipping their own styles. As the plugin ecosystem grows, plugins need a way to declare and inject their own CSS without modifying core source files.

## What Changes

- Add a `frontendStyles` field to the plugin manifest (`plugin.json`) allowing plugins to declare one or more CSS files
- Backend serves plugin CSS files via a new route pattern (`/plugins/<name>/<path>.css`)
- Frontend dynamically loads and injects plugin CSS `<link>` or `<style>` elements when plugins are initialized
- Move status-panel and options-panel CSS from core `base.css` into their respective plugin directories in the external plugins repo (`/var/home/jim60105/repos/HeartReverie_Plugins/`)
- Remove plugin-specific CSS from core `base.css` (keep only shared/base styles)

## Capabilities

### New Capabilities
- `plugin-css-injection`: Mechanism for plugins to declare CSS files in their manifest, have them served by the backend, and dynamically injected into the frontend DOM when the plugin loads.

### Modified Capabilities
- `plugin-core`: Extend the plugin manifest format with a new `frontendStyles` field (array of relative CSS file paths). Extend the backend plugin route serving to handle `.css` files. Extend the frontend `usePlugins()` composable to load and inject CSS.

## Impact

- **Backend**: `writer/routes/plugins.ts` — add CSS file serving route (similar pattern to existing `frontend.js` serving)
- **Backend types**: `writer/types.ts` — add `frontendStyles` to `PluginManifest` interface
- **Frontend**: `reader-src/src/composables/usePlugins.ts` — add CSS injection logic during `initPlugins()`
- **Frontend types**: `reader-src/src/types/index.ts` — update `PluginDescriptor` with `frontendStyles` field
- **Frontend styles**: `reader-src/src/styles/base.css` — remove ~250 lines of plugin-specific CSS (status panel, options panel styles)
- **External plugins**: Add `styles.css` files to `status/` and `options/` plugin directories, update their `plugin.json` manifests
- **API response**: `GET /api/plugins` response includes `frontendStyles` array for each plugin
