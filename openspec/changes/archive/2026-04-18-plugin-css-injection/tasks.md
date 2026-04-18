# Tasks

## 1. Types and Interfaces

- [x] 1.1 Add optional `frontendStyles?: string[]` field to `PluginManifest` interface in `writer/types.ts`
- [x] 1.2 Update `PluginDescriptor` type in `reader-src/src/types/index.ts` to include `frontendStyles?: string[]`
- [x] 1.3 Document the new manifest field inline with JSDoc comments describing format (relative paths, `.css` extension, no path traversal)

## 2. Backend Manifest Validation

- [x] 2.1 In `writer/lib/plugin-manager.ts`, validate `frontendStyles` during manifest loading: must be an array of strings if present
- [x] 2.2 Validate each CSS path entry: non-empty string, ends with `.css`, no absolute paths, no `..` segments, stays within plugin directory (reuse existing `isPathContained`/`safePath` helpers)
- [x] 2.3 Normalize `frontendStyles` entries at load time: strip leading `./`, deduplicate by resolved path, store canonical array
- [x] 2.4 Verify each declared CSS file exists on disk at load time; log warning and skip invalid entries (or fail loading — pick per existing conventions for `frontendModule`)
- [x] 2.5 Expose validated `frontendStyles` paths on the loaded plugin record so routes can reference them
- [x] 2.6 Add/extend plugin-manager tests in `tests/writer/lib/` covering: valid `frontendStyles`, missing files, path traversal rejection, non-array type rejection, non-`.css` extension rejection

## 3. Backend CSS Serving Route

- [x] 3.1 Extend `/plugins/:name/*` route in `writer/routes/plugins.ts` to serve CSS files when requested
- [x] 3.2 Apply symlink-safe canonicalization (Deno.realPath()) on each CSS file request, consistent with `_shared` route security pattern
- [x] 3.3 Enforce manifest whitelist: only files listed in `frontendStyles` (plus existing `frontendModule`) are servable
- [x] 3.4 Set `Content-Type: text/css; charset=utf-8` for CSS responses
- [x] 3.5 Return 404 for CSS files not declared in the manifest, even if the file exists on disk
- [x] 3.6 Include `frontendStyles` array (as URL paths under `/plugins/<name>/...`) in the `GET /api/plugins` response payload
- [x] 3.7 Add route tests in `tests/writer/routes/` for: successful CSS serving, undeclared file 404, path-traversal rejection, correct `Content-Type`, API response shape

## 4. Frontend CSS Injection

- [x] 4.1 In `reader-src/src/composables/usePlugins.ts`, iterate plugin descriptors and inject `<link rel="stylesheet">` into `document.head` for each entry in `frontendStyles`
- [x] 4.2 Ensure injection happens BEFORE dynamic `import()` of frontend modules so styles are available when components render
- [x] 4.3 Ensure injection happens AFTER core app stylesheets so plugin CSS naturally cascades over base styles
- [x] 4.4 Attach `onerror` handler on each `<link>` that silently removes the failed element from the DOM (graceful degradation, no `console.error`)
- [x] 4.5 Deduplicate: skip injecting a `<link>` if an identical `href` is already present in `<head>` (idempotent reloads)
- [x] 4.6 Add Vitest tests in `reader-src/` for the injection logic: link element creation, ordering vs module import, error handler removal, deduplication

## 5. CSS Relocation to External Plugins

- [x] 5.1 Identify plugin-specific CSS blocks in `reader-src/src/styles/base.css` (status panel, options panel — ~250 lines total)
- [x] 5.2 Create CSS file in `/var/home/jim60105/repos/HeartReverie_Plugins/status/` containing the relocated status styles
- [x] 5.3 Create CSS file in `/var/home/jim60105/repos/HeartReverie_Plugins/options/` containing the relocated options styles
- [x] 5.4 Update `status` plugin `plugin.json` to declare its CSS file in `frontendStyles`
- [x] 5.5 Update `options` plugin `plugin.json` to declare its CSS file in `frontendStyles`
- [x] 5.6 Remove the relocated blocks from `reader-src/src/styles/base.css`
- [x] 5.7 Rebuild frontend (`deno task build:reader`) and visually verify status/options panels render identically

## 6. Integration and Documentation

- [x] 6.1 Run full test suite: `deno task test` and confirm all tests pass
- [x] 6.2 Update `docs/plugin-system.md` with a section describing the `frontendStyles` manifest field, file layout conventions, and cascade ordering
- [x] 6.3 Update `AGENTS.md` plugin interaction layers list to mention CSS injection
- [x] 6.4 Smoke-test end-to-end: load app in browser, confirm status/options panels styled correctly, confirm no console errors, confirm a plugin without `frontendStyles` still loads cleanly
