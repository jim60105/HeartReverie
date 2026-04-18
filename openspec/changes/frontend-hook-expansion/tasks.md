## 1. Type and dispatcher extensions

- [x] 1.1 Extend `HookStage` union in `reader-src/src/types/index.ts` to include `"chat:send:before" | "chapter:render:after" | "story:switch" | "chapter:change"`.
- [x] 1.2 Add four new context interfaces in `reader-src/src/types/index.ts`: `ChatSendBeforeContext`, `ChapterRenderAfterContext`, `StorySwitchContext`, `ChapterChangeContext` with the field shapes specified in `specs/plugin-hooks/spec.md`.
- [x] 1.3 Export a widened handler type for `chat:send:before` allowing `(ctx) => string | void` (e.g., `ChatSendBeforeHandler`); keep `HookHandler<T>` returning `void` for other stages.
- [x] 1.4 Update `ContextMap` in `reader-src/src/lib/plugin-hooks.ts` to map each new stage name to its context interface.
- [x] 1.5 Add the four new stage names to the `VALID_STAGES` set in `reader-src/src/lib/plugin-hooks.ts`.
- [x] 1.6 Update `FrontendHookDispatcher.dispatch()` so that when `stage === "chat:send:before"` and a handler returns a `string`, the value is assigned to `context.message` before the next handler runs. Non-string return values are ignored. Other stages keep the existing void-return behaviour.
- [x] 1.7 Verify error isolation in `dispatch()` continues to swallow handler throws and proceed to the next handler with the (possibly mutated) context.

## 2. Wire `chat:send:before` into `useChatApi`

- [x] 2.1 In `reader-src/src/composables/useChatApi.ts`, at the top of `sendMessage(series, story, message)`, build a `ChatSendBeforeContext` with `{ message, series, story, mode: "send" }` and dispatch `frontendHooks.dispatch("chat:send:before", ctx)`. Use the resulting `ctx.message` for both the WebSocket `chat:send` payload and the HTTP fallback POST body.
- [x] 2.2 In `resendMessage(series, story, message)`, repeat the same dispatch with `mode: "resend"`. Use the resulting `ctx.message` for the WebSocket `chat:resend` and the HTTP POST body.
- [x] 2.3 Ensure the dispatch happens BEFORE `currentRequestId` assignment and BEFORE any network call, so a throwing handler still leaves `isLoading`/`streamingContent` reset (or set up a try/catch around dispatch as appropriate; default behaviour is that the dispatcher catches throws internally).

## 3. Wire `chapter:render:after` into `useMarkdownRenderer`

- [x] 3.1 In `reader-src/src/composables/useMarkdownRenderer.ts`, after the final `tokens` array is fully populated and immediately before `return tokens` in `renderChapter()`, build a `ChapterRenderAfterContext` with `{ tokens, rawMarkdown, options }` and call `frontendHooks.dispatch("chapter:render:after", ctx)`.
- [x] 3.2 Confirm that `tokens` is passed by reference and any mutations performed by handlers are reflected in the value returned to the caller.
- [x] 3.3 Implement re-sanitization of handler output: before dispatching the hook, snapshot each HTML-bearing token's identity and `.content` (e.g., by length + reference + shallow content comparison, or by capturing the original array + content values). After dispatch, detect tokens that were added or whose `.content` changed, and re-run DOMPurify on those tokens using the same configuration as the primary sanitization pass. Unmutated tokens bypass re-sanitization.
- [x] 3.4 Add a code comment at the re-sanitization site documenting that this is a security-critical step closing the XSS gap introduced by allowing plugins to mutate post-sanitization tokens. Reference the `chapter:render:after` spec requirement.

## 4. Wire `story:switch` and `chapter:change` into `useChapterNav`

- [x] 4.1 Track previous-state values in `useChapterNav.ts` module scope (`previousSeries`, `previousStory`) so they can be passed in `StorySwitchContext`.
- [x] 4.2 In `loadFromBackend(series, story, startChapter?)`: after `currentSeries`/`currentStory`/`mode` are committed but BEFORE the first content render, dispatch `story:switch` only if the new `(series, story)` differs from `(previousSeries, previousStory)`. Skip dispatch on `reloadToLast()`.
- [x] 4.3 In `loadFromFSA(handle)`: after `mode = "fsa"` and `currentSeries = currentStory = null` are committed, dispatch `story:switch` with the prior backend values as `previousSeries`/`previousStory` and `series: null, story: null, mode: "fsa"`.
- [x] 4.4 Centralise `chapter:change` dispatch in a helper `dispatchChapterChange(previousIndex, index)` that builds the `ChapterChangeContext` from current module state and calls `frontendHooks.dispatch("chapter:change", ctx)`. Skip dispatch when `previousIndex === index`.
- [x] 4.5 Call `dispatchChapterChange()` from: `navigateTo()` (after `currentIndex` assignment), `loadFSAChapter()` (after `currentIndex` assignment), `reloadToLast()` (after `currentIndex` assignment), the chapter-param branch of the route watcher in `initRouteSync()`, and once during `loadFromBackend()` / `loadFromFSA()` initial load AFTER `story:switch` has fired (using `previousIndex: null`).
- [x] 4.6 Audit existing dispatch sites to ensure no duplicate `chapter:change` fires (e.g., the route watcher and `navigateTo()` running on the same transition) — pick the canonical site per code path.

## 5. Tests

- [x] 5.1 Add a Vitest test file for `FrontendHookDispatcher` covering: registration of new stages without warnings, priority ordering, `chat:send:before` string-return replacement of `context.message`, `chat:send:before` non-string return ignored, error isolation when a `chat:send:before` handler throws.
- [x] 5.2 Add a Vitest test for `useChatApi.sendMessage()` mocking `frontendHooks.dispatch` and verifying that the dispatched `context.message` (when returned by a handler) is the value sent on the WebSocket `chat:send` payload AND on the HTTP fallback POST body.
- [x] 5.3 Add a Vitest test for `useMarkdownRenderer.renderChapter()` verifying `chapter:render:after` is dispatched once per call with the final tokens, that benign handler mutations are visible in the returned array, AND that a handler mutating a token to include `<script>alert(1)</script>`, inline `onclick=` handlers, or `javascript:` URLs results in those constructs being stripped by re-sanitization before `renderChapter()` returns.
- [x] 5.4 Add a Vitest test for `useChapterNav` verifying: `story:switch` fires with correct `previous*` values on a backend → backend transition, does NOT fire on `reloadToLast()`, and `chapter:change` fires once on initial load with `previousIndex: null` and again on `next()` with the right `previousIndex`/`index`.

## 6. Documentation

- [x] 6.1 Update `docs/plugin-system.md` to document the four new frontend hook stages, their context shapes, dispatch points, and the `chat:send:before` return-value contract.
- [x] 6.2 Update the `heartreverie-create-plugin` skill (in `skills/`) to mention the new stages in its examples and templates.
- [x] 6.3 Update `AGENTS.md` "Plugin System" section to list the new frontend hook stages alongside the backend stages.

## 7. Validation

- [x] 7.1 Run `deno task test:frontend` and ensure all new tests pass.
- [x] 7.2 Run `deno task test:backend` to confirm no backend regressions (sanity check; backend hooks unchanged).
- [x] 7.3 Run `deno task build:reader` to confirm the frontend builds cleanly under TypeScript strict mode.
- [ ] 7.4 Manual smoke test: load a story in the reader, navigate between chapters, send a chat message, and confirm no `console.warn` "Invalid frontend hook stage" appears and existing plugins (`thinking`, `imgthink`, `user-message`) still render correctly.
- [x] 7.5 Run `openspec validate frontend-hook-expansion --strict` and confirm the change passes structural validation.
