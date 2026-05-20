## Why

Today, when the user opens `StorySelector` from `/settings/*` (or `/tools/*`) on desktop and clicks **載入** (or creates a new story), the dropdown selection updates `selectedSeries` / `selectedStory` via `v-model`, but the **actual story** is never loaded:

- The header continues to display `尚未選擇故事` because `folderName` lives in `useChapterNav` and is only set by `loadFromBackend()`.
- `/settings/lore` never loads the chosen story's lore.
- `/settings/prompt-editor` cannot render a prompt preview because no story is in the backend context.

This was an unintended side-effect of the previous change that gated `navigateToStory()` behind `isReadingRoute()` (so that picking a story from settings would not yank the user back to the reading page). The gate correctly prevents navigation, but it also incorrectly prevents the story from being loaded at all.

The expected behavior — confirmed with the user — is: picking a story from settings/tools SHALL leave the user on the current settings/tools page **and** put the engine into the same "story is loaded" state it would be in if the user had picked the story from the reading page and then navigated to settings.

## What Changes

- **`useChapterNav.loadFromBackend()` gains an explicit `options.syncRoute` flag.** When omitted, behavior is unchanged (the route is replaced with the chapter route, preserving today's reading-page flow). When called with `{ syncRoute: false }`, the function loads chapters, dispatches the same `story:switch` / `chapter:change` hooks, updates `folderName`, and subscribes via WebSocket — but it SHALL NOT call `router.replace()`. This keeps the user on whatever route they are on.
- **`StorySelector.handleLoad()` and `handleCreate()` always load the story.** They call `loadFromBackend(series, story, undefined, { syncRoute: !isReadingRoute(route.path) ? false : undefined })`. They additionally call `navigateToStory()` **only** when the user is already on a reading route — preserving the existing in-reader switch flow. (Equivalent rewrite: always call `loadFromBackend` with `syncRoute: false` for settings/tools, then call `navigateToStory` for reading; the route watcher in `useChapterNav` already debounces redundant loads via `currentSeries`/`currentStory` checks.)
- **NOT BREAKING:** no API, no persisted-state change, no spec removed. `loadFromBackend`'s default behavior is preserved. New callers opt in to `syncRoute: false`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `story-selector`: The "Story loading" requirement is updated so that selecting a story from settings/tools loads it into the backend context without navigating away. Navigation to the reading route remains the behavior when the user is already in the reader.
- `chapter-navigation`: The `loadFromBackend` Vue composable API contract gains an optional `options.syncRoute` parameter.

## Impact

- `HeartReverie/reader-src/src/composables/useChapterNav.ts` — add optional `options` parameter; gate the `syncRoute()` call.
- `HeartReverie/reader-src/src/components/StorySelector.vue` — invoke `loadFromBackend` from `handleLoad` / `handleCreate` even when not on a reading route.
- `HeartReverie/reader-src/src/components/__tests__/StorySelector.test.ts` — extend the existing route-gating tests to assert `loadFromBackend` is always called (regardless of route) and `navigateToStory` only on reading routes.
- `HeartReverie/reader-src/src/composables/__tests__/useStorySelector*.test.ts` — no change expected; route-sync watchers are untouched.
- No backend changes. No template/markup changes beyond StorySelector's script section.
