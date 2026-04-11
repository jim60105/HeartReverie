## Why

All five plugins that register `frontend-strip` hooks follow the identical pattern: match an XML tag with a regex and replace with an empty string, at priority 100. Each requires a separate `frontend.js` file, a `frontendModule` declaration, and dynamic module loading at runtime — all for a single regex replacement. A declarative field in `plugin.json` would eliminate this boilerplate, reduce the number of files plugin authors need to maintain, and let the framework handle stripping without per-plugin JavaScript modules. Since no external plugins exist, the `frontend-strip` hook can be removed entirely without breaking changes.

## What Changes

- Add a new `displayStripTags` field to the plugin manifest schema, accepting an array of plain tag names or regex pattern strings (reusing the same format as the existing `stripTags` field)
- Rename the existing `stripTags` manifest field to `promptStripTags` to clearly distinguish prompt-time stripping from display-time stripping
- The `FrontendHookDispatcher` (or `plugin-loader.js`) reads `displayStripTags` from each plugin's metadata and auto-registers strip handlers — no `frontend.js` needed for strip-only plugins
- Remove `frontend-strip` as a hook stage from `FrontendHookDispatcher`
- Remove `frontend.js` from the 5 strip-only plugins: `t-task`, `user-message`, `imgthink`, `context-compaction`, `threshold-lord`
- Update `frontendModule` declarations: strip-only plugins lose `frontendModule`; `threshold-lord` (which absorbed `disclaimer`) loses its `frontend.js` entirely
- Update `md-renderer.js` to apply declarative strip patterns instead of dispatching the `frontend-strip` hook

## Capabilities

### New Capabilities

- `frontend-strip-tags`: Declarative frontend tag stripping via `displayStripTags` manifest field, replacing the `frontend-strip` hook stage

### Modified Capabilities

- `plugin-core`: Plugin manifest schema gains the `displayStripTags` field; `stripTags` renamed to `promptStripTags`; plugin type determination updated
- `plugin-hooks`: `frontend-strip` hook stage removed from `FrontendHookDispatcher`
- `md-renderer`: Rendering pipeline updated to apply declarative strip patterns instead of dispatching `frontend-strip` hook

## Impact

- **Frontend modules**: `reader/js/plugin-hooks.js` — `frontend-strip` stage removed
- **Frontend rendering**: `reader/js/md-renderer.js` — strip logic changes from hook dispatch to declarative pattern application
- **Frontend loader**: `reader/js/plugin-loader.js` — passes `displayStripTags` metadata to the strip mechanism
- **Plugin manifests**: 5 plugins gain `displayStripTags` field; 5 plugins lose `frontendModule`
- **Plugin files**: 5 `frontend.js` files deleted (t-task, user-message, imgthink, context-compaction, threshold-lord)
- **Backend**: `GET /api/plugins` response may include `displayStripTags` data for the frontend to consume
- **Documentation**: `docs/plugin-system.md`, `AGENTS.md` updated to reflect new field and removed hook
