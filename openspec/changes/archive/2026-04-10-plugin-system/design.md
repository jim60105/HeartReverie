# Plugin System — Design Document

## Context

The current architecture has hardcoded coupling at every layer:

- **Backend** (`writer/server.js`): `stripPromptTags()` uses a hardcoded regex list for `<options>`, `<disclaimer>`, `<user_message>`. The `renderSystemPrompt()` function passes a fixed set of 5 Vento variables. Post-response processing calls the `apply-patches` binary directly via `execFile`.
- **Frontend** (`reader/js/md-renderer.js`): The rendering pipeline is a numbered step list that imports specific extractors (`extractStatusBlocks`, `extractOptionsBlocks`, `extractVariableBlocks`) and strips specific tags (`<imgthink>`, `<disclaimer>`, `<user_message>`, `<T-task ...>`) with hardcoded regexes.
- **Prompt template** (`system.md`): Uses Vento `{{ include }}` to pull in 9 separate `.md` files. Adding a new prompt fragment means editing `system.md` directly.

Adding any new feature (e.g., a new LLM output tag with custom rendering) requires touching `server.js`, `md-renderer.js`, and `system.md` — three files with no shared abstraction. There is no way for a user to extend the system from outside the project.

## Goals / Non-Goals

**Goals:**

- Define a plugin manifest format that describes plugin capabilities declaratively
- Implement a plugin loader that discovers plugins from a built-in directory and a user-configurable external path
- Create a hook system with ordered stages covering the full chat lifecycle (prompt → stream → post-response → render → strip)
- Migrate all 12 existing tag-based features into plugins with zero behavioral change
- Add a prompt preview endpoint and frontend panel for inspecting the rendered system prompt
- Add Vento template error handling with structured error feedback
- Add a frontend prompt editor (編排器) for managing prompt composition with Vento parameter auto-fill
- Maintain the no-build-step constraint on the frontend

**Non-Goals:**

- Plugin marketplace or remote plugin installation — plugins are local directories only
- Plugin sandboxing or permission model — all plugins run with full trust
- Plugin versioning or dependency resolution between plugins
- Hot-reloading plugins at runtime — server restart is required to pick up changes
- Replacing Vento with a different template engine
- Changing the OpenRouter API integration or streaming protocol

## Decisions

### Decision 1: Plugin manifest format and loading

**Decision:** Each plugin is a directory containing a `plugin.json` manifest and its implementation files. Plugins are discovered by scanning two directories at server startup.

**Manifest format (`plugin.json`):**

```json
{
  "name": "options",
  "version": "1.0.0",
  "description": "Renders interactive options from <options> blocks",
  "type": "full-stack",
  "hooks": {
    "prompt-assembly": { "file": "./prompt.js", "priority": 100 },
    "frontend-render": { "file": "./render.js", "priority": 50 },
    "frontend-strip": { "file": "./strip.js", "priority": 50 }
  },
  "promptFragment": "./options.md",
  "frontendModule": "./frontend.js",
  "tags": ["options"]
}
```

Key fields:
- `name` — unique identifier, used as registry key
- `type` — one of: `full-stack`, `prompt-only`, `frontend-only`, `hook-only` (informational, not enforced — hooks field is the source of truth)
- `hooks` — maps hook stage names to handler files with numeric priority (lower runs first)
- `promptFragment` — optional path to a `.md` file contributed to prompt assembly
- `frontendModule` — optional path to an ES module exposing frontend tag handlers
- `tags` — list of XML tag names this plugin owns (used for registration and conflict detection)

**Plugin directories:**
- Built-in: `plugins/` at project root (committed to the repo, ships with the project)
- External: path from `PLUGIN_DIR` environment variable (user-managed, outside the repo)

**Loader behavior:**
1. At startup, scan both directories for subdirectories containing `plugin.json`
2. Parse each manifest, validate required fields (`name`, at minimum)
3. Register into a `PluginRegistry` (a `Map<string, PluginManifest>`)
4. Detect `name` collisions — external plugins override built-in plugins of the same name (allows user customization)
5. Log loaded plugins and any warnings

**Alternatives considered:**
- *YAML manifests* — rejected because JSON requires no additional parser dependency (Node has built-in `JSON.parse`), and the manifest is structured data, not prose
- *Convention-over-configuration (no manifest, detect by file names)* — rejected because explicit declaration makes capabilities discoverable and allows tooling (editor, preview) to introspect without executing code
- *Single-file plugins* — rejected because full-stack plugins need separate backend/frontend files, and prompt fragments are `.md` files best kept separate

### Decision 2: Hook system architecture

**Decision:** A synchronous, priority-ordered hook dispatcher that plugins register into at load time. Five hook stages cover the full lifecycle.

**Hook stages (in execution order):**

| Stage | When | Runs on | Input | Output |
|---|---|---|---|---|
| `prompt-assembly` | Before Vento render | Backend | `{ fragments, variables, templatePath }` | Mutated fragments/variables |
| `response-stream` | During SSE chunk processing | Backend | `{ chunk, accumulated }` | Pass-through (observe only) |
| `post-response` | After full response written | Backend | `{ content, storyDir, series, name }` | Side-effects (e.g., apply-patches) |
| `frontend-render` | During md-renderer pipeline | Frontend | `{ text, placeholderMap }` | Mutated text with placeholders |
| `frontend-strip` | Before markdown parse | Frontend | `{ text }` | Text with tags removed |

**Priority ordering:** Handlers within a stage execute in ascending numeric priority (lower number = earlier). Default priority is 100. Plugins declare priority in the manifest. Ties are resolved by plugin load order (built-in before external).

**Execution model:**
- All hooks are **synchronous** on the backend (using `await` for async handlers but executing sequentially, not concurrently) — this preserves deterministic ordering
- `response-stream` is observe-only (no mutation) to avoid corrupting the SSE stream
- Frontend hooks are synchronous by nature (DOM pipeline)

**Registration API (backend):**

```js
// writer/lib/hooks.js
class HookDispatcher {
  register(stage, handler, priority = 100) { ... }
  async dispatch(stage, context) { ... }
}
```

**Registration API (frontend):**

```js
// reader/js/plugin-hooks.js
class FrontendHookDispatcher {
  register(stage, handler, priority = 100) { ... }
  dispatch(stage, context) { ... }
}
```

**Alternatives considered:**
- *Event emitter pattern (pub/sub)* — rejected because ordering is critical (e.g., status extraction must happen before options extraction in the frontend pipeline) and event emitters don't guarantee handler order
- *Middleware chain (Express-style next())* — considered but adds complexity; the current pipeline is linear, not branching, so a simple sorted-list dispatch is clearer
- *Async parallel execution* — rejected because prompt assembly and rendering are inherently sequential (later plugins may depend on earlier mutations)

### Decision 3: Backend plugin integration

**Decision:** A `PluginManager` singleton in `writer/lib/plugin-manager.js` initializes at server startup, loads plugins, and exposes the hook dispatcher. The chat endpoint calls hooks at the appropriate lifecycle points.

**Startup sequence:**
1. `server.js` imports `PluginManager` and calls `await pluginManager.init()`
2. `init()` scans plugin directories, parses manifests, loads backend hook handlers via dynamic `import()`
3. Each handler's `register(hookDispatcher)` function is called, allowing it to subscribe to hooks
4. Prompt fragments are collected into an ordered list for the prompt-assembly stage

**Prompt assembly integration:**
- Current: `renderSystemPrompt()` reads `system.md` and passes 5 hardcoded variables to Vento
- New: Before Vento rendering, the `prompt-assembly` hook fires. Each prompt-fragment plugin contributes its `.md` content to a `fragments` map (keyed by plugin name). The template `system.md` gains a dynamic injection section:

```
{{- for fragment of plugin_fragments -}}
{{ fragment }}
{{- /for -}}
```

- Core prompt fragments (writestyle, de-robotization, world_aesthetic, T-task, Threshold-Lord) become plugins that register their `.md` content via the prompt-assembly hook
- The Vento variable set expands: `{ scenario, previous_context, user_input, status_data, isFirstRound, plugin_fragments }`

**stripPromptTags() integration:**
- Current: hardcoded regex list in `server.js`
- New: Each plugin declares its `tags` in the manifest. At startup, `PluginManager` builds a combined regex from all registered tags. `stripPromptTags()` uses this dynamic regex instead of the hardcoded one.

**Post-response integration:**
- Current: `execFileAsync(APPLY_PATCHES_BIN, ...)` called directly
- New: `apply-patches` becomes a `hook-only` plugin registering a `post-response` handler. The handler calls `execFileAsync` with the same arguments. The chat endpoint calls `await hookDispatcher.dispatch('post-response', context)` where the hardcoded call used to be.

**Alternatives considered:**
- *Plugin-provided Express middleware* — rejected because only the chat endpoint needs hook integration; adding middleware registration adds complexity without benefit
- *Separate prompt assembly service* — over-engineering for the current scale; keeping it in-process is simpler

### Decision 4: Frontend plugin integration

**Decision:** Frontend plugins are ES modules loaded dynamically via `import()` at page initialization. A `FrontendPluginLoader` in `reader/js/plugin-loader.js` fetches the plugin manifest list from a new API endpoint and loads each plugin's `frontendModule`.

**API endpoint:** `GET /api/plugins` — returns array of plugin manifests (filtered to those with `frontendModule` set). The frontend fetches this at startup.

**Plugin module contract:** Each frontend plugin ES module exports a `register(hooks)` function:

```js
// plugins/options/frontend.js
export function register(hooks) {
  hooks.register('frontend-render', extractAndRenderOptions, 50);
  hooks.register('frontend-strip', stripOptionsTags, 50);
}
```

**Integration with md-renderer.js:**
- Current: hardcoded import of `extractStatusBlocks`, `extractOptionsBlocks`, `extractVariableBlocks` and hardcoded strip regexes
- New: `renderChapter()` calls `frontendHooks.dispatch('frontend-render', { text, placeholderMap })` instead of individual extract calls, then calls `frontendHooks.dispatch('frontend-strip', { text })` instead of hardcoded regex strips
- The pipeline steps (quote normalization, newline doubling, marked parse, reinject placeholders, DOMPurify) remain in `md-renderer.js` — only the tag extraction/strip steps become hook-driven

**Module serving:** Plugin frontend modules are served as static files via a new Express route: `GET /plugins/:name/*` mapped to the plugin's directory. This works with the no-build-step constraint since plugins are standard ES modules.

**Alternatives considered:**
- *Inline plugin code in a single bundle* — contradicts the no-build-step requirement
- *Custom element (Web Components)* — considered for rendering, but the current placeholder-reinsertion pattern is simpler and already works; Web Components add ceremony without clear benefit here
- *Plugin code embedded in plugin.json* — rejected; `.js` files are the natural unit for ES modules

### Decision 5: Prompt editor (編排器) approach

**Decision:** A new frontend panel (`reader/js/prompt-editor.js`) that displays the prompt composition order, allows reordering/toggling of plugin prompt fragments, and provides Vento parameter auto-fill via a `<datalist>`-based autocomplete.

**UI components (no framework, vanilla JS — consistent with the existing frontend):**
- A collapsible side panel toggled by a toolbar button (labeled 編排器)
- An ordered list of prompt fragment entries, each showing: plugin name, enabled/disabled toggle, drag handle for reordering
- A parameter section showing all available Vento variables with current values
- A "preview" button that triggers the prompt preview endpoint

**Parameter discovery:**
- Core variables (`scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`) are always shown
- Plugin-contributed variables are declared in `plugin.json` under an optional `parameters` field:

```json
{
  "parameters": [
    { "name": "custom_style", "type": "string", "default": "" }
  ]
}
```

- The editor renders an input field for each parameter with a `<datalist>` element for autocompletion of known values

**Persistence:** Prompt fragment ordering and enabled/disabled state are saved to `localStorage` and sent with the chat request as an optional `promptConfig` field. The backend prompt-assembly hook respects this ordering. If no config is sent, the default order (from plugin priorities) is used.

**Alternatives considered:**
- *Monaco editor / CodeMirror for full template editing* — over-engineering; users need to arrange fragments and fill parameters, not write Vento code. A fragment arranger is more appropriate. Full template editing can be added later if needed.
- *React/Vue for the editor panel* — rejected to maintain the no-framework constraint across the entire frontend
- *Server-side persistence (database/file)* — rejected; `localStorage` is sufficient for per-browser preferences and avoids adding server-side state management

### Decision 6: Prompt preview implementation

**Decision:** A new API endpoint renders the system prompt with current context and returns it for inspection. A frontend panel displays the result.

**API endpoint:** `GET /api/stories/:series/:name/preview-prompt`

- Accepts optional query parameters to override variables (e.g., `?user_input=test`)
- Calls the same `renderSystemPrompt()` path as the chat endpoint, including plugin prompt-assembly hooks
- Returns `{ prompt: string, fragments: string[], variables: object, errors: [] }`
- The `fragments` array shows which plugins contributed and in what order
- The `errors` array surfaces any Vento rendering warnings (see Decision 7)

**Frontend panel:**
- A modal or side panel triggered from the 編排器 or a standalone button
- Displays the rendered prompt as syntax-highlighted text (using a `<pre>` block with basic CSS highlighting for Vento tags and XML blocks)
- Shows fragment boundaries with visual separators
- Read-only — not an editor

**Authentication:** Uses the same `verifyPassphrase` middleware as all other API endpoints.

**Rate limiting:** Shares the global API rate limit (60 req/min). No separate stricter limit needed since preview is read-only and lightweight.

**Alternatives considered:**
- *WebSocket-based live preview* — over-engineering; a simple GET request on button click is sufficient
- *Client-side rendering (run Vento in the browser)* — rejected because the browser doesn't have access to server-side files (prompt fragments, scenario, status). Server-side rendering is the only correct approach.

### Decision 7: Vento error handling strategy

**Decision:** Wrap `ventoEnv.runString()` in a try-catch that captures Vento errors and returns structured error objects instead of crashing the request.

**Error types to handle:**
1. **Missing variable** — Vento references an undefined variable (e.g., typo in `{{ scenaro }}`)
2. **Include failure** — `{{ include }}` references a file that doesn't exist
3. **Syntax error** — Malformed Vento template syntax

**Error structure:**

```json
{
  "type": "vento-error",
  "stage": "prompt-assembly",
  "message": "Variable 'scenaro' is not defined",
  "source": "system.md",
  "line": 31,
  "suggestion": "Did you mean 'scenario'?"
}
```

**Where errors surface:**
- **Chat endpoint**: If prompt rendering fails, return HTTP 422 with structured error body instead of a generic 500. The frontend displays the error in the chat panel so the user knows what went wrong.
- **Preview endpoint**: Errors are returned in the `errors` array alongside partial render output (when possible). This lets the user see both the problem and the context.
- **Server logs**: All Vento errors are logged with `console.error` for debugging.

**Suggestion generation:** For missing variables, compute Levenshtein distance against known variable names and suggest the closest match if distance ≤ 3. This is a simple heuristic, not a full spell-checker.

**Alternatives considered:**
- *Fail silently and substitute empty string* — rejected because silent failures are extremely hard to debug, especially with 12+ plugins contributing fragments
- *Strict mode (crash on any warning)* — too aggressive; some missing variables may be intentional during development
- *Client-side validation before sending* — the client doesn't have the template source, so server-side is the only viable location

### Decision 8: Plugin types and migration strategy

**Decision:** Four plugin types capture all existing features. Each type is a pattern, not a hard boundary — a plugin can combine behaviors.

**Plugin types:**

| Type | Backend hooks | Frontend module | Prompt fragment | Examples |
|---|---|---|---|---|
| `full-stack` | prompt-assembly, post-response | Yes (render + strip) | Yes | options, status, variable-display |
| `prompt-only` | prompt-assembly | Yes (strip only) | Yes | T-task, disclaimer, imgthink, user_message |
| `frontend-only` | None | Yes (render) | No | (future: custom renderers) |
| `hook-only` | post-response | No | No | apply-patches |

**Migration mapping (all 12 existing features):**

| # | Feature | Plugin name | Type | Current location | Migration notes |
|---|---|---|---|---|---|
| 1 | Options | `options` | full-stack | `options-panel.js` + `options.md` | Move `extractOptionsBlocks` to plugin frontend module; move `options.md` to plugin directory |
| 2 | Status | `status` | full-stack | `status-bar.js` + `status.md` | Move `extractStatusBlocks` to plugin; `status.md` → plugin prompt fragment |
| 3 | Variable display | `variable-display` | full-stack | `variable-display.js` | Move `extractVariableBlocks` to plugin; no prompt fragment (LLM produces `<UpdateVariable>` without explicit instruction in prompt — instruction is embedded in status.md) |
| 4 | T-task | `t-task` | prompt-only | `T-task.md` + strip regex in md-renderer | Move `.md` to plugin; register frontend-strip hook for `<T-task...>` tags |
| 5 | Disclaimer | `disclaimer` | prompt-only | strip regex in `md-renderer.js` + `server.js` | Register frontend-strip and backend-strip for `<disclaimer>` tags |
| 6 | imgthink | `imgthink` | prompt-only | strip regex in `md-renderer.js` | Register frontend-strip hook for `<imgthink>` |
| 7 | user_message | `user-message` | prompt-only | strip in both `server.js` and `md-renderer.js` | Register both backend-strip (for `stripPromptTags`) and frontend-strip hooks |
| 8 | Writestyle | `writestyle` | prompt-only | `writestyle.md` | Prompt fragment only; no tags to strip/render |
| 9 | World aesthetic | `world-aesthetic` | prompt-only | `world_aesthetic_program.md` | Prompt fragment only |
| 10 | De-robotization | `de-robotization` | prompt-only | `de-robotization.md` | Prompt fragment only |
| 11 | Threshold-Lord | `threshold-lord` | prompt-only | `Threshold-Lord_start.md` + `Threshold-Lord_end.md` | Two fragments injected at specific positions (start and end of prompt). Uses priority to control placement: start at priority 10, end at priority 900. |
| 12 | Apply-patches | `apply-patches` | hook-only | hardcoded `execFileAsync` in `server.js` | `post-response` hook handler; calls same binary with same arguments |

**Migration approach:**
- Each feature is migrated as an independent unit — create the plugin directory, write the manifest, move the implementation files, update imports
- After all plugins are migrated, remove the hardcoded logic from `server.js` and `md-renderer.js`
- The prompt template `system.md` is simplified: static content remains inline, plugin fragments are injected via the `plugin_fragments` loop
- Backward compatibility is verified by diffing the rendered prompt output before and after migration (using the preview endpoint)

## Risks / Trade-offs

**Risk: Plugin load-order sensitivity**
Some plugins depend on execution order (e.g., status extraction must happen before options extraction in the frontend, because `<status>` blocks may appear inside `<options>` blocks or vice versa). Mitigation: explicit numeric priority in manifests. Document known ordering constraints in plugin README files.

**Risk: Threshold-Lord positional injection**
The Threshold-Lord prompt fragments must appear at the very start and very end of the system prompt. This is a special case that doesn't fit the simple "append all fragments" model. Mitigation: support priority-based insertion with well-known slots (priority 10 = near start, priority 900 = near end). The `system.md` template retains its static structure and plugin fragments are injected at a defined insertion point, with Threshold-Lord using Vento variables set at specific positions in the template rather than the generic `plugin_fragments` loop.

**Risk: Frontend module loading latency**
Loading 12+ plugin ES modules at page load could cause a visible delay. Mitigation: plugins are small (each is a single extract/render function), and modules are loaded in parallel via `Promise.all(imports)`. Cache headers ensure subsequent loads are instant.

**Risk: Breaking custom forks**
The proposal explicitly marks two breaking changes. Mitigation: document the migration path. The hook registration API is simpler than the current "edit three files" approach, so migrating custom forks should be straightforward.

**Risk: PLUGIN_DIR path traversal**
External plugin paths could potentially reference sensitive directories. Mitigation: validate that `PLUGIN_DIR` is an absolute path, exists, and contains only directories with `plugin.json` files. Do not serve arbitrary files — only files referenced in manifests.

**Trade-off: Startup cost vs. runtime simplicity**
Loading all plugins at startup (rather than lazily) adds a few hundred milliseconds to server start. This is acceptable because the server starts once and runs continuously. The benefit is that the registry is complete and immutable at runtime — no race conditions or partial-load states.

**Trade-off: localStorage for prompt config**
Using `localStorage` means prompt configuration is per-browser, not per-user. This is acceptable for a single-user application. If multi-user support is added later, the config can be moved to a server-side file.

## Migration Plan

The migration is ordered to minimize risk — infrastructure first, then features from simplest to most complex.

**Phase 1: Infrastructure**
1. Create `writer/lib/hooks.js` — `HookDispatcher` class
2. Create `writer/lib/plugin-manager.js` — `PluginManager` class with manifest loading
3. Create `reader/js/plugin-hooks.js` — `FrontendHookDispatcher` class
4. Create `reader/js/plugin-loader.js` — `FrontendPluginLoader` with API fetch
5. Add `GET /api/plugins` endpoint to `server.js`
6. Add `GET /api/stories/:series/:name/preview-prompt` endpoint
7. Add Vento error handling wrapper around `renderSystemPrompt()`

**Phase 2: Prompt-only plugins (low-risk, no frontend rendering)**
8. Migrate `writestyle` → `plugins/writestyle/`
9. Migrate `world-aesthetic` → `plugins/world-aesthetic/`
10. Migrate `de-robotization` → `plugins/de-robotization/`
11. Migrate `threshold-lord` → `plugins/threshold-lord/`
12. Migrate `t-task` → `plugins/t-task/`
13. Migrate `disclaimer` → `plugins/disclaimer/`
14. Migrate `imgthink` → `plugins/imgthink/`
15. Migrate `user-message` → `plugins/user-message/`

**Phase 3: Full-stack plugins (frontend rendering changes)**
16. Migrate `options` → `plugins/options/`
17. Migrate `status` → `plugins/status/`
18. Migrate `variable-display` → `plugins/variable-display/`

**Phase 4: Hook-only plugin**
19. Migrate `apply-patches` → `plugins/apply-patches/`

**Phase 5: Frontend features**
20. Build prompt editor (編排器) panel
21. Build prompt preview panel
22. Integrate plugin-loader into `reader/index.html`

**Phase 6: Cleanup**
23. Remove hardcoded tag logic from `md-renderer.js`
24. Remove hardcoded `stripPromptTags()` regex from `server.js`
25. Remove hardcoded `execFileAsync` call from chat endpoint
26. Simplify `system.md` template to use plugin fragment injection
27. Verify rendered prompt output matches pre-migration baseline

## Open Questions

1. **Threshold-Lord template positioning** — Should the start/end fragments use the generic `plugin_fragments` injection point with extreme priorities, or should `system.md` retain explicit named slots (`{{ threshold_lord_start }}` / `{{ threshold_lord_end }}`) that the plugin populates as Vento variables? The latter is more explicit but couples the template to a specific plugin.

2. **Plugin-contributed Vento variables** — Should plugins be able to inject new Vento variables into the template context (e.g., a plugin that adds a `{{ mood }}` variable), or should they only contribute prompt fragments as text? Variable injection is more powerful but harder to debug and creates implicit coupling between plugins and templates.

3. **Frontend plugin CSS** — Some plugins (options, status) have associated styles currently in the global stylesheet. Should plugins contribute their own `<style>` elements, or should all styles remain in the global CSS? Plugin-scoped styles are cleaner but harder to override.

4. **Prompt fragment format** — Should plugin prompt fragments be raw Markdown strings or Vento templates that can reference variables? If Vento templates, they need access to the same variable context as `system.md`, which increases coupling. If raw strings, they can't be conditional.

5. **External plugin security** — Should external plugins from `PLUGIN_DIR` require any validation beyond having a valid `plugin.json`? The current design trusts all plugins fully. Should there be a manifest signature or allowlist mechanism?

6. **Prompt editor persistence scope** — The design uses `localStorage` for prompt configuration. Should there also be a per-story config file (e.g., `playground/:series/plugin-config.json`) so that different stories can have different plugin configurations?
