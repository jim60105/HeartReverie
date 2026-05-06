## 1. x-actions support in PluginSettingsPage

- [x] 1.1 Add `SchemaAction` interface (`id`, `label`, `url`, `method?`, `bodyFields?`, `reloadOptionsOnSuccess?`)
- [x] 1.2 Add reactive state: `actionLoading` and `actionResult` refs
- [x] 1.3 Add `schemaActions` computed property extracting `x-actions` from loaded schema
- [x] 1.4 Implement `executeAction()` function: build body from `bodyFields` + form values, fetch URL, parse JSON result, show status, trigger option reload on success
- [x] 1.5 Add template section with action buttons and result display inside the form, above field list
- [x] 1.6 Add scoped CSS styles for `.actions-section`, `.action-item`, `.action-btn`, `.action-result`, `.result-success`, `.result-error`

## 2. Fix async plugin route shadowing

- [x] 2.1 Extract SPA fallback from `createApp()` into new exported `registerSpaFallback(app, config)` function in `writer/app.ts`
- [x] 2.2 Import and call `registerSpaFallback(app, config)` in `writer/server.ts` AFTER `await initPluginRoutes(app)`
- [x] 2.3 Update `tests/writer/routes/spa_fallback_test.ts` to import and call `registerSpaFallback()` after app creation

## 3. Validation

- [x] 3.1 Run `deno test` — all 186 backend tests pass including spa_fallback_test
- [x] 3.2 Run `deno task build:reader` — frontend builds successfully
- [x] 3.3 Browser test: verify "測試連線" button appears on sd-webui-image-gen settings page
- [x] 3.4 Browser test: click test with correct URL shows "✓ 連線成功"
- [x] 3.5 Browser test: click test with wrong URL shows friendly error message
- [x] 3.6 Browser test: verify dynamic options (models, samplers) load correctly after fix
- [x] 3.7 Verify SPA fallback still works (non-API GET routes serve index.html)
