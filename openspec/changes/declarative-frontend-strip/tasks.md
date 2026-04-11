## 1. Backend: Rename stripTags to promptStripTags

- [x] 1.1 Rename `stripTags` to `promptStripTags` in `PluginManifest` type definition in `writer/types.ts`
- [x] 1.2 Update `PluginManager` in `writer/lib/plugin-manager.ts` to read `promptStripTags` instead of `stripTags` from manifests (update `getStripTagPatterns()` and any references)
- [x] 1.3 Rename `"stripTags"` to `"promptStripTags"` in all plugin.json manifests: `context-compaction`, `imgthink`, `options`, `state-patches`, `status`, `t-task`, `threshold-lord`, `user-message`
- [x] 1.4 Update all backend tests referencing `stripTags` in `tests/writer/lib/plugin-manager_test.ts`
- [x] 1.5 Update documentation: `docs/plugin-system.md`, `AGENTS.md`, `README.md` to use `promptStripTags`

## 2. Backend: Expose displayStripTags via API

- [x] 2.1 Add `displayStripTags` to `PluginManifest` type definition in `writer/types.ts`
- [x] 2.2 Update `PluginManager` in `writer/lib/plugin-manager.ts` to read `displayStripTags` from `plugin.json` manifests and include it in the plugin metadata object (default to empty array if not declared)
- [x] 2.3 Update the `GET /api/plugins` endpoint in `writer/server.ts` to include the `displayStripTags` array in each plugin's response object

## 3. Plugin Manifests: Add displayStripTags declarations

- [x] 3.1 Add `"displayStripTags": ["chapter_summary"]` to `plugins/context-compaction/plugin.json` and remove `frontendModule` field
- [x] 3.2 Add `"displayStripTags": ["imgthink"]` to `plugins/imgthink/plugin.json` and remove `frontendModule` field
- [x] 3.3 Add `"displayStripTags": ["/<T-task\\b[^>]*>[\\s\\S]*?<\\/T-task>/g"]` to `plugins/t-task/plugin.json` and remove `frontendModule` field
- [x] 3.4 Add `"displayStripTags": ["disclaimer"]` to `plugins/threshold-lord/plugin.json` and remove `frontendModule` field
- [x] 3.5 Add `"displayStripTags": ["user_message"]` to `plugins/user-message/plugin.json` and remove `frontendModule` field

## 4. Frontend: Declarative strip pattern compilation

- [x] 4.1 In `reader/js/plugin-loader.js`, collect `displayStripTags` from all plugins during initialization and compile them into a combined regex (plain names → `<name>[\s\S]*?</name>` case-insensitive; regex strings → parse as RegExp)
- [x] 4.2 Export the compiled strip patterns (or a strip function) from `plugin-loader.js` for use by the renderer

## 5. Frontend: Update rendering pipeline

- [x] 5.1 In `reader/js/md-renderer.js`, replace the `frontendHooks.dispatch('frontend-strip', ...)` call with direct application of the compiled displayStripTags patterns
- [x] 5.2 Remove the `frontend-strip` stage from `FrontendHookDispatcher` in `reader/js/plugin-hooks.js` (remove from valid stages, clean up any references)

## 6. Cleanup: Remove strip-only frontend modules

- [x] 6.1 Delete `plugins/context-compaction/frontend.js`
- [x] 6.2 Delete `plugins/imgthink/frontend.js`
- [x] 6.3 Delete `plugins/t-task/frontend.js`
- [x] 6.4 Delete `plugins/threshold-lord/frontend.js`
- [x] 6.5 Delete `plugins/user-message/frontend.js`

## 7. Tests and Verification

- [x] 7.1 Run existing test suite (`deno test`) to verify no regressions
- [x] 7.2 Review the rendering pipeline to confirm strip phase ordering: extract → render → strip → normalize → markdown → reinsertion → sanitize
- [x] 7.3 Verify that render-only plugins (options, status, state-patches) are unaffected — their `frontendModule` and `frontend-render` hooks remain intact
- [x] 7.4 Update main specs (`plugin-core`, `plugin-hooks`, `vento-prompt-template`, `backend-tests`, `typescript-type-system`) to reflect `promptStripTags` rename
