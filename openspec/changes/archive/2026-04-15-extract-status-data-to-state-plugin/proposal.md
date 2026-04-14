## Why

The `status_data` logic (loading `current-status.yml` / `init-status.yml`, passing it to the template, and serving it via API) is scattered across core backend files (`writer/lib/story.ts`, `writer/lib/template.ts`, `writer/routes/chapters.ts`, `writer/lib/plugin-manager.ts`, `writer/lib/errors.ts`). This data is produced exclusively by the `state` plugin's Rust binary and consumed only by the `state` plugin's prompt fragment and the template's `<status_current_variable>` block. Moving the loading logic into the `state` plugin achieves cleaner separation of concerns: the core engine no longer needs to know about status YAML files, and all state-related I/O lives in one plugin.

## What Changes

- Add a new `getDynamicVariables(context)` export mechanism for plugin backend modules — allows plugins to provide dynamic template variables scoped to a specific series/story
- The `state` plugin exports `getDynamicVariables()` to load `current-status.yml` (with `init-status.yml` fallback) and return `{ status_data: content }`
- Remove `loadStatus()` function from `writer/lib/story.ts`
- Remove `status_data` from core template variable passing in `writer/lib/template.ts` — now provided by the state plugin's `getDynamicVariables()`
- Remove `status_data` from core parameter declarations in `writer/lib/plugin-manager.ts` — the state plugin declares it in `plugin.json` `parameters`
- Remove `status_data` from known variable names in `writer/lib/errors.ts` — Levenshtein suggestions now use `extraKnownVars` from dynamic variables
- Remove the `GET /api/stories/:series/:name/status` endpoint from `writer/routes/chapters.ts` — unused by frontend, dropped entirely
- `system.md` is unchanged — `{{ status_data }}` stays the same, just provided by the plugin instead of core
- Update documentation (`docs/plugin-system.md`, `docs/prompt-template.md`) to reflect `status_data` as a plugin variable

## Capabilities

### New Capabilities

- `getDynamicVariables(context)` plugin export — plugins can provide dynamic template variables at render time, scoped to the current series/story context

### Modified Capabilities

- `state-modules`: The state plugin takes ownership of `status_data` loading via `getDynamicVariables()`; declares `status_data` in `plugin.json` `parameters`
- `writer-backend`: Core engine no longer handles `status_data` loading or passing; `PluginManager` gains `getDynamicVariables()` method; `renderSystemPrompt()` collects dynamic vars from plugins
- `vento-prompt-template`: `status_data` changes from a core template variable to a plugin-provided dynamic variable

## Impact

- **Backend core** (`writer/lib/story.ts`, `writer/lib/template.ts`, `writer/lib/plugin-manager.ts`, `writer/lib/errors.ts`): Remove status_data-related code
- **Routes** (`writer/routes/chapters.ts`): Remove status endpoint (dropped — unused by frontend)
- **Plugin** (`plugins/state/handler.js`, `plugins/state/plugin.json`): Gains `getDynamicVariables` export for loading status YAML; adds `parameters` declaration
- **Plugin architecture** (`writer/types.ts`): `PluginModule` gains optional `getDynamicVariables` field
- **Template** (`system.md`): No change — `{{ status_data }}` still works, just sourced from plugin
- **Tests**: Remove status endpoint tests from chapters_test.ts; add state plugin `getDynamicVariables` tests; add `PluginManager.getDynamicVariables` tests; update mocks
- **Docs**: Update core variable count and lists in `docs/plugin-system.md` and `docs/prompt-template.md`; document `getDynamicVariables` export
