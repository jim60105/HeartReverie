## Why

The frontend plugin system currently exposes only two hook stages — `frontend-render` and `notification` — which limits what plugins can do in the Vue reader. Many plugin use cases (intercepting user input before send, post-processing rendered chapter HTML, reacting to story/chapter navigation, cleaning up state on story switch) have no extension point today. Expanding the set of frontend hook stages unlocks these scenarios without requiring core code changes.

## What Changes

- Add four new frontend hook stages to the plugin hook system:
  - `chat:send:before` — dispatched before a chat message is sent to the backend; handlers can return a modified message string to replace the outgoing text. Dispatched in `useChatApi.sendMessage()` and `useChatApi.resendMessage()` before the WebSocket `chat:send`/`chat:resend` or HTTP POST is issued.
  - `chapter:render:after` — dispatched after `renderChapter()` in `useMarkdownRenderer.ts` completes markdown parsing and DOMPurify sanitization, for every rendered chapter (not only the last). Handlers receive the produced `RenderToken[]` and can mutate it in place to add annotations, highlights, or additional tokens.
  - `story:switch` — dispatched when the active story changes in `useChapterNav.loadFromBackend()` and `loadFromFSA()`. Handlers receive `{ previousSeries, previousStory, series, story, mode }` so they can reset or initialise per-story plugin state.
  - `chapter:change` — dispatched whenever `currentIndex` changes in `useChapterNav.ts` (including `navigateTo()`, `next()`, `previous()`, `loadFSAChapter()`, `reloadToLast()`, and external route changes). Handlers receive `{ previousIndex, index, chapter, series, story, mode }`.
- Extend the `HookStage` union and `ContextMap` in `reader-src/src/types/index.ts` and `reader-src/src/lib/plugin-hooks.ts` to include the new stages, and add matching context interfaces (`ChatSendBeforeContext`, `ChapterRenderAfterContext`, `StorySwitchContext`, `ChapterChangeContext`).
- Update the dispatcher so `chat:send:before` uses a pipeline-style return value: each handler may return a string to replace `context.message`, while other informational stages keep the existing void-return behaviour.
- Update `VALID_STAGES` in `plugin-hooks.ts` to include the four new stages.
- Wire up dispatch calls in `useChatApi.ts`, `useMarkdownRenderer.ts` / `ChapterContent.vue`, and `useChapterNav.ts` at the locations noted above.
- Update plugin authoring documentation and the `heartreverie-create-plugin` skill examples to describe the new stages (documentation-only follow-up; no plugin code in this change).

No backward-compatibility shims are required — the project has zero external users and the existing `frontend-render`/`notification` stages remain unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `plugin-hooks`: adds four new frontend hook stages (`chat:send:before`, `chapter:render:after`, `story:switch`, `chapter:change`) to the existing "Hook stages" requirement, including their dispatch points, context shapes, and — for `chat:send:before` — a return-value contract allowing handlers to transform the outgoing message.

## Impact

- **Affected code (frontend):**
  - `reader-src/src/lib/plugin-hooks.ts` — extend `ContextMap`, `VALID_STAGES`, and add return-value handling for `chat:send:before` in `dispatch()`.
  - `reader-src/src/types/index.ts` — extend `HookStage` union and add `ChatSendBeforeContext`, `ChapterRenderAfterContext`, `StorySwitchContext`, `ChapterChangeContext` interfaces.
  - `reader-src/src/composables/useChatApi.ts` — dispatch `chat:send:before` in `sendMessage()` and `resendMessage()` before both WebSocket and HTTP paths.
  - `reader-src/src/composables/useChapterNav.ts` — dispatch `story:switch` in `loadFromBackend()` / `loadFromFSA()` and `chapter:change` in `navigateTo()`, `loadFSAChapter()`, `reloadToLast()`, and the route-watcher branches inside `initRouteSync()`.
  - `reader-src/src/composables/useMarkdownRenderer.ts` — dispatch `chapter:render:after` at the end of `renderChapter()` with the produced tokens.
- **Affected docs / skills:** plugin authoring docs (`docs/plugin-system.md`) and the `heartreverie-create-plugin` skill examples (follow-up documentation updates).
- **No backend changes.** Backend hook stages in `writer/lib/hooks.ts` are untouched.
- **No breaking changes for existing plugins:** `frontend-render` and `notification` semantics are unchanged; `thinking`, `imgthink`, `user-message`, `start-hints`, `context-compaction` plugins continue to work.
- **Tests:** add frontend unit tests for the new stages (dispatch order, `chat:send:before` return-value semantics, error isolation) under `reader-src/src/**/*.test.ts` per the existing Vitest layout.
