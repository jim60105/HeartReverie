## 0. Instrumentation & Reproduction

- [x] 0.1 Add `getHandlerCount(stage: HookStage): number` to `FrontendHookDispatcher` in `reader-src/src/lib/plugin-hooks.ts`.
- [x] 0.2 Add a `RENDER_DEBUG` opt-in (read from `import.meta.env.VITE_RENDER_DEBUG` or `localStorage.RENDER_DEBUG`) and emit `console.debug` records at:
  - `auth-verified`
  - `plugins-settled` (with `{ ready, settled, pluginCount }`)
  - `chapter-content-committed` (with `{ series, story, chapterIndex, contentLength, renderEpoch }`)
  - `chapter-render-dispatched` (with `{ frontendRenderHandlers, chapterRenderAfterHandlers }`) — emit from inside `useMarkdownRenderer.renderChapter()`.
- [x] 0.3 Manually reproduce against the bundled third-party `status` plugin (HeartReverie_Plugins): on edit-save and on F5 reload at `/series/story/chapter/N`, capture the `RENDER_DEBUG` ordering.
- [x] 0.4 Confirm whether the reload path actually races: with `Promise.all([initPlugins, applyBackground])` already awaited before `loadFromBackend`, the race may already be impossible. If instrumentation confirms no race, mark Phase 2 (Section 6) as not required for this change.

## 1. Plugin readiness & registration robustness (`reader-src/src/composables/usePlugins.ts`)

- [x] 1.1 Replace the single `initialized: ref(false)` flag with two reactive flags: `pluginsReady = ref(false)` (true only on full success) and `pluginsSettled = ref(false)` (true after init runs, success or failure).
- [x] 1.2 Add a module-level `let initPromise: Promise<void> | null = null;` and have `initPlugins()` return the in-flight promise to concurrent callers; clear it in `finally`.
- [x] 1.3 Inside the per-plugin loop, change `mod.register(frontendHooks)` to `await Promise.resolve(mod.register(frontendHooks))` so async `register()` is honored.
- [x] 1.4 Replace the silent `try/catch { /* ignore */ }` around `/api/plugins` fetch and dynamic `import()` with: log the error, surface it via `useNotification` (or `console.warn` if `useNotification` is not yet available in this composable), and continue so the page still renders.
- [x] 1.5 Export both `pluginsReady` and `pluginsSettled` from `usePlugins()`.
- [x] 1.6 Update the existing `usePlugins` tests to exercise: success path flips both flags; failure path flips `pluginsSettled` only; concurrent `initPlugins()` calls share one promise; async `register()` is awaited before the per-plugin promise resolves.

## 2. `useChapterNav` content commit invariant (`reader-src/src/composables/useChapterNav.ts`)

- [x] 2.1 Change `currentContent` from `ref("")` to `shallowRef<string>("")` and import `triggerRef` from `vue`.
- [x] 2.2 Add module-level `const renderEpoch = ref(0);` and export it from the composable.
- [x] 2.3 Add a private `function commitContent(next: string): void` that assigns `next` (or calls `triggerRef(currentContent)` if equal) and always increments `renderEpoch`.
- [x] 2.4 Replace every direct `currentContent.value = ...` write inside the file with a `commitContent(...)` call. Sites: `loadFromBackend`, `loadFromBackendInternal`, `reloadToLast`, `pollBackend`, the WebSocket `chapters:content` handler, and the (also new) `refreshAfterEdit`. Verify with `grep -n "currentContent\.value\s*=" reader-src/src/composables/useChapterNav.ts` that no direct write remains.
- [x] 2.5 Add `async function refreshAfterEdit(targetChapter: number): Promise<void>` per design.md Decision 4. Re-uses the existing `loadToken` race guard. Stays on the edited chapter index, dispatches `chapter:change` only when the index actually changes, calls `syncRoute()` and `startPollingIfNeeded()`.
- [x] 2.6 Export `refreshAfterEdit` and `renderEpoch` from the `useChapterNav()` return value.
- [x] 2.7 Cover with tests in `reader-src/src/composables/__tests__/useChapterNav-coverage.test.ts`:
  - Editing chapter 2 of a 5-chapter story → `currentIndex` is 1 (chapter 2), `currentContent` reflects chapter 2's new content.
  - Editing the last chapter to byte-identical content → `triggerRef` invalidates dependents (assert via a spy on a `watchEffect` that reads `currentContent`); `renderEpoch` increments.
  - Concurrent edit + load: `loadToken` guard discards the older operation.

## 3. `ChapterContent.vue` edit-save and render dependencies

- [x] 3.1 In `<script setup>`, replace `await reloadToLast();` after a successful `editChapter` with `await refreshAfterEdit(currentChapterNumber.value);`.
- [x] 3.2 Make the `tokens` computed read `pluginsReady` and `renderEpoch` so it re-evaluates if the gate's render invalidation needs to chain.
- [x] 3.3 Update `reader-src/src/components/__tests__/ChapterContent.test.ts`:
  - Edit-save scenario asserts the user remains on the edited chapter (`currentIndex` unchanged, `currentChapterNumber` unchanged).
  - Byte-identical edit-save scenario asserts the rendered DOM still reflects a re-render after invalidation (e.g. spy on `chapter:render:after` and assert it dispatched after the save) without asserting an exact count.
  - Sidebar relocation scenario asserts that after edit-save, `.plugin-sidebar` panels appear inside the `.sidebar` element (use the existing `<Sidebar>` mock or add one).

## 4. `ContentArea.vue` gating and sidebar relocation

- [x] 4.1 Replace `v-if="currentContent"` on `<ChapterContent>` with `v-if="pluginsSettled && currentContent"` (note: `pluginsSettled`, not `pluginsReady`, so plugin failures still allow rendering).
- [x] 4.2 Render a small "Loading…" placeholder when `!pluginsSettled` (reuse the existing loading placeholder if any; otherwise add a minimal `<div class="loading-placeholder">…</div>` styled with existing utility classes).
- [x] 4.3 Refactor the sidebar relocation `watchPostEffect` to an explicit `watch([currentContent, isLastChapter, pluginsReady, renderEpoch], …, { flush: "post", immediate: true })` per design.md Decision 2. Always clear the sidebar first; skip relocation when not renderable.
- [x] 4.4 Add or extend `reader-src/src/components/__tests__/ContentArea.test.ts`:
  - `<ChapterContent>` does not mount when `pluginsSettled === false`, even if `currentContent` is non-empty.
  - When `currentContent`, `isLastChapter`, `pluginsReady`, or `renderEpoch` change, the sidebar relocation effect runs and the resulting `<Sidebar>` contents reflect the new `.plugin-sidebar` panels.
  - Sidebar is cleared when the user navigates to a chapter whose rendered content has no `.plugin-sidebar` panels.

## 5. `App.vue` boot ordering review

- [x] 5.1 Audit `App.vue#handleUnlocked` against the instrumentation captured in Section 0. Confirm that `Promise.all([initPlugins(), applyBackground()])` already completes before `loadFromBackend()` is called. If true, no change to `App.vue` is required for this change.
- [x] 5.2 If instrumentation reveals a missing await (e.g. `connect()` running before `initPlugins`'s side effects settle), reorder the awaits accordingly. Document the finding in the change's PR description.

## 6. (Phase 2 — Conditional) Deep-link route ownership

- [~] 6.1 **Only execute Section 6 if Section 0 instrumentation confirms a residual reload race after Sections 1–5 are complete.** Otherwise, mark this section as deferred and not required for the current change.
- [~] 6.2 If executed: design and document a "desired route key" model in `useChapterNav.initRouteSync()` that handles mid-load route changes; remove the deep-link `loadFromBackend` from `App.vue#handleUnlocked`; audit and update other `loadFromBackend` callers (`useStorySelector`, `ChapterContent.vue#handleBranch`) to coexist with the new route-driven load. Add tests for: initial deep-link load, browser back/forward during a load, and concurrent branch + reload.

## 7. Documentation

- [x] 7.1 Update `docs/plugin-system.md` with a short "Render lifecycle" section: `pluginsReady` vs `pluginsSettled`, the readiness gate in `ContentArea`, the sidebar relocation contract, and the edit-save invariant.
- [x] 7.2 Update the "Frontend Rendering Pipeline" subsection in `AGENTS.md` to one paragraph describing: `<ChapterContent>` is gated on `pluginsSettled`; `currentContent` is a `shallowRef` written through `commitContent`; `renderEpoch` exists to invalidate watches that don't directly read `currentContent`; edit-save uses `refreshAfterEdit(targetChapter)`.

## 7a. v-html remount key (added after manual repro)

- [x] 7a.1 In `reader-src/src/components/ChapterContent.vue`, change the rendered-token `v-for` `:key` to `\`${idx}-${renderEpoch}\`` so the `<div v-html="token.content">` is unmounted and remounted on every `renderEpoch` bump. This is required because `ContentArea`'s sidebar-relocation watch externally mutates the DOM (`appendChild` moves `.plugin-sidebar` away from the v-html div); Vue's `v-html` would otherwise skip the patch on a byte-identical re-render and the panel would never reappear in content for the watch to relocate.
- [x] 7a.2 Add a regression test in `ChapterContent.test.ts` that simulates external removal of `.plugin-sidebar` from the v-html div, bumps `renderEpoch` with byte-identical token output, and asserts the panel reappears. Use a real Vue `ref(0)` for `renderEpochRef` in the test mock state so reactivity actually triggers re-render.
- [x] 7a.3 Expose a new `bumpRenderEpoch()` function from `useChapterNav()` (and add it to `UseChapterNavReturn` in `reader-src/src/types/index.ts`). Have `cancelEdit` in `ChapterContent.vue` call it so the sidebar relocation watch re-runs after exiting edit mode without saving — otherwise pressing 取消 leaves the original sidebar panels in place AND duplicates them in chapter content. Add a regression test asserting `bumpRenderEpoch` is called exactly once on cancel.

## 8. Verification

- [x] 8.1 Run `deno task lint` and fix any new findings.
- [x] 8.2 Run `deno task test:frontend` and confirm all suites pass, including the new and updated tests in Sections 1, 2, 3, 4.
- [x] 8.3 Run `deno task test:backend` to confirm no regression (none expected — this is a frontend-only change).
- [x] 8.4 Run `deno task build:reader` and confirm a clean build.
- [x] 8.5 Manual smoke test against the bundled third-party `status` plugin (HeartReverie_Plugins):
  - F5 reload at `/<series>/<story>/chapter/N` → status panel appears in the sidebar.
  - Edit chapter N's content (modified content) → user stays on chapter N, status panel re-renders in the sidebar.
  - Edit chapter N's content with no changes (byte-identical) → save still triggers a re-render and the status panel is still present.
  - Navigate Story Selector → chapter N → status panel renders correctly (regression check).
- [x] 8.6 Run `openspec validate fix-frontend-render-on-edit-and-reload --strict` one final time.
