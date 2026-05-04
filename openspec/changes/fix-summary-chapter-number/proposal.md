## Why

The `chapter-summary-instruction.md` fragment in the `context-compaction` plugin contains the placeholder `${chapter_number}` and asks the LLM to fill in "第 N 章". Because the fragment is loaded as raw text and exposed to `system.md` as the `context_compaction` Vento variable (whose contents are inlined verbatim, not re-rendered), the placeholder reaches the LLM untouched. The model then guesses the chapter number — and is often wrong — even though the engine already knows the canonical chapter number from the target chapter's filename.

## What Changes

- Render `plugins/context-compaction/chapter-summary-instruction.md` through the existing Vento engine when collecting prompt fragment variables, so plugin fragment files behave like the rest of the templating system.
- Inject the canonical chapter number — derived from the target chapter filename via `resolveTargetChapterNumber()` (already passed into `renderSystemPrompt` as `chapterNumber`) — into that render under a stable Vento variable name `chapter_number`.
- Extend `PluginManager.getPromptVariables()`'s return shape with an optional parallel `metadata: Record<string, { plugin: string; file: string }>` map so render-failure warnings can attribute the failure to a specific plugin and fragment file. Existing `variables` / `fragments` fields stay unchanged; the new field is additive and does not break existing test mocks.
- Rewrite the fragment Markdown to use `{{ chapter_number }}` (Vento syntax, not `${...}`) and to *tell* the LLM which chapter number to write rather than asking it to figure one out.
- Add a unit/snapshot test that renders a system prompt for a known target chapter (e.g. file `0042.md`) with the plugin loaded and asserts the rendered instruction contains `第 42 章` literally and no longer contains the literal placeholder. Add a negative test asserting the plugin/file attribution in the render-failure warning.

Out of scope: changing the summary's structure/format, the `<chapter_summary>` tag contract, the L0/L1/L2 tiered assembly, or any storage. No batch summarisation path exists in this plugin (summaries are produced inline during single-chapter generation), so `chapter_number` is a scalar — no list/range variant is needed.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `context-compaction`: tighten the "Chapter summary prompt injection" requirement so the rendered instruction must contain the canonical chapter number sourced from the target chapter filename, and must not delegate that decision to the LLM.

## Impact

- Code:
  - `writer/lib/plugin-manager.ts` — `getPromptVariables()` (or a new sibling) gains the ability to render named-variable fragment files through Vento using a small, scoped context that includes `chapter_number`. Alternatively a thin pre-render step in `writer/lib/template.ts` runs each plugin variable through `ventoEnv.runString` with the dynamic context before merging into the system-prompt render.
  - `plugins/context-compaction/chapter-summary-instruction.md` — placeholder syntax changed from `${chapter_number}` to `{{ chapter_number }}` and instruction wording updated to assert the number rather than request it.
- Tests: a new test under `tests/` (or `writer/lib/template.test.ts`) covering the rendered fragment.
- No DB / API / dependency changes. No breaking changes to the public plugin manifest schema (existing plugins without `{{ }}` in their fragment files render unchanged).
