# Proposal — fix-chat-input-visibility-on-transitions

## Why

The reader frontend ships a `ChatInput.vue` component that is rendered in `MainLayout.vue` behind the gate `showChatInput = ctx.isBackendMode && (isLastChapter.value || chapters.value.length === 0)`. The component is the only writer-mode entry point for sending new turns to the LLM, so its visibility is functionally important.

On a **fresh page load (F5)** the gate evaluates correctly because `App.vue.handleUnlocked` calls `loadFromBackend(series, story, startChapter)` with the chapter number parsed from the URL. By the time MainLayout renders for the first time, `chapters` and `currentIndex` are both consistent and `showChatInput` resolves to its correct value.

On **in-app transitions** the gate gets out of sync with the user's intent, and the chat input stays hidden until the user presses F5. Two reproducible scenarios:

1. **Single-chapter story selected via the top story-selector.** Starting from `/` (no story loaded), selecting `櫻帝學園/商店街散步` (one chapter) loads the story and lands on chapter 1. Chapter 1 is also the last chapter, so the chat input SHALL appear. It does not. F5 fixes it.
2. **Header navigation to the last chapter.** Starting from chapter 1 of `櫻帝學園/日常` (five chapters), pressing the `goToLast` (`⇉`) header button updates the URL to `/.../chapter/5` and the rendered chapter content, but the chat input remains hidden. F5 fixes it.

The static analysis points at two distinct reactivity defects in `reader-src/src/composables/useChapterNav.ts` (the third item, route-shape, is a contributing asymmetry, not an independent defect):

- **Non-reactive backend-context state.** `currentSeries` and `currentStory` are plain module-scope `let` bindings (lines 48–49). `getBackendContext()` reads them and is called from inside the `showChatInput` computed. Vue does not track reads of plain `let` bindings, so any state transition that flips `isBackendMode` (most importantly the no-story → story transition) does not trigger the computed to re-run. Once the computed has short-circuited on `isBackendMode === false`, it never subscribes to `isLastChapter` / `chapters`, so subsequent changes to those refs cannot wake it up — this is the primary cause of repro A (single-chapter story selected via the story-selector when `MainLayout` was mounted before backend mode).
- **Two-step update window inside `loadFromBackend` (and sibling `loadFromBackendInternal` callers).** `chapters.value` is assigned inside the awaited `loadFromBackendInternal` at line ~302–324, then `dispatchStorySwitch` is dispatched synchronously to all plugin hooks at line ~336, and only afterwards `currentIndex.value` is set to the resolved start index at line ~342. During the awaited microtask boundary and the synchronous plugin-hook dispatch, `isLastChapter` (the computed `chapters.length > 0 && currentIndex === chapters.length - 1`) can transiently evaluate to `false` against a stale `currentIndex` from the previous story. The same shape recurs in `reloadToLast` (~360), `refreshAfterEdit` (~390), and the `chapters:updated` WebSocket handler (~492).
- **Contributing asymmetry (not an independent defect): story-selector drops the chapter param.** `navigateToStory(series, story)` (`useStorySelector.ts:35`) pushes the route as `{ name: "story", params: { series, story } }`, with no chapter param. The route watcher then calls `loadFromBackend(s, st, undefined)`, which defaults `startIdx` to `0`. The F5 path goes through `App.vue.handleUnlocked` which honors a chapter param; the in-app path does not. This asymmetry is not itself a bug — it just funnels the in-app path through `loadFromBackend`, where the atomicity defect bites. Fixing defects 1 and 2 also fixes this path without changing the selector.

Repro B (header `goToLast` on a multi-chapter story) has two possible sub-paths. **B1 (most likely):** `MainLayout.vue` mounted while no backend story was loaded, so `showChatInput` first evaluated with `isBackendMode === false`, short-circuited before reading `isLastChapter` / `chapters`, and never subscribed; the subsequent `loadFromBackend` and `goToLast` then change unsubscribed refs and produce no re-render. Defect 1 covers this. **B2:** the user deeplinks directly into chapter 1, so `showChatInput` is fully subscribed from first paint; then `goToLast` writes `currentIndex.value` synchronously. Defect 1 does not by itself explain B2, but the path through `dispatchChapterChange` plugin hooks can interleave with rendering, and defect 2 (atomicity at every load-back path) closes that window. Both fixes together cover both sub-paths.

The user-visible contract — “the chat input is visible whenever the reader is positioned on the last chapter (or any chapter of a single-chapter story) of a backend-loaded story” — must hold equally for the F5 path and every in-app transition path. The current spec for `chat-input` does not encode the “last chapter only” gate at all, nor does it require transition reactivity; it only forbids rendering when no story is loaded. That spec gap is part of why the bug was shipped.

The user-visible contract — “the chat input is visible whenever the reader is positioned on the last chapter (or any chapter of a single-chapter story) of a backend-loaded story” — must hold equally for the F5 path and every in-app transition path. The current spec for `chat-input` does not encode the “last chapter only” gate at all, nor does it require transition reactivity; it only forbids rendering when no story is loaded. That spec gap is part of why the bug was shipped.

## What Changes

- **`chat-input` capability (MODIFIED Requirement).** Extend `Requirement: Input UI` so it explicitly defines the visibility contract: chat input is shown iff a story is loaded AND (the reader is on the last chapter OR the story has zero rendered chapters as a fallback). Add scenarios that pin transition reactivity:
  - Single-chapter story opened via the story-selector → chat input visible without a page refresh.
  - Multi-chapter story; user navigates to the last chapter via the header button → chat input visible without a page refresh.
  - User navigates away from the last chapter → chat input is hidden without a page refresh.
- **`chapter-navigation` capability (MODIFIED Requirement).** Extend `Requirement: Current chapter state tracking` so it states that backend-mode flags (`series`, `story`, `isBackendMode`) are reactive Vue state participating in dependency tracking, and that `chapters.length` and `currentIndex` are updated together (no transient inconsistent state observable across plugin-hook dispatch or microtask boundaries).
- **Implementation fixes in `reader-src/src/composables/useChapterNav.ts`:**
  - Convert `currentSeries` / `currentStory` from `let` module bindings to `ref<string | null>(null)` so any reactive consumer (including the chat-input visibility computed) tracks them.
  - In `loadFromBackend`, compute `startIdx` from the loaded `chapters` array and assign `currentIndex.value` synchronously together with the `chapters.value` assignment, before dispatching `dispatchStorySwitch` or `dispatchChapterChange`. The intermediate state in which `chapters.length` and `currentIndex` disagree must not be observable by any plugin hook or render.
  - Make `getBackendContext()` derive `isBackendMode` from the new refs (computed equivalent is acceptable as long as reactive consumers re-run on changes).
- **Implementation fix in `reader-src/src/composables/useStorySelector.ts`:** when the user picks a new story from the top selector, `navigateToStory` MUST preserve the user's apparent intent. The simplest correct behavior is to route directly to `{ name: "story", params: { series, story } }` (the existing behavior) but rely on the watcher in `useChapterNav.initRouteSync` to consult the loaded chapter list and land the user on chapter 1. The bug is not the dropped chapter param per se but the failure to update `currentIndex` consistently. The route-only round-trip is acceptable provided the visibility contract above holds.
- **Implementation fix in `MainLayout.vue`:** the `showChatInput` computed remains as today (it correctly composes the user-visible contract). No template change required after the upstream refs become reactive.
- **No backward compatibility / migration.** The project has 0 users in the wild; existing stored stories continue to load. Plugin hooks already receive series/story/chapter via arguments, not by reading module-internal state, so converting two `let` bindings to refs is internal-only.

## Impact

- Specs:
  - `chat-input` (MODIFIED: `Requirement: Input UI` — new scenarios for last-chapter transition reactivity)
  - `chapter-navigation` (MODIFIED: `Requirement: Current chapter state tracking` — explicit reactivity guarantee for `series` / `story` / `isBackendMode` and atomic update of `chapters` + `currentIndex`)
- Files:
  - `reader-src/src/composables/useChapterNav.ts` (state refs + atomic update inside `loadFromBackend`)
  - `reader-src/src/components/MainLayout.vue` (no change expected; verify the existing computed still composes correctly)
  - `reader-src/src/composables/useStorySelector.ts` (verify; no logic change required if upstream refs are reactive)
  - `reader-src/src/components/__tests__/MainLayout.test.ts` and `reader-src/src/composables/__tests__/useChapterNav.test.ts` (new tests covering transition reactivity, not just initial mount)
- Risk: low. The change replaces two non-reactive bindings with refs and reorders three statements inside one function. No public composable signature changes. Plugin hook payloads unchanged.
- Verification: in addition to Vitest, an in-container smoke test SHALL exercise both reproductions through the live SPA (selecting a single-chapter story, then header-navigating to the last chapter of a multi-chapter story) and confirm the chat input appears without a page reload.
