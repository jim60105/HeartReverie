## 1. Fix `docs/plugin-system.md` Documentation

- [x] 1.1 Fix architecture tree file extensions (`.js` → `.ts`: `server.js` → `server.ts`, `plugin-manager.js` → `plugin-manager.ts`, `hooks.js` → `hooks.ts`) and update plugin count from "共 10 個 plugin" to "共 11 個 plugin"
- [x] 1.2 Add `context_compaction` (context-compaction, priority 800) and `state` (state, priority 100) to the plugin variable table (lines 126-136)
- [x] 1.3 Add `thinking` plugin to the built-in plugin list table; fix `threshold-lord` type from `full-stack` to `prompt-only`
- [x] 1.4 Fix `prompt-assembly` hook context from `{ prompt, variables }` to `{ previousContext, rawChapters, storyDir, series, name }`; fix `frontend-render` context from `{ text, element }` to `{ text, placeholderMap, options }`
- [x] 1.5 Document `_shared/` serving route: add note that `/plugins/_shared/:path` serves shared `.js` utilities from the `plugins/_shared/` directory
- [x] 1.6 Fix `lore_all` source in `/api/plugins/parameters` example from `"core"` to `"lore"`
- [x] 1.7 Remove `include` from allowed SSTI syntax list (code explicitly disallows it as file-inclusion vector)
- [x] 1.8 Update core variables from "四個核心變數" to "七個核心變數", add `series_name`, `story_name`, `plugin_fragments`
- [x] 1.9 Add note about `response-stream` and `strip-tags` hooks being defined but not yet dispatched; note `mod.default` export fallback for backend modules
- [x] 1.10 Fix manifest required fields: doc says `version`, `description`, `type` are required, but code only enforces `name` — update doc to reflect that only `name` is required and others are optional

## 2. Create New Plugin

- [x] 2.1 Create `plugins/start-hints/` with `plugin.json` (prompt-only, variable `start_hints`, priority 100, promptStripTags + displayStripTags for `start_hints`) and `start-hints.md` containing the `<start_hints>` block from `system.md` lines 67-76

## 3. Enhance Existing Plugins

- [x] 3.1 Add `content_freedom` prompt fragment to `plugins/threshold-lord/plugin.json` (file: `./content-freedom.md`, variable: `content_freedom`, priority: 15); create `plugins/threshold-lord/content-freedom.md` with content from `system.md` lines 3-14
- [x] 3.2 Add `think_before_reply` prompt fragment to `plugins/thinking/plugin.json` (file: `./think-before-reply.md`, variable: `think_before_reply`, priority: 100); change type from `frontend-only` to `full-stack`; create `plugins/thinking/think-before-reply.md` with content from `system.md` lines 43-44

## 4. Update Template

- [x] 4.1 Update `system.md` to replace 3 optional sections with plugin variable references: `{{ content_freedom }}`, `{{ think_before_reply }}`, `{{ start_hints }}`; keep 4 core sections (formatting, language, game instructions, writing guidelines) hardcoded; preserve template structure, conditionals, and existing variable references

## 5. Update Documentation for New Plugins

- [x] 5.1 Update the plugin variable table in `docs/plugin-system.md` to add new variables: `content_freedom` (threshold-lord, 15), `think_before_reply` (thinking, 100), `start_hints` (start-hints, 100)
- [x] 5.2 Update the built-in plugin list table in `docs/plugin-system.md` to add 1 new plugin (`start-hints`) and update descriptions for 2 enhanced plugins (threshold-lord now includes content-freedom, thinking now includes prompt); update plugin count from "共 11 個 plugin" to "共 12 個 plugin"

## 6. Verification

- [x] 6.1 Verify all 12 plugins load correctly: check that each `plugin.json` is valid and `name` matches directory name
- [x] 6.2 Verify `system.md` renders identically: render the template with mock variables (both first-round and non-first-round), confirm extracted content in fragment files matches the original hardcoded text exactly (including whitespace and blank lines); confirm 4 core sections remain hardcoded
- [x] 6.3 Verify `docs/plugin-system.md` has no remaining misalignments: grep for `.js` file extensions in architecture tree, verify plugin count says 12, verify variable table completeness, verify hook context shapes, verify manifest required fields
- [x] 6.4 Verify new plugin variables appear in `getPromptVariables()` output: all 3 new variables (`content_freedom`, `think_before_reply`, `start_hints`) are returned
- [x] 6.5 Verify `start-hints` strip tags work: `promptStripTags` and `displayStripTags` correctly declare `start_hints` tag for stripping
