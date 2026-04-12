## Why

Four plugin `frontend.js` files (status, thinking, state-patches, options) each contain an identical `escapeHtml()` function. This duplication was introduced in `9d3f546` when the Vue SPA rewrite removed the shared `reader/js/utils.js` that plugins previously imported from. Consolidating into a shared module improves maintainability and adheres to the Single Responsibility Principle.

## What Changes

- Create `plugins/_shared/utils.js` exporting `escapeHtml` as a reusable ES module
- Add a backend route to serve shared plugin utility modules at `/plugins/_shared/*`
- Update all 4 plugin `frontend.js` files to import `escapeHtml` from the shared module instead of defining it inline
- Prevent `_shared` from being loaded as a plugin (it has no `plugin.json`)

## Capabilities

### New Capabilities

- `shared-plugin-utils`: Shared utility module infrastructure for frontend plugin code — covers the serving route, the utility module, and the import convention

### Modified Capabilities

- `plugin-core`: Add the shared utility serving route as part of the plugin serving infrastructure

## Impact

- **Backend**: New route in `writer/routes/plugins.ts` to serve `/plugins/_shared/*` files
- **Plugins**: 4 files changed (`plugins/{status,thinking,state-patches,options}/frontend.js`) — inline `escapeHtml` replaced with import
- **New file**: `plugins/_shared/utils.js`
- **No breaking changes**: Plugin API unchanged; third-party plugins can also import from `_shared/utils.js`
