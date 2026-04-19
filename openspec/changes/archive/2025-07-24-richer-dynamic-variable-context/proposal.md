## Why

The `DynamicVariableContext` passed to plugin `getDynamicVariables()` only exposes `series`, `name`, and `storyDir`. This is too thin for plugins that need to produce template variables that depend on the *current request* — such as the user's input, the chapter number being generated, or the immediately preceding chapter content. Today those values already exist inside `buildPromptFromStory()` but are thrown away before plugins are consulted.

Enriching the context unlocks genuinely dynamic plugins (e.g. a hint plugin that varies by `isFirstRound`, a context plugin that reacts to `userInput`, a memory plugin that summarizes the previous chapter) without every plugin having to re-derive data from `storyDir` on its own.

## What Changes

- Extend the `DynamicVariableContext` interface in `writer/types.ts` to include five additional read-only fields:
  - `userInput: string` — the raw user message triggering the current generation.
  - `chapterNumber: number` — the 1-based number of the chapter that will be produced by this request.
  - `previousContent: string` — the unstripped content of the chapter immediately preceding `chapterNumber` (empty string if none).
  - `isFirstRound: boolean` — mirrors the existing first-round detection already computed in `buildPromptFromStory()`.
  - `chapterCount: number` — number of existing chapter files (including empty ones) under `storyDir`.
- Thread the new fields through the call chain `executeChat()` → `buildPromptFromStory()` → `renderSystemPrompt()` → `PluginManager.getDynamicVariables()`, sourcing them from values already materialized in `writer/lib/story.ts` (chapter files, `isFirstRound`, and the caller's `message`). The target chapter number is computed using the same "reuse last empty file or next" rule already implemented in `writer/lib/chat-shared.ts`, extracted into a shared helper.
- Update `RenderOptions` in `writer/types.ts` so `renderSystemPrompt()` can receive the extra fields needed to construct the context.
- Update the `PluginModule.getDynamicVariables` signature and the `#dynamicVarProviders` map in `writer/lib/plugin-manager.ts` to reflect the richer context type.
- Document the new context fields for plugin authors alongside the existing dynamic-variable contract.

No behavior change for plugins that do not read the new fields — adding fields is a non-breaking interface widening. No new core template variables are introduced; the new data is only delivered to plugin `getDynamicVariables()` callbacks.

## Capabilities

### New Capabilities
<!-- None. This change enriches an existing contract. -->

### Modified Capabilities
- `writer-backend`: Updates the requirement covering `PluginManager.getDynamicVariables()` and the `PluginModule.getDynamicVariables` type so the context includes `userInput`, `chapterNumber`, `previousContent`, `isFirstRound`, and `chapterCount` in addition to `series`, `name`, and `storyDir`.

## Impact

- Affected code:
  - `writer/types.ts` — `DynamicVariableContext`, `PluginModule`, `RenderOptions`.
  - `writer/lib/plugin-manager.ts` — provider map type, `getDynamicVariables()` signature.
  - `writer/lib/template.ts` — `renderSystemPrompt()` forwards new fields into `pluginManager.getDynamicVariables()`.
  - `writer/lib/story.ts` — `buildPromptFromStory()` computes `chapterNumber`, `previousContent`, `chapterCount` and passes them through `RenderOptions`.
  - `writer/lib/chat-shared.ts` — target-chapter selection logic extracted into a shared helper reused by `buildPromptFromStory()`.
- Affected APIs: none externally. The Vento template contract is unchanged; only the plugin-facing `getDynamicVariables(context)` argument grows.
- Affected tests: `tests/writer/lib/plugin-manager_test.ts`, `tests/writer/lib/template_test.ts`, and any story/chat tests that stub `getDynamicVariables`.
- Security: new fields are derived from existing request and playground data; no credentials or config are exposed. The context remains a plain serializable object.
