## 1. Composable refactor (`useChapterNav.ts`)

- [x] 1.1 Add a new `const remountToken = ref(0)` module-level ref next to `renderEpoch` in `reader-src/src/composables/useChapterNav.ts`. Document its purpose in a JSDoc comment that contrasts it with `renderEpoch` (notification vs force-remount).
- [x] 1.2 Remove the existing `bumpRenderEpoch()` function. Replace with TWO new exported helpers:
  - `notifyRenderInvalidated(): void` — increments `renderEpoch` only.
  - `forceTokenRemount(): void` — increments `remountToken` first, then `renderEpoch`, in a single synchronous call.
  Both helpers get JSDoc comments explaining intent, examples of legitimate call sites, and an explicit "do not add new call sites without documenting why" note for `forceTokenRemount`.
- [x] 1.3 Confirm `commitContent()` still increments `renderEpoch` only — explicitly NOT touching `remountToken`. Add an inline comment stating "remountToken intentionally not bumped here: streaming commits must not cause v-for remount" to lock the contract.
- [x] 1.4 Expose `remountToken`, `notifyRenderInvalidated`, and `forceTokenRemount` from the `useChapterNav()` return object. Remove the `bumpRenderEpoch` export entry. Keep `renderEpoch` exported.
- [x] 1.5 Update the exported `UseChapterNavReturn` type (or whatever return-type interface lives in `reader-src/src/types/index.ts` or the composable file itself) to include `remountToken: Ref<number>`, `notifyRenderInvalidated: () => void`, `forceTokenRemount: () => void`; remove `bumpRenderEpoch`.

## 2. ChapterContent component update

- [x] 2.1 In `reader-src/src/components/ChapterContent.vue`, destructure `remountToken` and `forceTokenRemount` from `useChapterNav()`. Remove `bumpRenderEpoch` from the destructure list.
- [x] 2.2 Change the v-for key in the template from `:key="\`${idx}-${renderEpoch}\`"` to `:key="\`${idx}-${remountToken}\`"`.
- [x] 2.3 Update `cancelEditAction()` to call `forceTokenRemount()` instead of `bumpRenderEpoch()`. Update the existing block comment to explain that (a) the v-if flip already recreates the rendered subtree on its own, so (b) the load-bearing effect of this call is the `renderEpoch` bump that re-fires `ContentArea`'s sidebar relocation watch; (c) the `remountToken` half is defensive insurance against future template refactors.
- [x] 2.4 Verify the `[tokens, renderEpoch, isEditing]` watch driving `dispatchDomReady` continues to use `renderEpoch` (not `remountToken`). No change expected here; this is a verification step.

## 3. usePlugins.ts update

- [x] 3.1 In `reader-src/src/composables/usePlugins.ts#subscribeSettingsChanged`, change the dynamic-import destructure from `{ bumpRenderEpoch }` to `{ notifyRenderInvalidated }` and call `notifyRenderInvalidated()` in place of `bumpRenderEpoch()`. Update the surrounding comment to explain that a settings change is a notification-only event (no externally-mutated rendered DOM to recover from), so we must NOT trigger a v-html remount.

## 4. Sweep callers of removed/renamed surface

- [x] 4.1 grep the entire repo for `bumpRenderEpoch` (across `reader-src/` AND `plugins/`) and replace every remaining occurrence with the appropriate narrower helper (`notifyRenderInvalidated` for notification-only intents, `forceTokenRemount` for force-remount intents — audit each call site individually). Mock objects in `__tests__/` files MUST also be updated.
- [x] 4.2 grep for `\\$\\{renderEpoch\\}` (template-literal interpolation) inside `.vue` files to verify no other v-for key uses `renderEpoch`. If any other component does, surface and fix it under this task (it would be an unintended consumer of the old contract).
- [x] 4.3 Ensure every test mock of `useChapterNav` exposes `remountToken` as a real `ref(0)`, `notifyRenderInvalidated` as a function that increments `renderEpoch` only, and `forceTokenRemount` as a function that increments both refs. Files known to mock the composable include but are not limited to: `ChapterContent.test.ts`, `ContentArea.test.ts`, `ChatInput.test.ts`, `ChatInput.continue.test.ts`, `Sidebar.test.ts`, `MainLayout.test.ts`, `HookInspectorPage.test.ts`, `usePluginActions.test.ts`, and any `PromptEditor*.test.ts` that touches navigation. Run `rg "useChapterNav" reader-src/src/**/__tests__` and review every match.

## 5. Tests — invert and extend ChapterContent.test.ts

- [x] 5.1 Remove or rewrite the existing test `WHEN renderEpoch bumps with byte-identical tokens THEN v-html div remounts` so that bumping `renderEpoch` alone (without `remountToken`) does NOT remount the v-html div. Assert by capturing the DOM element reference before the bump and asserting it is the SAME reference after `await nextTick()`.
- [x] 5.2 Add a new test: `WHEN forceTokenRemount is called THEN v-html div remounts even with byte-identical tokens`. Assert by capturing the DOM element reference before the call and asserting the reference has CHANGED after `await nextTick()`.
- [x] 5.3 Add a new test: `WHEN commitContent fires repeatedly during streaming THEN imperative DOM markers on the v-html ROOT element survive`. Set up: mount component, place an imperative marker (e.g. `rootEl.setAttribute('data-test-marker', 'kept')`) on the rendered v-html ROOT div (the wrapper, NOT inside the parsed innerHTML), then bump `currentContent` to a longer string and bump `renderEpoch` (simulate streaming chunk arrival), `await nextTick()`, assert the marker is still present on the same element reference. The test should explicitly comment that descendants inside the v-html string are NOT expected to survive — only the root element is guaranteed stable.
- [x] 5.4 Add a new test: `WHEN chapter content changes to a different chapter THEN the v-html root element instance is still reused but descendants are re-parsed`. Mount with content A, capture rootEl, commit content B (different string), await nextTick, assert rootEl is the same reference but `rootEl.innerHTML` reflects content B.
- [x] 5.5 Update the cancel-edit test to assert `forceTokenRemount` is called instead of `bumpRenderEpoch`.
- [x] 5.6 Update the test setup at the top of `ChapterContent.test.ts` (the `mockState` object plus the `vi.mock(...)` factory) to expose `remountTokenRef` as a real `ref(0)`, `forceTokenRemount` as a spy that bumps both refs, and `notifyRenderInvalidated` as a spy that bumps `renderEpoch` only.

## 6. usePlugins / settings-change test

- [x] 6.1 Add or extend a usePlugins test that asserts: when `plugin-settings:changed` fires for a plugin with rendering contribution, after the 50ms debounce, `notifyRenderInvalidated()` is invoked on the `useChapterNav` mock and `forceTokenRemount` is NOT invoked. If a dedicated usePlugins test file does not exist, add the assertion to the closest existing integration test.

## 7. Mock updates in adjacent test files

- [x] 7.1 In every file identified by task 4.3, add `remountToken: ref(0)`, `notifyRenderInvalidated: vi.fn()`, and `forceTokenRemount: vi.fn()` (or equivalent) to the mock return value. Remove any `bumpRenderEpoch` keys.

## 8. Run automated checks

- [x] 8.1 Run frontend type-check: `cd HeartReverie/reader-src && npm run type-check` (or whatever the package.json declares). Resolve any type errors introduced by the rename.
- [x] 8.2 Run frontend lint: same directory, `npm run lint`. Resolve all lint errors.
- [x] 8.3 Run frontend unit tests: `npm run test`. All tests must pass, including the new and inverted ChapterContent tests.
- [x] 8.4 Build the SPA: `npm run build`. Confirm clean build with no warnings related to the modified files.

## 9. Integration verification in container (Mandatory)

- [x] 9.1 Build & run container: `scripts/podman-build-run.sh` from the `HeartReverie/` directory. Wait for "listening on" log line.
- [x] 9.2 Tail logs and confirm clean startup: `podman logs heartreverie 2>&1 | grep -i "error\|warn"` returns no relevant matches.
- [x] 9.3 Verified via `agent-browser` against `test/test/chapter/11`: scrolled to bottom (scrollTop=5555), tagged the v-html root with `data-test-marker`, simulated a streaming push via PUT `/api/stories/test/test/chapters/11`. Result: `sameNode: true`, `markerSurvived: "survives-streaming"`, scrollTop became 5552 (3 px reflow shift — no snap to top). Repeated a second time on a freshly-loaded route post-settings-change with `data-marker-3`: `sameRoot: true`, marker preserved, `childCount` went 94→95, content updated. Tested with reading-progress in its default loaded state.
- [x] 9.4 Clicked 編輯 then 取消 on chapter 11. Pre-edit `chapter-content` had 2 children; post-cancel still 2 children — no plugin-panel duplication.
- [x] 9.5 Toggled dialogue-colorize `enabled` off → save → settings:changed broadcast → returned to reader. Browser-level remount happened because navigating settings ↔ reader necessarily re-mounts the route; the unit-test guarantee in `usePlugins.test.ts` covers the in-place case (settings change does NOT call `forceTokenRemount`).
- [x] 9.6 Edit-save flow exercised via PUT (equivalent to save button): chapter re-rendered, descendants re-parsed inside the same root, no scroll snap.

## 10. Spec finalisation

- [x] 10.1 Run `openspec validate preserve-chapter-content-dom-during-streaming --strict`. Must report `Change ... is valid`.
- [x] 10.2 Self-review the proposal / design / specs / tasks for consistency, fixing any drift from this task list.
- [ ] 10.3 When the user invokes archive, run the archive flow (`openspec archive ...`) which will merge the deltas into `openspec/specs/`.
