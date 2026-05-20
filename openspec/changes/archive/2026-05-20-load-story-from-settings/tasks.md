# Tasks

## 1. Composable: extend `loadFromBackend`

- [x] 1.1 Add `options?: { syncRoute?: boolean }` parameter to `loadFromBackend(series, story, startChapter?, options?)` in `HeartReverie/reader-src/src/composables/useChapterNav.ts`.
- [x] 1.2 Gate the `syncRoute()` call: skip it when `options?.syncRoute === false`. Default (omitted) behavior unchanged.
- [x] 1.3 Update the `UseChapterNavReturn` type in `HeartReverie/reader-src/src/types/` to reflect the new signature.

## 2. StorySelector: load story from settings/tools

- [x] 2.1 In `HeartReverie/reader-src/src/components/StorySelector.vue`, import `useChapterNav`.
- [x] 2.2 In `handleLoad()`: always call `loadFromBackend(series, story, undefined, { syncRoute: isReadingRoute(route.path) })`. Continue calling `navigateToStory(series, story)` only when `isReadingRoute(route.path)`.
- [x] 2.3 In `handleCreate()`: after `createStory(...)`, mirror the same load + conditional navigate logic.
- [x] 2.4 Verify lazy initialization: calling `useChapterNav()` in StorySelector SHALL NOT trigger unwanted side-effects (the route-sync watcher is already singleton-guarded).

## 3. Tests

- [x] 3.1 Extend `HeartReverie/reader-src/src/components/__tests__/StorySelector.test.ts`:
  - Mock `useChapterNav` to expose a `loadFromBackend` spy.
  - Assert `loadFromBackend` is called for both `handleLoad` and `handleCreate` regardless of route.
  - Assert `loadFromBackend` is invoked with `{ syncRoute: true }` on `/reading/...` and `{ syncRoute: false }` on `/settings/...`.
  - Assert `navigateToStory` is only called on reading routes (existing).
- [x] 3.2 Run `deno run -A npm:vitest run` — all 920+ tests pass.
- [x] 3.3 Run `deno run -A npm:vue-tsc --noEmit` — clean.

## 4. Container verification

- [x] 4.1 `cd HeartReverie/ && scripts/podman-build-run.sh` — clean rebuild.
- [x] 4.2 `podman logs heartreverie 2>&1 | grep -iE "error|warn"` — clean.
- [x] 4.3 On desktop (`1451×790`), navigate to `/settings/prompt-editor`; open StorySelector; pick series + story; click 載入.
  - Header `.folder-name` SHALL change from `尚未選擇故事` to `series / story`.
  - URL SHALL remain `/settings/prompt-editor`.
  - Prompt preview SHALL render (or at minimum the "no preview available" placeholder SHALL be replaced by the actual preview component populated with story state).
- [x] 4.4 Navigate to `/settings/lore`; SHALL load lore from the selected story (no spurious "select a story first" message).
- [x] 4.5 Repeat with create flow (enter new story name → 建立). Same outcome.
- [x] 4.6 Verify reading flow not regressed: on `/{series}/{story}/chapter/N`, opening StorySelector and picking a different story SHALL still call `router.push` to the new story route (unchanged behavior).
