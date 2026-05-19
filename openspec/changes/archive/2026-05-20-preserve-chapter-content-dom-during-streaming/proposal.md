## Why

During LLM streaming, every chunk that arrives (via WebSocket `chapters:content` push or polling fallback) calls `commitContent()` in `useChapterNav`, which unconditionally increments `renderEpoch`. `ChapterContent.vue` uses `:key="\`${idx}-${renderEpoch}\`"` on its v-for of rendered tokens, so each `<div v-html="token.content">` is fully unmounted and remounted on every chunk. The result: the document height collapses for one frame per chunk, the browser loses anchor for the reader's scroll position, and the viewport snaps back to the top of the chapter many times per second. Reading a streamed chapter is currently unusable — the user cannot keep their eyes on the streaming text.

The remount-on-every-epoch contract was originally added (see archived change `2026-04-30-fix-frontend-render-on-edit-and-reload`) for a different scenario: the cancel-edit path where rendered tokens are byte-identical to the previous render, but `.plugin-sidebar` children were externally moved out of the v-html div by `ContentArea`'s relocation watch. In that case Vue's `v-html` skips the patch (string unchanged), so the externally-removed nodes never reappear unless we force a remount. Conflating "streaming commit" with "force-remount for external-DOM recovery" in a single epoch counter is the bug.

## What Changes

- Split the single `renderEpoch` signal in `useChapterNav` into two ortho­gonal signals:
  - `renderEpoch` — keeps its current role as a *notification* counter that increments on every `commitContent()` and on every `notifyRenderInvalidated()` / `forceTokenRemount()` call. Downstream watches (`ContentArea` sidebar relocation, `ChapterContent` `chapter:dom:ready` dispatch) keep tracking it.
  - `remountToken` (new) — a separate counter that increments **only** when callers explicitly request a force-remount of the rendered token list. It is **not** incremented by `commitContent()` and **not** incremented by `notifyRenderInvalidated()`.
- Replace the single existing helper `bumpRenderEpoch()` with two narrower, semantically named helpers:
  - `notifyRenderInvalidated(): void` — increments `renderEpoch` only. Used by callers that need downstream watchers to re-run but have NOT externally mutated the rendered DOM (e.g. `usePlugins.ts` settings-change handler — the markdown tokens may not have changed string content, but plugins want a fresh `chapter:dom:ready` dispatch).
  - `forceTokenRemount(): void` — increments BOTH `remountToken` and `renderEpoch`. Used by callers that have externally mutated the rendered DOM and need a true remount of the v-for entries to recover (e.g. `ChapterContent.vue#cancelEditAction`, after the relocation watch has moved `.plugin-sidebar` children out of the v-html div).
- Change `ChapterContent.vue`'s v-for key from `${idx}-${renderEpoch}` to `${idx}-${remountToken}`. As a result, byte-identical streaming chunks (and identical-content commits in general) reuse the existing v-html root element and Vue patches `innerHTML` in place; the document height stays stable and the browser preserves the scroll anchor.
- Update the cancel-edit handler in `ChapterContent.vue` to call `forceTokenRemount()` instead of `bumpRenderEpoch()`. (Note: with cancel-edit the v-if-gated template flips from textarea to tokens, which on its own recreates the rendered subtree — `forceTokenRemount()` is needed primarily so the `renderEpoch` bump re-fires `ContentArea`'s sidebar relocation watch; the `remountToken` bump is belt-and-suspenders for any future cancel path that doesn't already remount via v-if.)
- Update the `usePlugins.ts` settings-change handler to call `notifyRenderInvalidated()` instead of `bumpRenderEpoch()`. This is the correct semantic: a settings change does not require a full v-html DOM remount; it only needs downstream watchers (`chapter:dom:ready`, sidebar relocation) to re-run so plugins can rewalk and re-apply.
- Update `ChapterContent.test.ts`:
  - Replace the existing assertion "WHEN renderEpoch bumps with byte-identical tokens THEN v-html div remounts" with a regression test that the opposite holds: a `renderEpoch`-only bump (without `remountToken` change) does **not** remount the v-html nodes.
  - Add a positive regression test: when streaming-style `commitContent` mutates `currentContent` and bumps `renderEpoch`, an imperative marker (`data-test-marker`) placed on the **rendered v-html root element** (the `<div v-html="token.content">` wrapper element, NOT its parsed children — Vue's `innerHTML` patch will still replace descendants when the bound string changes) survives subsequent streaming commits, proving the element instance is reused.
  - Add a chapter-navigation regression test: when `currentContent` changes to a different chapter's content (different `tokens` length / strings) but `remountToken` is unchanged, the v-html root element instance at index 0 is still reused (Vue patches `innerHTML`); plugins receive a `chapter:dom:ready` dispatch via the renderEpoch bump.
  - Keep / extend the cancel-edit test to verify the new `forceTokenRemount()` is called.
  - Add a plugin-settings test: when `usePlugins.ts` calls `notifyRenderInvalidated()`, only `renderEpoch` increments and `remountToken` stays unchanged.
- Update the modified spec `vue-component-architecture` requirement that mandates "v-html token list keys on renderEpoch": replace it with one that mandates keying on the new `remountToken` and explicitly forbids streaming commits from forcing remount.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `vue-component-architecture`: Replace the existing "ChapterContent v-html token list keys on renderEpoch" requirement with a new one that keys on a dedicated `remountToken` and requires that streaming `commitContent()` calls do NOT remount rendered token DOM. Add an explicit non-regression requirement that the chapter scroll position is preserved across streaming commits.
- `chapter-navigation`: Update the `useChapterNav` exported surface to include both `renderEpoch` (existing) and `remountToken` (new), and replace `bumpRenderEpoch()` with `forceTokenRemount()` in the documented return interface. Clarify that `commitContent()` increments `renderEpoch` only.

## Impact

- **Frontend code**:
  - `reader-src/src/composables/useChapterNav.ts` — add `remountToken` ref; remove the existing `bumpRenderEpoch` export; add two new exported helpers `notifyRenderInvalidated()` (renderEpoch only) and `forceTokenRemount()` (both counters); leave `commitContent` untouched (already bumps renderEpoch only).
  - `reader-src/src/composables/usePlugins.ts` — replace the `bumpRenderEpoch()` call in `subscribeSettingsChanged` with `notifyRenderInvalidated()`. The dynamic-import pattern around it stays; only the destructured name changes.
  - `reader-src/src/components/ChapterContent.vue` — change v-for `:key` to use `remountToken`; update destructured names; update `cancelEditAction` to call `forceTokenRemount()`. The `[tokens, renderEpoch, isEditing]` watch driving `dispatchDomReady` is unchanged (it still needs to fire on every commit).
  - `reader-src/src/components/ContentArea.vue` — no functional change. Its sidebar-relocation watch already tracks `renderEpoch` and continues to fire on every commit; the panels it expects to find are now stable across commits because the v-html DOM is no longer remounted.
  - `reader-src/src/types/index.ts` — update the `UseChapterNavReturn` (or equivalent) interface: remove `bumpRenderEpoch`; add `remountToken: Ref<number>`, `notifyRenderInvalidated: () => void`, `forceTokenRemount: () => void`.
- **Tests**:
  - `reader-src/src/components/__tests__/ChapterContent.test.ts` — invert the byte-identical-remount assertion; add streaming-preserves-DOM assertion (on the v-html ROOT element); add navigation-preserves-root assertion; rename `bumpRenderEpoch` references to `forceTokenRemount`. The mock setup at the top of the file needs `remountTokenRef` as a real `ref(0)` and `forceTokenRemount` / `notifyRenderInvalidated` as spies bumping the right refs.
  - Mock sweep across the suite: every file that mocks `useChapterNav` SHALL expose `remountToken`, `forceTokenRemount`, and `notifyRenderInvalidated` (drop `bumpRenderEpoch`). Known mock sites to update: `ChapterContent.test.ts`, `ContentArea.test.ts`, `ChatInput.test.ts`, `ChatInput.continue.test.ts`, `Sidebar.test.ts`, `MainLayout.test.ts`, `HookInspectorPage.test.ts`, `usePluginActions.test.ts`, and any `PromptEditor*.test.ts` that touches navigation. The tasks file mandates an `rg "useChapterNav|bumpRenderEpoch"` sweep across `reader-src/` AND `plugins/` to catch stragglers.
- **OpenSpec deltas**:
  - `openspec/changes/preserve-chapter-content-dom-during-streaming/specs/vue-component-architecture/spec.md` — delta replacing the v-html key requirement and adding the scroll-preservation requirement.
  - `openspec/changes/preserve-chapter-content-dom-during-streaming/specs/chapter-navigation/spec.md` — delta documenting the split signals and renamed function.
- **No backend changes.** The fix is entirely in the reader SPA. WebSocket / polling code paths are untouched.
- **No new dependencies.**
- **No backward compatibility considerations** per repo policy (project is unreleased; zero external users). The rename of `bumpRenderEpoch` → `forceTokenRemount` is breaking only for internal callers, all of which are updated in this change.
