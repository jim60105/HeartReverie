## 1. Core Template Variables

- [x] 1.1 Add `series_name` and `story_name` to the Vento context object in `renderSystemPrompt()` (`writer/lib/template.ts`), using the existing `series` and `story` parameters (default to empty string when undefined)
- [x] 1.2 Add `series_name` and `story_name` to the core variable list in `getParameters()` (`writer/lib/plugin-manager.ts`)
- [x] 1.3 Add `series_name` and `story_name` to the known-variables list in `writer/lib/errors.ts`
- [x] 1.4 Remove stale `scenario` entry from the core variable list in `getParameters()` (`writer/lib/plugin-manager.ts`)
- [x] 1.5 Remove stale `scenario` from the known-variables list in `writer/lib/errors.ts`

## 2. Lore Vento Rendering

- [x] 2.1 Refactor `resolveLoreVariables()` in `writer/lib/lore.ts` to export the collected passages (before concatenation) alongside or instead of the generated variables, enabling the caller to render passage bodies before variable generation
- [x] 2.2 Implement per-passage Vento rendering in `writer/lib/template.ts`: after collecting raw passages via lore.ts, generate a first-pass lore variable snapshot, render each individual passage body through `ventoEnv.runString()` with an immutable snapshot context (all first-pass lore vars + `series_name` + `story_name`), wrapping each in try/catch to fall back to raw content on error
- [x] 2.3 Re-generate lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) from the rendered passage bodies using `generateLoreVariables()`, and integrate into `renderSystemPrompt()` before the final template render

## 3. Lore Variable Discovery API

- [x] 3.1 Update `GET /api/plugins/parameters` route handler in `writer/routes/plugins.ts` to accept optional `series` and `story` query parameters; when only `series` is provided (no `story`), the endpoint returns global + series-scope lore variables
- [x] 3.2 When `series` and `story` are provided, call `resolveLoreVariables()` and append lore variables (`lore_all`, `lore_tags`, and dynamic `lore_<tag>`) to the response with `source: "lore"`
- [x] 3.3 Ensure `lore_all` and `lore_tags` are always included when story context is provided, even if no passages exist

## 4. Frontend Lore Pills

- [x] 4.1 Update `PromptEditor.vue` pill class binding to support three categories: `.pill-core` (blue), `.pill-plugin` (green), `.pill-lore` (amber/gold)
- [x] 4.2 Add `.pill-lore` CSS styles in `PromptEditor.vue` with amber/gold color scheme
- [x] 4.3 Update `usePromptEditor.ts` to pass current `series` and `story` query parameters (obtained from the `useStorySelector` composable) when fetching `GET /api/plugins/parameters`
- [x] 4.4 Add a watcher in `usePromptEditor.ts` to re-fetch parameters when the story context changes, using an AbortController to cancel in-flight requests and prevent stale-response races during rapid story switching

## 5. Documentation & Tests

- [x] 5.1 Update `docs/prompt-template.md` to document `series_name` and `story_name` variables and the lore Vento rendering capability (including circular reference limitation)
- [x] 5.2 Write backend tests for `series_name` and `story_name` injection in `renderSystemPrompt()`
- [x] 5.3 Write backend tests for the lore two-pass Vento rendering (cross-references, error fallback, plain content unchanged)
- [x] 5.4 Write backend tests for the parameters endpoint with lore variable discovery (`series`/`story` query params), including series-only context (partial scope returning global + series lore variables)
- [x] 5.5 Write frontend tests for `usePromptEditor` re-fetch on context change and `PromptEditor.vue` lore pill class mapping
- [x] 5.6 Pass lore variable names into `buildVentoError()` in `writer/lib/errors.ts` so that typos like `lore_charcter` get "Did you mean `lore_character`?" suggestions
- [x] 5.7 Run full test suite (`deno task test`) to verify no regressions
