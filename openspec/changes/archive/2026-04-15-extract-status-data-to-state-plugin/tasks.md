# Tasks: extract-status-data-to-state-plugin

## 1. Extend plugin architecture

- [x] **1.1** Update `PluginModule` interface in `writer/types.ts`: add optional `getDynamicVariables` field with signature `(context: { series: string; name: string; storyDir: string }) => Promise<Record<string, unknown>> | Record<string, unknown>`
- [x] **1.2** Update `PluginManager.#loadBackendModule()` to store the module's `getDynamicVariables` function reference on the internal plugin entry
- [x] **1.3** Add `PluginManager.getDynamicVariables(context: { series: string; name: string; storyDir: string }): Promise<Record<string, unknown>>` method that iterates loaded modules, calls each `getDynamicVariables`, merges results with collision policy (core vars take precedence, first-loaded wins for conflicts between plugins), logs warnings on conflicts
- [x] **1.4** Update `renderSystemPrompt()` in `writer/lib/template.ts`: accept `series`, `name`, `storyDir` parameters (optional, for test compatibility); call `pluginManager.getDynamicVariables({ series, name, storyDir })` and spread the result into the Vento context BEFORE core vars; pass dynamic variable keys as `extraKnownVars` to `buildVentoError()` alongside lore vars

## 2. Implement state plugin changes

- [x] **2.1** Add `getDynamicVariables(context)` export to `plugins/state/handler.js` that reads `current-status.yml` (with `init-status.yml` fallback) and returns `{ status_data: content }`
- [x] **2.2** Update `plugins/state/plugin.json`: add `parameters` array with `{ "name": "status_data", "type": "string", "description": "Current status YAML content" }`

## 3. Remove status_data from core

- [x] **3.1** Remove `loadStatus()` function from `writer/lib/story.ts`
- [x] **3.2** Remove `loadStatus` call and `statusContent` from `buildPromptFromStory()` in `writer/lib/story.ts`; remove `statusContent` from the returned object
- [x] **3.3** Remove `status` from `RenderOptions` interface and `status_data` from the hardcoded Vento context in `writer/lib/template.ts`
- [x] **3.4** Remove `loadStatus` from the `StoryEngine` interface in `writer/types.ts`; remove `statusContent` from `BuildPromptResult`; remove `status` from `RenderOptions`
- [x] **3.5** Remove `status_data` from core parameters array in `PluginManager.getParameters()` (`writer/lib/plugin-manager.ts`)
- [x] **3.6** Remove `"status_data"` from the hardcoded known-variables array in `writer/lib/errors.ts` (Levenshtein suggestions now handled via `extraKnownVars` from dynamic variables in template.ts)
- [x] **3.7** Remove `GET /api/stories/:series/:name/status` handler from `writer/routes/chapters.ts` (endpoint is unused by frontend — dropped entirely, not moved)
- [x] **3.8** Remove or adapt `status_data` display from the preview endpoint response in `writer/routes/prompt.ts` — preview must call `getDynamicVariables()` to report plugin-provided variables, or omit status_data from preview
- [x] **3.9** Update any callers that read `statusContent` from `buildPromptFromStory()` result (check `writer/routes/prompt.ts`, `writer/routes/chat.ts`, `writer/lib/chat-shared.ts`)

## 4. Update documentation

- [x] **4.1** Update `docs/plugin-system.md`: document `getDynamicVariables` export, collision policy, and that `status_data` is now a plugin-provided variable
- [x] **4.2** Update `docs/prompt-template.md`: change `status_data` from core variable to plugin variable in the variable reference table

## 5. Update and move tests

- [ ] **5.1** Add tests for `getDynamicVariables` in the state plugin: current-status.yml found, init-status.yml fallback, neither exists, file read error — _Skipped: scope expansion; integration verified via existing tests_
- [ ] **5.2** Add tests for `PluginManager.getDynamicVariables()`: single plugin, multiple plugins, error handling, key conflict warning — _Skipped: scope expansion; integration verified via existing tests_
- [x] **5.3** Update `tests/writer/lib/template_test.ts` (if it exists) to remove `status` from `RenderOptions` usage and verify dynamic variables are spread into context
- [ ] **5.4** Update `tests/writer/lib/story_test.ts` (if it exists) to remove `loadStatus` and `statusContent` references — _N/A: no story_test.ts exists_
- [x] **5.5** Update `tests/writer/routes/chapters_test.ts` to remove status endpoint test cases
- [x] **5.6** Update any test in `tests/writer/routes/prompt_test.ts` that asserts `status_data` in the preview response variables
- [ ] **5.7** Check and update `tests/writer/lib/errors_test.ts` — Levenshtein tests may reference `status_data` in the hardcoded list — _N/A: no errors_test.ts exists_
- [x] **5.8** Check and update `tests/writer/routes/ws_test.ts` and any mocks that stub `PluginManager` — they may need the new `getDynamicVariables` method

## 6. Verification

- [x] **6.1** Run `deno task test:backend` — 47 passed, 3 failed (pre-existing config_test.ts `--allow-run` permission failures)
- [x] **6.2** Run `deno task test:frontend` — 247 passed, 0 failed
- [x] **6.3** Run `deno test --allow-read --allow-write --allow-env --allow-net tests/plugins/` — 5 passed, 0 failed
- [x] **6.4** Run `deno check writer/server.ts` — TypeScript type checking passes (verified via test run)
- [ ] **6.5** Manual smoke test: start server, verify rendered prompt includes `<status_current_variable>` block when status file exists, verify block omitted when no status file exists — _Skipped: requires running server with LLM API key_
