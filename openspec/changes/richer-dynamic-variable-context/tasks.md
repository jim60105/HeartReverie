## 1. Types

- [ ] 1.1 Extend `DynamicVariableContext` in `writer/types.ts` with read-only fields `userInput: string`, `chapterNumber: number`, `previousContent: string`, `isFirstRound: boolean`, and `chapterCount: number` (in addition to existing `series`, `name`, `storyDir`).
- [ ] 1.2 Extend `RenderOptions` in `writer/types.ts` with optional `chapterNumber?: number`, `previousContent?: string`, and `chapterCount?: number` fields (the existing `userInput`, `isFirstRound`, and `storyDir` are already present).
- [ ] 1.3 Confirm `PluginModule.getDynamicVariables` in `writer/types.ts` already references `DynamicVariableContext` by name (no change required if so; otherwise update the inline type).

## 2. Shared chapter-number helper

- [ ] 2.1 Add a pure helper `resolveTargetChapterNumber(chapterFiles: readonly string[], chapters: readonly ChapterEntry[]): number` to `writer/lib/story.ts` implementing the "reuse last empty file, else max + 1, else 1" rule currently duplicated in `writer/lib/chat-shared.ts`.
- [ ] 2.2 Export the helper from `writer/lib/story.ts`.
- [ ] 2.3 Replace the inline target-chapter block in `writer/lib/chat-shared.ts` (`executeChat()` step 6) with a call to `resolveTargetChapterNumber(chapterFiles, chapters)`.

## 3. Build prompt wiring

- [ ] 3.1 In `buildPromptFromStory()` (`writer/lib/story.ts`), after `chapters` and `isFirstRound` are computed, call `resolveTargetChapterNumber(chapterFiles, chapters)` to obtain `chapterNumber`.
- [ ] 3.2 Derive `previousContent` as the content of the chapter immediately preceding `chapterNumber`: if `chapterNumber` reuses an existing empty file, use the last non-empty chapter's content; otherwise use the last chapter file's content. Empty string when no prior chapter exists.
- [ ] 3.3 Pass `chapterNumber`, `previousContent`, and `chapterCount: chapterFiles.length` into `renderSystemPrompt()` through `RenderOptions` (alongside the existing `previousContext`, `userInput`, `isFirstRound`, `storyDir`).

## 4. Template render wiring

- [ ] 4.1 In `renderSystemPrompt()` (`writer/lib/template.ts`), read the new `RenderOptions` fields and pass them, together with `series`, `name`, `storyDir`, `userInput`, and `isFirstRound`, into the `pluginManager.getDynamicVariables({ ... })` call. Default any missing field defensively (`userInput: ""`, `chapterNumber: 1`, `previousContent: ""`, `isFirstRound: false`, `chapterCount: 0`) so the preview path works if a caller omits them.
- [ ] 4.2 Verify no new core Vento template variable is introduced (the spread into `ventoEnv.runString()` must still produce the same set of core keys — the rich fields flow to plugins only).

## 5. Plugin manager

- [ ] 5.1 Update the `#dynamicVarProviders` map type in `writer/lib/plugin-manager.ts` and the `PluginManager.getDynamicVariables` method signature to use the widened `DynamicVariableContext`.
- [ ] 5.2 Keep the existing core-var rejection and first-loaded-wins collision policy unchanged.

## 6. Tests

- [ ] 6.1 Add unit tests for `resolveTargetChapterNumber()` in `tests/writer/lib/story_test.ts` covering: empty directory (→ 1), two non-empty chapters (→ 3), trailing empty file (→ 2), and single empty file (→ 1).
- [ ] 6.2 Extend `tests/writer/lib/plugin-manager_test.ts` to assert that a stub plugin's `getDynamicVariables` receives `userInput`, `chapterNumber`, `previousContent`, `isFirstRound`, and `chapterCount` with the expected values.
- [ ] 6.3 Extend `tests/writer/lib/template_test.ts` (or equivalent) to ensure `renderSystemPrompt()` forwards the new `RenderOptions` fields into `pluginManager.getDynamicVariables()`.
- [ ] 6.4 Run `deno task test:backend` and fix any regressions.

## 7. Documentation

- [ ] 7.1 Update plugin-authoring docs (`docs/plugin-system.md` if it covers dynamic variables, otherwise the README section that mentions `getDynamicVariables`) to document the new context fields and the size/privacy caveats from design.md (`userInput` is raw user text; `previousContent` can be large).
- [ ] 7.2 Cross-reference the updated `writer-backend` spec requirement in the docs so future readers can find the authoritative contract.
