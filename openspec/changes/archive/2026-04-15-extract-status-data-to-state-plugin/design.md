## Context

The `status_data` logic — loading `current-status.yml`/`init-status.yml`, passing it as a template variable, and serving it via `GET /api/stories/:series/:name/status` — is scattered across five core backend files (`writer/lib/story.ts`, `writer/lib/template.ts`, `writer/lib/plugin-manager.ts`, `writer/lib/errors.ts`, `writer/routes/chapters.ts`). This data is produced exclusively by the `state` plugin's Rust binary and consumed only by the `state` plugin's prompt fragment and `system.md`'s `<status_current_variable>` block. There are zero external users of this project, so backward compatibility is not a concern.

The current plugin architecture has two limitations that prevent a straightforward move:
1. Plugin backend modules receive only `HookDispatcher` via `register(hookDispatcher)` — they cannot register Hono routes or access `safePath`/`config`.
2. `promptFragments` only read static files from disk — they cannot produce dynamic content scoped to a specific series/story.

## Goals / Non-Goals

### Goals
- Move all `status_data` loading and template variable provision into the `state` plugin
- Remove `status_data` as a core variable from `writer/lib/template.ts`, `writer/lib/story.ts`, `writer/lib/plugin-manager.ts`, and `writer/lib/errors.ts`
- Remove the unused `GET /api/stories/:series/:name/status` endpoint from `writer/routes/chapters.ts`
- Extend the plugin architecture with one focused mechanism: dynamic template variables via `getDynamicVariables()`
- Keep `{{ status_data }}` in `system.md` as-is (the variable name stays the same, only the provider changes from core to plugin)

### Non-Goals
- Refactoring other core variables into plugins (this change is scoped to `status_data` only)
- Changing the `<status_current_variable>` block structure in `system.md`
- Modifying the Rust binary or its patch pipeline
- Adding new user-facing features

## Decisions

### Decision 1: Add `getDynamicVariables()` export to plugin backend modules

**Choice**: Plugin backend modules MAY export a `getDynamicVariables(context)` function alongside `register()`. The `PluginManager` calls this during template rendering, passing `{ series, name, storyDir }` context. The function returns `Record<string, unknown>` of variable name → value pairs that are spread into the Vento template context.

**Rationale**: This is the minimal extension needed. The `prompt-assembly` hook cannot inject template variables (its context is not forwarded to the renderer). `promptFragments` only read static files. A new export avoids modifying the hook system and keeps the contract explicit: `register()` for hooks, `getDynamicVariables()` for template variables.

**Collision policy**: Dynamic variable keys MUST NOT overwrite core template variables (`previous_context`, `user_input`, `isFirstRound`, `series_name`, `story_name`). If a plugin returns a key that conflicts with a core variable, the core value takes precedence and a warning is logged. If two plugins return the same key, first-loaded wins with a warning.

**Implementation**:
- `PluginManager.#loadBackendModule()` stores the `getDynamicVariables` function reference alongside the module (add a field to the internal plugin entry).
- Add `PluginManager.getDynamicVariables(context: { series: string; name: string; storyDir: string })` that iterates loaded modules, collects results, enforces collision policy, and logs warnings on conflicts.
- `renderSystemPrompt()` in `writer/lib/template.ts` calls `pluginManager.getDynamicVariables(...)` and spreads the result into the Vento context, alongside static `pluginVars`. Dynamic vars are spread BEFORE core vars, so core vars naturally take precedence.
- The dynamic variable keys are also passed as `extraKnownVars` to `buildVentoError()` so Levenshtein suggestions still work for plugin-provided variables.
- The `PluginModule` interface in `writer/types.ts` gains an optional `getDynamicVariables` field.

### Decision 2: Drop the `GET /api/stories/:series/:name/status` endpoint entirely

**Choice**: Remove the status API endpoint from `writer/routes/chapters.ts` without re-registering it anywhere. The endpoint is not used by the frontend.

**Rationale**: The `/api/stories/:series/:name/status` endpoint serves the raw YAML content of `current-status.yml`. However, the frontend never calls this endpoint — only backend tests reference it. Rather than adding a `registerRoutes` mechanism and two-phase plugin startup to move the route into the plugin, we simply drop it. This avoids adding complexity to the plugin architecture for an unused endpoint. If the endpoint is needed in the future, it can be added back to the state plugin at that time.

### Decision 3: Keep `{{ status_data }}` in `system.md` — do NOT move the block to plugin

**Choice**: The `{{ if status_data }}...<status_current_variable>...{{ /if }}` block stays in `system.md`. The variable is now provided by the `state` plugin's `getDynamicVariables()` instead of core.

**Rationale**: The `<status_current_variable>` XML block is part of the prompt structure that `system.md` controls. Moving it to a plugin `promptFragment` would mean the block's position in the prompt is controlled by the plugin rather than the template, losing the template author's ability to reorder sections. Additionally, `system.md` already references `{{ state }}` (the static prompt fragment from the state plugin) — having `{{ status_data }}` also come from the same plugin is consistent. The spec's "Core prompt sections MUST NOT be extracted into plugins" requirement does not cover `status_data` (it covers formatting, language, game instructions, writing guidelines), so this is permitted.

### Decision 4: Remove `status_data` from core parameter declarations and known variables

**Choice**: Remove `status_data` from `getParameters()` core list in `plugin-manager.ts` and from the hardcoded known-variables array in `errors.ts`. The `state` plugin declares `status_data` in its `plugin.json` `parameters` array. Additionally, `renderSystemPrompt()` passes dynamic variable keys as `extraKnownVars` to `buildVentoError()` so Levenshtein suggestions remain functional.

**Rationale**: After this change, `status_data` is entirely owned by the plugin. The `buildVentoError()` function in `errors.ts` currently uses a hardcoded list of core vars (line 45: `"status_data"`) combined with `Object.keys(knownVariables.variables || {})` from `getPromptVariables()`. Since dynamic variables are NOT part of `getPromptVariables()` output, simply declaring in `plugin.json.parameters` does NOT make `status_data` visible to Levenshtein suggestions. The fix is explicit: `renderSystemPrompt()` already has the dynamic variable keys from `getDynamicVariables()` and passes them through `extraKnownVars` to `buildVentoError()`.

### Decision 5: Remove `loadStatus()` from core `StoryEngine` and `buildPromptFromStory`

**Choice**: Delete `loadStatus()` from `writer/lib/story.ts`. Remove the `statusContent` field from `BuildPromptResult` and the `status` parameter from `RenderOptions`. The `buildPromptFromStory()` function no longer calls `loadStatus()` or passes `status` to `renderSystemPrompt()`.

**Rationale**: The state plugin's `getDynamicVariables()` handles loading. The `prompt.ts` preview endpoint's variable display (`status_data: statusContent ? "(loaded)" : "(empty)"`) is removed or adapted — the preview can read the plugin-provided variable from the render context instead.

## Risks / Trade-offs

### Risk: Plugin load order affects route registration
Plugin routes are registered during `register()`, which runs during server initialization. If the state plugin fails to load, the status endpoint disappears. **Mitigation**: The status endpoint has been dropped entirely (unused by frontend), so this risk no longer applies.

### Risk: `getDynamicVariables()` adds latency to every template render
Each render now calls `getDynamicVariables()` on all plugins that export it. **Mitigation**: Currently only the state plugin will implement it. The function does one file read (same as the current `loadStatus()`), so net latency is unchanged. Future plugins adding dynamic variables should keep their implementations fast.

### Risk: Breaking the `register()` signature for existing plugins
This risk no longer applies — the `register()` signature is unchanged. Dynamic variables use a new `getDynamicVariables()` export, and the status route is dropped rather than moved.

### Risk: `status_data` unavailable when state plugin is disabled
If a user disables the state plugin, `{{ status_data }}` in `system.md` becomes an empty string (Vento treats undefined variables as empty). The `{{ if status_data }}` conditional already handles this gracefully — the block is simply not rendered. **Mitigation**: This is the desired behavior and matches the non-goal of "system functions without plugins" for non-core sections.
