# Tasks — header-chapter-nav-tweaks

## 1. Backend / composable changes

- [x] 1.1 Add public helpers `goToFirst(): void` and `goToLast(): void` to `useChapterNav` in `reader-src/src/composables/useChapterNav.ts`. Both SHALL be no-ops when `chapters.value.length === 0`. Both SHALL branch on `mode.value`: `"fsa"` calls `loadFSAChapter(target)`, `"backend"` calls `navigateTo(target)`. Export both from the composable's return object.
- [x] 1.2 Confirm `isFirst` and `isLast` computeds already cover the boundary cases the new buttons need. Current `isFirst = currentIndex.value <= 0` and `isLast` are sufficient because the buttons are gated by `v-if="hasChapters"`, so the empty-chapter case never reaches the boundary check. No new computeds expected.

## 2. Frontend — AppHeader changes

- [x] 2.1 Delete the `📂 選擇資料夾` button from `reader-src/src/components/AppHeader.vue` and remove the `handleFolderSelect` function. Keep the `useFileReader` import and `directoryHandle` / `loadFromFSA` references that `handleReload` needs so the FSA reload branch keeps working when a session is entered programmatically; remove only `isSupported` and `openDirectory` if they become unused after the picker button is gone. Run `deno task lint:reader` (or the project's TypeScript compile step) after the edit to confirm no dead-import warnings remain.
- [x] 2.2 Render the `⇇` button immediately before `← 上一章`, inside the same `<template v-if="hasChapters">` block. Bind `:disabled="isFirst"`, `@click="goToFirst"`, `title="第一章"`, and `aria-label="第一章"`. Reuse the `themed-btn header-btn` classes plus the `--icon` modifier so it visually matches the compact reload / settings buttons.
- [x] 2.3 Render the `⇉` button immediately after `下一章 →`, in the same conditional block. Bind `:disabled="isLast"`, `@click="goToLast"`, `title="最後一章"`, and `aria-label="最後一章"`.
- [x] 2.4 Pull `goToFirst` and `goToLast` out of the destructured `useChapterNav()` call.

## 3. Frontend — StorySelector label collapse

- [x] 3.1 Update `reader-src/src/components/StorySelector.vue`'s `<summary>` so the visible label collapses when `selectedStory` is non-empty AND the `<summary>` element itself carries the `aria-label` in collapsed mode (not an inner span). Suggested template:
    ```vue
    <summary
      class="themed-btn selector-toggle"
      :aria-label="selectedStory ? '故事選擇' : null"
    >
      <span aria-hidden="true">📖</span>
      <span v-if="!selectedStory"> 故事選擇</span>
    </summary>
    ```
    `selectedStory` is already exposed by the destructured `useStorySelector()` call in this file. Binding `aria-label` to `null` when expanded leaves the visible text as the accessible name.
- [x] 3.2 Verify no CSS adjustment is needed — both forms are wrapped in the same `themed-btn selector-toggle` element, so the toggle's box keeps a stable width / height. If the collapsed form looks too narrow, add `min-width` only on `.selector-toggle` (not on the inner span).

## 4. Tests

- [x] 4.1 Update `reader-src/src/components/__tests__/AppHeader.test.ts`:
  - Remove any assertion that the folder-picker button or `選擇資料夾` text exists.
  - Add tests covering: (a) `⇇` rendering and `goToFirst` invocation on click, (b) `⇉` rendering and `goToLast` invocation on click, (c) `⇇` disabled when `isFirst` is `true`, (d) `⇉` disabled when `isLast` is `true`, (e) both buttons hidden when `hasChapters` is `false`, (f) tooltips `第一章` / `最後一章` set via `title`, (g) **navigation cluster ordering** — query the rendered cluster's button text in DOM order and assert the sequence `["⇇", "← 上一章", "下一章 →", "⇉"]` (the progress indicator sits between previous and next in the same parent), (h) single-chapter story (`totalChapters === 1`, `currentIndex === 0`): both `⇇` and `⇉` render and both are disabled.
- [x] 4.2 Add a new test file `reader-src/src/composables/__tests__/useChapterNav-boundary-jumps.test.ts`:
  - `goToFirst` is a no-op on empty chapter list.
  - `goToLast` is a no-op on empty chapter list.
  - `goToFirst` from index 5 in backend mode calls `navigateTo(0)` (verify side-effect: chapter-change hook fires with `previousIndex: 5, currentIndex: 0`, and `currentIndex.value` is `0` afterwards).
  - `goToLast` from index 2 with 11 chapters in backend mode lands on `currentIndex.value === 10` and dispatches `chapter:change` with `previousIndex: 2`.
  - In FSA mode with `chapters.value.length === 5`, `goToLast()` invokes `loadFSAChapter(4)` (mock the FSA file-read helper to assert the index).
  - In FSA mode with `chapters.value.length === 5` and `currentIndex.value === 3`, `goToFirst()` invokes `loadFSAChapter(0)` (not `navigateTo(0)`).
- [x] 4.3 Add or extend a `StorySelector` component test asserting:
  - When `selectedStory === ""`, the `<summary>` contains the visible text `📖 故事選擇` and SHALL NOT carry an `aria-label` attribute.
  - When `selectedStory === "my-story"`, the `<summary>` contains only `📖` and the `<summary>` element itself carries `aria-label="故事選擇"`.
  - When `selectedStory` toggles back to `""`, the full label re-renders and the `aria-label` attribute is removed.
- [x] 4.4 Update the empty-state copy in `ContentArea.vue` and the corresponding `ContentArea.test.ts` assertion together so the user is no longer instructed to click a button that no longer exists. Replace with neutral copy that points to the `📖 故事選擇` selector (e.g., `「請從上方 📖 故事選擇 載入或建立故事章節」`). The `ContentArea.test.ts` empty-state assertion currently references the `選擇資料夾` text — both files SHALL be updated in the same commit.

## 5. Validation

- [x] 5.1 Run `deno task test:frontend` and confirm 0 regressions across all suites.
- [x] 5.2 Run `deno task build:reader` and confirm the build succeeds.
- [x] 5.3 Run `openspec validate header-chapter-nav-tweaks --strict` and confirm green.
- [x] 5.4 Manual smoke (or agent-browser smoke) on a backend story with ≥3 chapters: confirm the new buttons render at boundaries correctly, the StorySelector toggle collapses to `📖` after selection, and no `📂 選擇資料夾` button appears in the header.

## 6. Documentation

- [x] 6.1 If `docs/` references the FSA folder-picker button as a primary entry point, update those references (or add a brief note that the button has been removed in this change). Inspect `docs/` for `選擇資料夾` mentions before touching anything.
- [x] 6.2 Update `AGENTS.md`'s "Project Structure" snippet only if the file list changes (it should not — only file contents change). Update the inline component description for `AppHeader.vue` and `StorySelector.vue` if they were specifically described.
