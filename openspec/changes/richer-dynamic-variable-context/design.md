## Context

The plugin system in HeartReverie lets backend plugins contribute Vento template variables at render time via an optional `getDynamicVariables(context)` export (`writer/lib/plugin-manager.ts`, `writer/types.ts`). The context handed to plugins today is minimal:

```ts
// writer/types.ts — current
export interface DynamicVariableContext {
  readonly series: string;
  readonly name: string;
  readonly storyDir: string;
}
```

That is enough to locate a story on disk, but plugins cannot react to the *request* being served. All of the following already exist inside `buildPromptFromStory()` in `writer/lib/story.ts` but are discarded before plugins are asked:

- the `message` parameter (user input for this turn),
- `isFirstRound`, derived from the chapter list,
- the `chapters` array (from which previous content and chapter count are trivial to derive),
- and the target chapter number, which is computed in `writer/lib/chat-shared.ts` *after* prompt building using a "reuse last empty file or next" rule.

Because of this, plugins that want to produce per-request variables (a hint plugin keyed on `isFirstRound`, a plugin that summarizes only the previous chapter, a router that branches on `userInput`) have to re-read the story directory themselves and guess the target chapter. This change widens the context so the orchestration layer is the single source of truth.

Stakeholders: plugin authors (consumers), `writer-backend` maintainers (producers), prompt-authoring users (indirectly, through better plugins).

## Goals / Non-Goals

**Goals:**

- Expose `userInput`, `chapterNumber`, `previousContent`, `isFirstRound`, and `chapterCount` to `getDynamicVariables()` using data already computed in `buildPromptFromStory()`.
- Keep the context a plain serializable object (no functions, no file handles, no `AppConfig`) so it is safe to log and to pass across future IPC boundaries.
- Compute the target `chapterNumber` using the same "reuse last empty file or create next" rule currently in `writer/lib/chat-shared.ts` by extracting it into a small shared helper that both sites call — so the number handed to plugins matches the file that will actually be written.
- Avoid leaking the new values into the Vento template context as core variables — only `getDynamicVariables()` consumers see them. Core Vento variables are defined by the `vento-prompt-template` spec and deliberately left untouched.

**Non-Goals:**

- No change to the Vento template contract (`previous_context`, `user_input`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`, `lore_*`).
- No change to the `prompt-assembly` / `pre-write` / `post-response` / `strip-tags` / `response-stream` hook signatures.
- No back-compat shim — there are zero production consumers today; the context is widened in a single commit.
- No new request lifecycle data beyond the five listed fields (e.g., no `correlationId`, no `config`, no `signal`). These either leak infrastructure or are sensitive.

## Decisions

### D1: Extend `DynamicVariableContext` rather than introduce a new type

Before:

```ts
export interface DynamicVariableContext {
  readonly series: string;
  readonly name: string;
  readonly storyDir: string;
}
```

After:

```ts
export interface DynamicVariableContext {
  readonly series: string;
  readonly name: string;
  readonly storyDir: string;
  readonly userInput: string;
  readonly chapterNumber: number;
  readonly previousContent: string;
  readonly isFirstRound: boolean;
  readonly chapterCount: number;
}
```

**Rationale:** Adding read-only fields is non-breaking for existing plugin modules — TypeScript plugin signatures only need to read a subset. Creating a parallel `DynamicVariableContextV2` would force a dispatch path in `PluginManager.#dynamicVarProviders`, which is wasted complexity given there are no external consumers to preserve.

**Alternative considered:** Pass a single opaque `request` object (`{ series, name, storyDir, request: { message, chapterNumber, ... } }`). Rejected because plugin authors then have to learn two layers, and JSDoc is harder to autocomplete.

### D2: Source the new fields inside `buildPromptFromStory()`, not further upstream

The richer context is assembled inside `writer/lib/story.ts::buildPromptFromStory` and passed into `renderSystemPrompt()` via `RenderOptions`. `RenderOptions` already carries `previousContext`, `userInput`, `isFirstRound`, and `storyDir`; we extend it with `chapterNumber`, `previousContent`, and `chapterCount`.

**Rationale:** `buildPromptFromStory()` is the only place that has *all* of the needed inputs: it reads the chapter directory, knows `message` (passed as its fourth argument), and computes `isFirstRound`. `renderSystemPrompt()` then forwards them to `pluginManager.getDynamicVariables()` verbatim.

**Alternative considered:** Compute the context in `executeChat()` (chat-shared.ts) and pass it through `buildPromptFromStory`. Rejected because `buildPromptFromStory` is also used by the `/api/stories/:series/:name/preview-prompt` preview route (see `writer-backend` spec), which does not go through `executeChat`. Centralizing at the `buildPromptFromStory` layer keeps the preview path and the real chat path identical.

### D3: Share the target-chapter calculation between `buildPromptFromStory` and `executeChat`

Today `executeChat()` computes `targetNum` *after* calling `buildPromptFromStory()` using the returned `chapterFiles` and `chapters` arrays. For the preview route there is no writing, so no target is computed. To keep `chapterNumber` in the plugin context consistent with the file that `executeChat()` will ultimately write, extract the rule into a pure helper in `writer/lib/story.ts`:

```ts
// Given chapterFiles and chapters (as already built in buildPromptFromStory), return
// the 1-based chapter number that the next write will target.
export function resolveTargetChapterNumber(
  chapterFiles: readonly string[],
  chapters: readonly ChapterEntry[],
): number
```

`buildPromptFromStory()` calls this helper once and includes the result in `RenderOptions`. `executeChat()` calls the same helper on the already-returned `chapterFiles`/`chapters` to decide where to write. Both sites therefore agree.

**Rationale:** Duplicating the "reuse last empty or next" logic would risk drift. Preview requests also benefit: they get a stable `chapterNumber` for plugins without needing a separate code path.

### D4: `previousContent` is the *unstripped* content of the chapter immediately preceding `chapterNumber`

If `chapterNumber` reuses an existing empty file, `previousContent` is the last non-empty chapter's content. If `chapterNumber` is new, it is the last chapter on disk's content (which, by construction, is non-empty — otherwise the reuse branch would have fired). If there are no chapters, `previousContent` is `""`.

**Rationale:** Plugins that want the stripped array already have it via other variables; the raw last chapter is the one thing they cannot reconstruct without re-reading disk.

### D5: `chapterCount` counts all chapter files on disk (including empty)

Including the empty trailing chapter (which is very common — it is how the UI signals "generate here") makes the value easy to reason about relative to `chapterNumber`. `chapterFiles.length` in `buildPromptFromStory()` is used directly.

### D6: Update the Plugin module signature and documentation in lockstep

`PluginModule.getDynamicVariables` in `writer/types.ts` and the cached provider map in `writer/lib/plugin-manager.ts` both move to the widened `DynamicVariableContext`. No new collision rules are needed: the existing `#CORE_TEMPLATE_VARS` guard and first-loaded-wins policy apply unchanged.

## Risks / Trade-offs

- **[Risk]** Plugins might log or echo `userInput` into generated chapters, effectively persisting potentially sensitive user text. → **Mitigation:** call out in plugin-author docs that `userInput` equals the raw user message; recommend scrubbing before storing. No backend enforcement is added because plugins are first-party today.
- **[Risk]** `previousContent` can be large (tens of KB). Plugins that blindly stuff it into another variable will blow up context length. → **Mitigation:** document the size characteristic; the existing `context-compaction` plugin is the canonical example of how to summarize previous chapters.
- **[Risk]** The extracted `resolveTargetChapterNumber()` helper becomes load-bearing for two code paths; a regression is hard to spot visually. → **Mitigation:** add a focused unit test in `tests/writer/lib/story_test.ts` that covers the reuse-last-empty, next-after-max, and empty-directory cases.
- **[Trade-off]** Passing five new fields through `RenderOptions` makes the options bag larger. We accept this over inventing a `DynamicVariableContext` constructor in `chat-shared.ts` because `RenderOptions` is already the single argument used by both `executeChat` and the preview route.
- **[Trade-off]** The preview route will now compute `chapterNumber` even though it never writes. Harmless; cost is one `Math.max` over the already-loaded file list.

## Migration Plan

Since there are no existing consumers of `getDynamicVariables()` with data that would break under the wider context, migration is a single atomic PR:

1. Extend the interfaces in `writer/types.ts`.
2. Add `resolveTargetChapterNumber()` to `writer/lib/story.ts` and use it both inside `buildPromptFromStory()` and from `writer/lib/chat-shared.ts` (replacing the inline calculation).
3. Propagate the new fields through `RenderOptions` in `writer/lib/template.ts` and into the `pluginManager.getDynamicVariables({ ... })` call.
4. Update unit tests.
5. Update `openspec/specs/writer-backend/spec.md` via the delta in this change.

Rollback is trivial: revert the commit. No data migration, no config knobs.

## Open Questions

- None. The set of fields was chosen to cover the example plugin use-cases called out in the proposal; further additions can be proposed as separate changes when a concrete need appears.
