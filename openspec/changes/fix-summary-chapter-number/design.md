## Context

`plugins/context-compaction/plugin.json` declares one named `promptFragments` entry pointing to `chapter-summary-instruction.md` with `variable: "context_compaction"`. At render time `PluginManager.getPromptVariables()` reads the file as raw text (`Deno.readTextFile`) and stores the bytes verbatim in the `variables` map. `writer/lib/template.ts#renderSystemPrompt` then spreads `pluginVars.variables` into the Vento context for `system.md`. When `system.md` references `{{ context_compaction }}`, Vento substitutes the raw bytes — it does **not** recursively render that string.

Today the fragment contains `第 ${chapter_number} 章：…`. `${...}` is not Vento syntax, and even if it were, Vento would not re-evaluate variable contents. The placeholder reaches the LLM literally; the LLM then guesses the chapter number from context and frequently picks the wrong one.

The engine already knows the canonical chapter number: `writer/lib/story.ts#resolveTargetChapterNumber()` parses it from the zero-padded filename (`0042.md` → `42`) and `renderSystemPrompt` receives it as the `chapterNumber: number | undefined` option, currently forwarded only to `getDynamicVariables()`.

## Goals / Non-Goals

**Goals:**
- The system prompt that the LLM sees contains `第 42 章` (or the equivalent number) — substituted by the engine, sourced from the target chapter's filename.
- The instruction text actively *tells* the LLM the chapter number and orders it to use that exact number, instead of asking it to derive one.
- Fragment-level Vento templating works for any plugin's named `promptFragments` entry, not just this one — generic plumbing, no plugin-specific hack.
- Test coverage proves the rendered instruction contains the right number and no longer contains the old `${...}` placeholder.

**Non-Goals:**
- Changing the summary output schema (`<chapter_summary>` tag, "key events / state changes / unresolved threads" structure).
- Touching the L0/L1/L2 tiered assembly, `compactor.ts`, `extractor.ts`, or `compaction-config.yaml` semantics.
- Adding a batch / range summarisation path. Summaries are emitted inline during single-chapter generation, so a scalar `chapter_number` is sufficient. (If a future change introduces batch summarisation, that change can add a `chapter_numbers` list — explicitly out of scope here.)
- Backward compatibility with the old `${chapter_number}` syntax (the project does not require it).

## Decisions

### D1. Render named-variable prompt fragments through Vento

Render each plugin's named-variable fragment file through `ventoEnv.runString` *before* merging into the system-prompt render context. Pass a small, well-defined sub-context that includes the same dynamic data already available to `system.md` — at minimum `chapter_number`, plus `series_name`, `story_name`, and the dynamic plugin variables (so other fragments could reference e.g. `status_data` if needed in future).

Implementation site: `writer/lib/template.ts#renderSystemPrompt`, immediately after `pluginManager.getPromptVariables()` returns. Iterate `pluginVars.variables`; for any value containing `{{`, run it through `ventoEnv.runString` with the prepared context; on render failure, log a warning that includes `{ variable, plugin, file, error }` and fall back to the raw content (mirroring the existing lore-passage behaviour at lines 156–172).

To make the warning attributable, extend `PluginManager.getPromptVariables()`'s return shape with a parallel **`metadata: Record<string, { plugin: string; file: string }>`** map keyed by the same variable name as `variables`. The existing `variables` and `fragments` fields remain unchanged, so the ~60 existing test mocks and the `routes/prompt.ts` consumer keep compiling without edits — they simply ignore the new optional field. Update the `PromptVariables` interface in `writer/lib/plugin-manager.ts` to make `metadata` an optional property to preserve mock compatibility, and have `getPromptVariables()` always populate it.

**Why a parallel map, not nested objects:** changing each entry from `string` to `{ content, plugin, file }` would force every one of the ~60 mocks in `tests/` to update. A parallel optional `metadata` map is purely additive.

**Why here, not inside `getPromptVariables()`:** `getPromptVariables()` has no access to per-render data like `chapterNumber`. Keeping the render at the call site keeps the plugin manager's responsibility purely "load files + report origins".

**Alternative considered — pre-render in `getPromptVariables()`:** rejected, would require threading dynamic context through `PluginManager` and force every caller to provide it.

**Alternative considered — re-rendering recursively inside `system.md`:** rejected, Vento does not natively re-render variable contents and adding that would weaken the SSTI whitelist guarantees.

**Alternative considered — best-effort logging without origin metadata:** rejected, the spec scenario explicitly requires the warning to attribute the failure to a specific plugin + file so operators can fix the offending fragment.

### D2. Variable name: scalar `chapter_number`

Use the snake_case identifier `chapter_number` as the Vento variable name in the fragment. This matches the convention already used in `system.md` (`series_name`, `story_name`, `previous_context`, `user_input`, `status_data`). The existing `chapterNumber` camelCase only appears at the TypeScript API boundary; the rendering surface is snake_case.

Scalar (`number`), not a list — see Non-Goals.

### D3. Fragment rewrite

Rewrite `chapter-summary-instruction.md`:

- Replace the placeholder `${chapter_number}` with `{{ chapter_number }}`.
- Add a sentence near the top of the instruction that states "本次生成的是第 {{ chapter_number }} 章" (or equivalent) and instructs the LLM to use that exact number in the `<chapter_summary>` body.
- Remove or rephrase any wording that asks the LLM to determine/count the chapter number.

The fragment remains valid Markdown / harmless when rendered with no variables (renders to `第  章` worst case), so plugin-loading paths that don't supply `chapter_number` won't crash.

### D4. SSTI whitelist compatibility

`validateTemplate()` in `writer/lib/template.ts` whitelists `{{ <ident> }}` and `{{ <ident> |> filter }}`. `{{ chapter_number }}` is a bare identifier and passes. No whitelist change required. We do **not** apply `validateTemplate` to plugin-supplied fragments at runtime (plugins are first-party, like lore passages), but `chapter_number` would be valid even under the strict whitelist.

## Risks / Trade-offs

- **Risk:** A plugin author writes invalid Vento (`{{ if x }}` without `{{ /if }}`) in a fragment. → **Mitigation:** wrap the per-fragment render in try/catch, log a warning with `plugin: <name>, file: <fragment>`, and fall back to the raw fragment content. Mirrors the existing `loreResolution.passages` behaviour.
- **Risk:** Other existing plugin fragments contain literal `{{` / `}}` that were previously inert and now get interpreted. → **Mitigation:** the only first-party fragments live under `plugins/`; a quick grep at implementation time will catch any. None are expected.
- **Trade-off:** The system prompt now contains the chapter number twice (once in the instruction, once wherever else it surfaces), slightly more tokens. Negligible.
- **Risk:** `chapterNumber` is `undefined` when summarisation runs in a non-chapter-generation context. → **Mitigation:** `renderSystemPrompt` already defaults to `1` when forwarding to `getDynamicVariables`; we do the same when building the fragment-render context.

## Migration Plan

1. Land code + fragment + test together. No data migration. No config migration.
2. No rollback concern — old `${chapter_number}` text is replaced atomically; any in-flight chapter summaries the LLM already produced remain valid.

## Open Questions

None.
