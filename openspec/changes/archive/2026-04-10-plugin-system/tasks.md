## 1. Plugin Infrastructure — Backend

- [x] 1.1 Create `writer/lib/hooks.js` — `HookDispatcher` class with `register(stage, handler, priority)` and `async dispatch(stage, context)` methods; stages: prompt-assembly, response-stream, post-response, strip-tags
- [x] 1.2 Create `writer/lib/plugin-manager.js` — `PluginManager` class: scan `plugins/` and `PLUGIN_DIR`, parse `plugin.json` manifests, validate required fields, build registry `Map<string, PluginManifest>`, handle name collisions (external overrides built-in), dynamic `import()` backend hook handlers
- [x] 1.3 Integrate `PluginManager` into `server.js` — call `await pluginManager.init()` at startup before route mounting; expose `pluginManager` and `hookDispatcher` to route handlers
- [x] 1.4 Add `GET /api/plugins` endpoint — return array of loaded plugin manifests (name, version, description, type, tags, frontendModule presence) for frontend consumption
- [x] 1.5 Add static file serving for plugin frontend modules — `GET /plugins/:name/*` mapped to each plugin's directory, restricted to files referenced in manifests

## 2. Plugin Infrastructure — Frontend

- [x] 2.1 Create `reader/js/plugin-hooks.js` — `FrontendHookDispatcher` class with `register(stage, handler, priority)` and `dispatch(stage, context)` methods; stages: frontend-render, frontend-strip
- [x] 2.2 Create `reader/js/plugin-loader.js` — `FrontendPluginLoader`: fetch `GET /api/plugins`, filter plugins with `frontendModule`, dynamically `import()` each module, call `register(hooks)` on each
- [x] 2.3 Integrate `FrontendPluginLoader` into reader initialization — load all frontend plugins before first render; ensure `renderChapter()` waits for plugin init

## 3. Vento Error Handling

- [x] 3.1 Wrap `ventoEnv.runString()` in `renderSystemPrompt()` with try-catch — capture Vento errors (missing variables, syntax errors, include failures)
- [x] 3.2 Create structured error response format — `{ type, stage, message, source, line, suggestion }` with Levenshtein-based variable name suggestions
- [x] 3.3 Return HTTP 422 with structured error on template rendering failure in chat endpoint
- [x] 3.4 Add Vento error display component in frontend — visually distinct error card in chat area showing error details and suggestion

## 4. Hook-Driven Prompt Assembly

- [x] 4.1 Refactor `renderSystemPrompt()` to fire `prompt-assembly` hook — collect `plugin_fragments` from plugin handlers, pass as additional Vento variable
- [x] 4.2 Refactor `stripPromptTags()` to use dynamic tag list — build combined regex from plugin-registered tags via `strip-tags` hook stage instead of hardcoded patterns
- [x] 4.3 Update `system.md` Vento template — add `{{ for fragment of plugin_fragments }}` injection section for plugin-contributed prompt content
- [x] 4.4 Add `plugin_prompts` to Vento variable set — expand `renderSystemPrompt()` signature to pass `{ scenario, previous_context, user_input, status_data, isFirstRound, plugin_fragments }`

## 5. Hook-Driven Frontend Rendering

- [x] 5.1 Refactor `md-renderer.js` `renderChapter()` — replace hardcoded `extractStatusBlocks`/`extractOptionsBlocks`/`extractVariableBlocks` calls with `frontendHooks.dispatch('frontend-render', { text, placeholderMap })`
- [x] 5.2 Refactor `md-renderer.js` tag stripping — replace hardcoded `<imgthink>`, `<disclaimer>`, `<user_message>`, `<T-task...>` regexes with `frontendHooks.dispatch('frontend-strip', { text })`
- [x] 5.3 Keep placeholder reinsertion, quote normalization, newline doubling, marked parse, and DOMPurify steps in `md-renderer.js` unchanged

## 6. Prompt-Only Plugin Migration

- [x] 6.1 Create `plugins/writestyle/` — `plugin.json` (prompt-only), move `writestyle.md` as prompt fragment, register prompt-assembly hook
- [x] 6.2 Create `plugins/world-aesthetic/` — `plugin.json` (prompt-only), move `world_aesthetic_program.md` as prompt fragment
- [x] 6.3 Create `plugins/de-robotization/` — `plugin.json` (prompt-only), move `de-robotization.md` as prompt fragment
- [x] 6.4 Create `plugins/threshold-lord/` — `plugin.json` (prompt-only), move `Threshold-Lord_start.md` (priority 10) and `Threshold-Lord_end.md` (priority 900) as prompt fragments with positional control
- [x] 6.5 Create `plugins/t-task/` — `plugin.json` (prompt-only), move `T-task.md` as prompt fragment, register frontend-strip hook for `<T-task...>` tags
- [x] 6.6 Create `plugins/disclaimer/` — `plugin.json` (prompt-only), register frontend-strip hook for `<disclaimer>` and strip-tags hook for backend chapter stripping
- [x] 6.7 Create `plugins/imgthink/` — `plugin.json` (prompt-only), register frontend-strip hook for `<imgthink>`
- [x] 6.8 Create `plugins/user-message/` — `plugin.json` (prompt-only), register frontend-strip and strip-tags hooks for `<user_message>`

## 7. Full-Stack Plugin Migration

- [x] 7.1 Create `plugins/options/` — `plugin.json` (full-stack), move `options.md` as prompt fragment, move `extractOptionsBlocks` + render logic to `frontend.js`, register frontend-render hook and strip-tags hook for backend stripping
- [x] 7.2 Create `plugins/status/` — `plugin.json` (full-stack), move `status.md` as prompt fragment, move `extractStatusBlocks` + render logic to `frontend.js`, register frontend-render hook
- [x] 7.3 Create `plugins/variable-display/` — `plugin.json` (full-stack), move `extractVariableBlocks` + render logic to `frontend.js`, register frontend-render hook (no prompt fragment)

## 8. Hook-Only Plugin Migration

- [x] 8.1 Create `plugins/apply-patches/` — `plugin.json` (hook-only), create `handler.js` with post-response hook that runs `execFileAsync('./apply-patches/target/release/apply-patches', ['playground'])`, preserve existing error handling and safety constraints

## 9. Prompt Preview

- [x] 9.1 Add `POST /api/stories/:series/:name/preview-prompt` endpoint — accept `{ message }` body, render system prompt through full pipeline including plugin hooks, return `{ prompt, fragments, variables, errors }`
- [x] 9.2 Create `reader/js/prompt-preview.js` — collapsible panel/modal showing rendered prompt as syntax-highlighted `<pre>`, plugin fragment boundaries, Vento variable values
- [x] 9.3 Add preview trigger button in the reader UI — integrate with chat input area or 編排器 panel

## 10. Prompt Editor (編排器)

- [x] 10.1 Create `reader/js/prompt-editor.js` — side panel UI with ordered list of plugin prompt fragments, enable/disable toggles per fragment, drag-handle reordering
- [x] 10.2 Add Vento parameter discovery — `GET /api/plugins/parameters` endpoint returning all available parameters (core + plugin-contributed) with name, type, description
- [x] 10.3 Implement parameter auto-fill in editor — `<datalist>`-based autocomplete for known Vento variable names when editing or viewing parameters
- [x] 10.4 Integrate live preview — "Preview" button in 編排器 that calls prompt-preview endpoint and displays result
- [x] 10.5 Implement persistence — save fragment ordering and enabled/disabled state to `localStorage`, send as optional `promptConfig` in chat requests, backend respects ordering during prompt-assembly

## 11. Cleanup and Verification

- [x] 11.1 Remove hardcoded tag extraction imports from `md-renderer.js` — delete direct imports of `extractStatusBlocks`, `extractOptionsBlocks`, `extractVariableBlocks`
- [x] 11.2 Remove hardcoded strip regexes from `md-renderer.js` — delete `<imgthink>`, `<disclaimer>`, `<user_message>`, `<T-task...>` regex patterns
- [x] 11.3 Remove hardcoded `stripPromptTags()` regex list from `server.js` — now built dynamically from plugin registry
- [x] 11.4 Remove hardcoded `execFileAsync` post-response call from chat endpoint in `server.js` — now handled by apply-patches plugin hook
- [x] 11.5 Remove static `{{ include }}` lines from `system.md` for migrated prompt files — replaced by plugin_fragments loop
- [x] 11.6 Verify rendered prompt output matches pre-migration baseline — use preview endpoint to diff rendered prompts before and after migration, ensure zero behavioral change
- [x] 11.7 Verify all frontend tag rendering works identically — test options panel, status bar, variable display, tag stripping with sample chapter content
