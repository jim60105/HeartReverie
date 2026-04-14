# Design: Enhance Template Variables

## Context

The Vento prompt template system (`writer/lib/template.ts`) renders `system.md` through the Vento engine with a context object containing core variables (`previous_context`, `user_input`, `status_data`, `isFirstRound`), lore variables (`lore_all`, `lore_<tag>`, `lore_tags`), plugin variables, and `plugin_fragments`. The `renderSystemPrompt()` function (lines 67–135) receives `series` and `story` parameters but only passes them to `resolveLoreVariables()` — they are not exposed in the Vento context despite `system.md` already referencing `{{ series_name }}`.

The lore codex (`writer/lib/lore.ts`) collects passages from three scopes (global `_lore/`, series `<series>/_lore/`, story `<series>/<story>/_lore/`), parses YAML frontmatter, and generates template variables via `generateLoreVariables()`. Passage content is read as raw text with `Deno.readTextFile()` and concatenated verbatim — there is no Vento rendering pass, so Vento syntax like `{{ lore_character }}` inside a passage is passed through literally.

The prompt editor's variable pills (`PromptEditor.vue` lines 58–68) display clickable pills for each variable returned by `GET /api/plugins/parameters`. The `getParameters()` method in `plugin-manager.ts` (lines 352–391) hardcodes core variables and iterates plugins, but still lists the stale `scenario` variable (removed when the lore codex replaced it) and does not include lore variables at all. The frontend uses a binary classification: `pill-core` (blue) for `source === "core"` and `pill-plugin` (green) for everything else.

The known-variables list in `errors.ts` (line 42) also includes `scenario`, used by the Levenshtein-based "Did you mean?" suggestion when a Vento variable is undefined.

## Goals / Non-Goals

### Goals

- **Add `series_name` and `story_name` as core template variables** — inject the current series and story names into the Vento context so `system.md` and lore passages can reference them.
- **Enable Vento rendering in lore codex passages** — process lore passage content through the Vento engine so passages can reference other lore variables and core variables.
- **Remove stale `scenario` remnants** — clean up the non-functional `scenario` entry from `getParameters()` core list and the `errors.ts` known-variables list.
- **Make lore variables discoverable in prompt editor pills** — introduce a `"lore"` variable source type so lore variables appear in the pills UI with distinct styling.

### Non-Goals

- Changing the lore storage format (YAML frontmatter + Markdown body) or the lore CRUD API.
- Adding new Vento directives, filters, or custom tags.
- Modifying the plugin variable system or plugin manifest schema.
- Supporting recursive or multi-level Vento rendering (beyond two passes).

## Decisions

### Decision 1: `series_name` and `story_name` injection point

Add `series_name` and `story_name` directly in the Vento context object inside `renderSystemPrompt()` (line 119). The values come from the existing `series` and `story` parameters already received by the function. When `story` is `undefined` (no story selected), `story_name` defaults to an empty string.

This is a one-line addition to the context spread — no new plumbing, no API changes, no additional parameters to thread through.

Both variables are also added to the core list in `getParameters()` and to the known-variables list in `errors.ts` so they appear in pills and are eligible for "Did you mean?" suggestions.

### Decision 2: Lore Vento rendering — two-pass, per-passage approach

The core challenge is that lore passages may reference other lore variables (e.g., `scenario.md` contains `{{ lore_character }}`). All lore variables must be generated before any passage can be rendered, creating a dependency problem. Additionally, a single broken passage must not poison an entire lore variable — the spec requires per-passage error fallback.

**Approach: two-pass rendering with per-passage granularity.**

1. **First pass (collect raw passages)** — `resolveLoreVariables()` returns the raw `LorePassage[]` array (already collected from applicable scopes) instead of (or in addition to) the final concatenated lore variables. Call `generateLoreVariables()` on these raw passages to produce the first-pass lore variable snapshot — this gives us the full set of lore variable names and their raw values for use as rendering context.
2. **Second pass (render each passage individually)** — in `renderSystemPrompt()` inside `template.ts`, iterate over each raw passage and render its body through `ventoEnv.runString()` with an **immutable snapshot** of the first-pass context (all first-pass lore variables + core variables like `series_name` and `story_name`). The snapshot is frozen before iteration begins — the second pass does **not** mutate the context as it iterates, making cycle behavior deterministic regardless of iteration order. Each passage render is wrapped in a try/catch: on error, the passage falls back to its raw (unrendered) body and the error is logged.
3. **Post-render aggregation** — after all passages are rendered, call `generateLoreVariables()` again on the rendered passages to produce the final lore template variables (concatenated `lore_all`, per-tag `lore_<tag>`, `lore_tags` array). These final variables are spread into the Vento context for the main `system.md` render.

**Concrete API shape:**

- `resolveLoreVariables()` in `lore.ts` gains a return path that exposes raw passages (e.g., returns `{ passages: LorePassage[], vars: LoreTemplateVars }` or simply returns `LorePassage[]` and lets the caller generate variables).
- `template.ts` orchestrates the two-pass flow: collect raw passages → generate first-pass vars → build immutable snapshot → render each passage body → generate final vars from rendered passages.
- `lore.ts` remains free of Vento dependency — all rendering stays in `template.ts`.

**Circular references** (passage A uses `{{ lore_b }}`, passage B uses `{{ lore_a }}`) resolve deterministically: both sides see the other's raw (first-pass) content, because the rendering context is an immutable snapshot taken before any second-pass rendering begins. This is an acceptable edge case — document it in `docs/prompt-template.md`.

**Alternatives considered:**

- *Topological sort by dependency* — rejected as overly complex. Would require parsing Vento expressions to build a dependency graph, handling cycles explicitly, and reimplementing parts of the Vento engine. The two-pass approach covers the real use cases (one-directional references) without this complexity.
- *Recursive rendering until stable* — rejected due to potential infinite loops and difficulty defining a termination condition. Two passes provide a clear, predictable contract.
- *Per-variable rendering (concatenate then render)* — rejected because it loses per-passage error isolation. A single bad passage would cause the entire concatenated variable to fail rendering. Per-passage granularity ensures one broken passage falls back gracefully without affecting other passages in the same variable.

### Decision 3: Lore pill type and discovery

Add lore variables to the existing `GET /api/plugins/parameters` endpoint rather than creating a new endpoint. The endpoint gains optional `series` and `story` query parameters. When provided, `getParameters()` calls `resolveLoreVariables()` for that context and appends each lore variable name with `source: "lore"` and `type: "string"` (or `type: "array"` for `lore_tags`).

**Why extend the existing endpoint:**

- The frontend (`usePromptEditor.ts`) already fetches this endpoint to populate pills. Adding lore variables here means zero new API surface — just additional query params and response entries.
- It keeps the "all available template variables" API in one place, which is the mental model the prompt editor is built around.
- The `PluginManager.getParameters()` method needs access to lore variable resolution. Since `PluginManager` doesn't own the playground directory config, the route handler in `plugins.ts` resolves lore variables and merges them into the response.

**Partial scope support:**

The endpoint supports partial lore scopes to match how `resolveLoreVariables()` already collects from applicable scopes:

- No context params → no lore variables (core + plugin only).
- `series` provided (no `story`) → include global + series-scope lore variables.
- Both `series` and `story` provided → include global + series + story-scope lore variables.

**Frontend behavior:**

- `usePromptEditor.ts` re-fetches parameters when the story context (series/story selection) changes, passing the current series and story as query params.
- When no story is selected but a series is selected, lore variables from global and series scopes are still included.

### Decision 4: Pill styling — third color for lore

Add a `.pill-lore` CSS class in `PromptEditor.vue` with a warm amber/gold color (`background: rgba(217, 158, 46, 0.15)`, `color: #d4a017`, `border: 1px solid rgba(217, 158, 46, 0.3)`) to visually distinguish lore variables from core (blue) and plugin (green).

Update the `:class` binding from the current binary check:

```
p.source === 'core' ? 'pill-core' : 'pill-plugin'
```

to a computed mapping:

```
{ 'pill-core': p.source === 'core',
  'pill-plugin': p.source !== 'core' && p.source !== 'lore',
  'pill-lore': p.source === 'lore' }
```

This creates a clear three-category visual system: blue for core engine variables, green for plugin-contributed variables, amber for lore codex variables.

### Decision 5: Stale `scenario` removal

Remove the `scenario` entry from:

1. `getParameters()` core list in `plugin-manager.ts` (line 354) — the `{ name: "scenario", ... }` object.
2. `errors.ts` known-variables array (line 42) — the `"scenario"` string.

No migration or deprecation is needed. The variable was already non-functional (never injected into the Vento context) since the lore codex replaced it. Any `system.md` template still referencing `{{ scenario }}` would get a Vento "variable not defined" error both before and after this change — the only difference is the "Did you mean?" suggestion will no longer suggest `scenario`.

### Decision 6: Frontend story context for lore pill discovery

The prompt editor page (`PromptEditorPage.vue`) needs the current story context to fetch lore-aware parameters. The context comes from the `useStorySelector` composable, which already manages the current series/story selection.

**Wiring:**

- `usePromptEditor` gains a `fetchParameters(series?: string, story?: string)` method that calls `GET /api/plugins/parameters` with the appropriate query params.
- `PromptEditorPage.vue` watches the story selector state (from `useStorySelector`) and calls `fetchParameters()` with the current selection whenever it changes.
- To prevent stale-response races during rapid story switching, each `fetchParameters()` call creates a new `AbortController` and aborts the previous in-flight request before starting a new one. The response handler checks whether the controller was aborted before applying the result, ensuring only the latest fetch updates the pill list.

### Decision 7: Dynamic known-variables for lore error suggestions

The `buildVentoError()` function in `errors.ts` uses a hardcoded known-variables list for Levenshtein-based "Did you mean?" suggestions when a Vento variable is undefined. With dynamic lore variables (`lore_character`, `lore_world`, etc.), typos like `lore_charcter` won't get useful suggestions unless lore variable names are passed into the error handler.

**Approach:** Extend `buildVentoError()` to accept an optional `extraKnownVars` parameter (string array). In `renderSystemPrompt()`, pass the lore variable names (keys from the resolved lore vars object) when calling the error handler. This keeps the error handler generic while enabling context-aware suggestions.

## Risks / Trade-offs

- **[Risk] Circular lore references produce raw Vento syntax** — Two-pass rendering handles one level of cross-reference cleanly. If passage A references `{{ lore_b }}` and passage B references `{{ lore_a }}`, one side will contain the other's raw `{{ ... }}` syntax. Mitigation: document this limitation in `docs/prompt-template.md` with an example. This is acceptable because circular lore references are an unusual authoring pattern, and the behavior is deterministic and non-destructive (raw syntax in LLM input is harmless).

- **[Risk] Lore rendering performance overhead** — An extra Vento render pass per string-valued lore variable adds processing time. Mitigation: lore passages are small text fragments (typically a few hundred characters), not large templates. The overhead per passage is sub-millisecond. The render happens once per prompt generation, which already includes an LLM API call measured in seconds. This is negligible.

- **[Risk] Stale-response races when switching stories** — If the user rapidly switches story context, multiple `fetchParameters()` calls may be in flight simultaneously. An earlier (slower) response arriving after a later one would overwrite the pill list with stale data. Mitigation: each `fetchParameters()` call creates a new `AbortController`, aborting the previous in-flight request. The response handler verifies the controller was not aborted before applying results, ensuring only the most recent fetch updates the UI (see Decision 6).

- **[Risk] Vento errors in lore passage content** — If a lore passage contains invalid Vento syntax, the second-pass render will throw. Mitigation: wrap each passage's render in a try/catch. On error, fall back to the raw (unrendered) content and log the error. This preserves the prompt generation pipeline — a broken lore passage shouldn't prevent the entire prompt from rendering.

- **[Trade-off] Extending `GET /api/plugins/parameters` vs. new endpoint** — Extending the existing endpoint keeps the frontend simpler (one API, one fetch) at the cost of adding optional query parameters and making `getParameters()` context-dependent. A dedicated `GET /api/lore/variables` endpoint would be more RESTful but would require the frontend to merge two data sources and add a second fetch. We chose the pragmatic single-endpoint approach because the prompt editor's data model is "all available variables" — splitting that across endpoints adds complexity without meaningful benefit.

- **[Trade-off] Rendering lore in `template.ts` vs. `lore.ts`** — Placing the second-pass Vento rendering in `template.ts` (after `resolveLoreVariables()` returns, before the final template render) keeps `lore.ts` free of Vento engine dependency, maintaining a clean separation where `lore.ts` handles file I/O and data structure and `template.ts` owns all rendering. The cost is that `resolveLoreVariables()` returns "unfinished" data that requires a post-processing step. We accept this because the orchestration logic in `renderSystemPrompt()` is the natural place for multi-step rendering coordination.
