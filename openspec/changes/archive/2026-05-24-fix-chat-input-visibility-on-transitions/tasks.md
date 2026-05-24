# Tasks — fix-chat-input-visibility-on-transitions

## 1. Refactor reactive state in `useChapterNav.ts`

- [x] 1.1 Convert module-internal `let currentSeries: string | null = null;` and `let currentStory: string | null = null;` (around lines 48–49) to `const currentSeries = ref<string | null>(null);` and `const currentStory = ref<string | null>(null);`.
- [x] 1.2 Update every read/write site of these two bindings inside the file to use `.value`. Search the file for `currentSeries` and `currentStory` and patch each occurrence (including assignments inside the route watchers, `loadFromBackend`, and `getBackendContext`).
- [x] 1.3 Confirm `getBackendContext()` returns `{ series: currentSeries.value, story: currentStory.value, isBackendMode: currentSeries.value !== null && currentStory.value !== null }` so callers from inside reactive scopes subscribe to the refs.
- [x] 1.4 Re-run `cd HeartReverie/reader-src && pnpm typecheck` (or the project equivalent — `vue-tsc -b`) and fix any callers that referenced the old `let` bindings.
- [x] 1.5 Audit `useChapterNav.ts` and any module that imports `getBackendContext()` for destructuring/caching patterns that store the result in a non-reactive `const` outside a reactive scope (e.g. at module top level, in setup constants, or in event handler closures captured at mount time). Patch any found so each evaluation re-reads the refs.

## 2. Atomic update inside `loadFromBackend` and sibling callers

- [x] 2.1 Refactor `loadFromBackendInternal` (lines ~293–303 in `useChapterNav.ts`) so it returns the loaded `ChapterData[]` instead of writing `chapters.value` itself. Keep the route-sync side effect at the caller boundary, not inside the helper.
- [x] 2.2 In `loadFromBackend`, after the fetch resolves, compute `resolvedStartIdx` from the loaded array, then perform the two writes `currentIndex.value = resolvedStartIdx; chapters.value = loaded;` in the same synchronous block — no `await`, no `nextTick`, no intermediate work — before any `dispatchStorySwitch` / `dispatchChapterChange` call.
- [x] 2.3 Move both plugin-hook dispatches (`dispatchStorySwitch`, `dispatchChapterChange`) to fire only after both refs have been assigned.
- [x] 2.4 Apply the same atomic pattern to the other `loadFromBackendInternal` callers identified at lines ~219, ~360 (`reloadToLast`), ~390 (`refreshAfterEdit`), and ~492 (`chapters:updated` WebSocket handler). Each call site SHALL resolve the new `currentIndex` from the loaded array and assign both refs without an intervening `await`/`nextTick` boundary, and SHALL fire any plugin hooks only after both refs settle.
- [x] 2.5 Audit other call sites that mutate `chapters.value` or `currentIndex.value` (e.g. `clearStory`, the new-story path) and verify they leave the pair in a consistent state for `isLastChapter`.

## 3. Visibility predicate sanity check

- [x] 3.1 Re-read `MainLayout.vue` lines 22–25 and confirm `showChatInput` correctly subscribes to `currentSeries`, `currentStory`, `isLastChapter`, and `chapters` after refactor 1 lands. Confirm the `isBackendMode &&` short-circuit no longer prevents subscription to downstream refs after backend mode is entered — Vue's effect tracking re-runs the computed when any read ref changes, so this is automatic once the refs are reactive; document the verification.

## 4. Unit tests in `reader-src/src/composables/__tests__/`

- [x] 4.1 Add `useChapterNav.test.ts` (or extend the existing file if present) with a test that calls `loadFromBackend(series, story)` on a freshly-instantiated composable against a mocked backend returning a 1-chapter story, then asserts `isLastChapter.value === true` synchronously after the awaited call.
- [x] 4.2 Add a transition test that first loads a 3-chapter story (landing on chapter 1), then loads a different 1-chapter story; assert `isLastChapter.value === true` after the second call AND register a `watch(isLastChapter, ...)` before the second call to record observed values, asserting no observation is `false` while `chapters.value.length === 1`.
- [x] 4.3 Add a test that loads a 5-chapter story, calls `goToLast()`, and asserts `isLastChapter.value === true` synchronously.
- [x] 4.4 Add a test that loads a 5-chapter story, calls `goToLast()`, then `navigateTo(2)`, and asserts `isLastChapter.value === false` synchronously.

## 5. Component-level tests in `reader-src/src/components/__tests__/`

- [x] 5.1 Extend `MainLayout.test.ts` with a test that wires the real `useChapterNav` (not a mock with synthetic injected refs). Note that the existing test file globally mocks `useChapterNav`; the new test SHALL use a scoped `vi.doUnmock` / `vi.unmock` or a separate test file to opt out of the global mock. Mount `MainLayout` while `useChapterNav` is in its initial empty state (backend mode `false`), then drive a real `loadFromBackend` to a single-chapter story, and assert the `ChatInput` is rendered after the transition completes — this is the regression test for repro A and validates the cold-start subscription path.
- [x] 5.2 Add an analogous test that mounts `MainLayout` before backend mode, drives `loadFromBackend` to a 3-chapter story landing on chapter 1, then calls `goToLast()`, and asserts the `ChatInput` is rendered. This is the regression test for repro B1 (the MainLayout-mounted-before-backend variant).
- [x] 5.3 Add a regression test for repro B2: mount `MainLayout` with the route preset to a deeplink at chapter 1 of a 3-chapter story so backend mode is `true` from first paint, call `goToLast()`, and assert the `ChatInput` is rendered. This guards against the path where atomicity (not subscription) is the failure mode.
- [x] 5.4 Add an atomicity-observation test: register a `watchEffect` (default flush) that records the tuple `[chapters.value.length, currentIndex.value, isLastChapter.value]` on every effect run; drive a story-switch transition; assert no recorded tuple is internally inconsistent (i.e. no tuple has `chapters.length === N_new` together with a `currentIndex` that points outside `[0, N_new - 1]` in a way that makes `isLastChapter` incorrect for the post-load state).
- [x] 5.5 Add a regression test for the `{ syncRoute: false }` direct-load path: mount `MainLayout`, then call `loadFromBackend(series, story, undefined, { syncRoute: false })` directly (simulating a `StorySelector` invocation from a non-reading surface), and assert the `ChatInput` is rendered.

## 6. Verification

- [x] 6.1 `cd HeartReverie/reader-src && pnpm lint && pnpm test` — both green.
- [x] 6.2 `cd HeartReverie && deno task test` (or repository equivalent) — green.
- [x] 6.3 `cd HeartReverie && openspec validate fix-chat-input-visibility-on-transitions --strict` — clean.
- [x] 6.4 `cd HeartReverie && scripts/podman-build-run.sh` — image rebuilds without errors, container starts cleanly (`podman logs heartreverie 2>&1 | grep -i "error\|warn"` is empty for warnings/errors).
- [x] 6.5 In the running container at `http://localhost:8080`, reproduce repro A: select a single-chapter story via the top-left story-selector after viewing a different story; assert the chat input textarea renders without pressing F5. Use `agent-browser` if possible; otherwise drive the SPA via the dev console (router push + composable call) and read the DOM via `agent-browser`.
- [x] 6.6 In the running container, reproduce repro B: open a multi-chapter story, press the header `goToLast` (`⇉`) control; assert the chat input textarea renders without pressing F5.
- [x] 6.7 Bonus inverse check: from the last chapter, navigate to chapter 1 via the header; assert the chat input disappears without F5.

## 7. Final checks

- [x] 7.1 Stage and commit with a clear message referencing this change ID, including the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- [x] 7.2 Confirm the working tree is otherwise clean (no stray edits in `HeartReverie_Plugins/` or `playground/`).
