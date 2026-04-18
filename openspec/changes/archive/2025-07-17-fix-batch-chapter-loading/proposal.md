## Why

The batch chapter loading API (`GET /chapters?include=content`) was implemented on the backend (commit 8cd2393) and the frontend `useChapterNav` composable was updated to use it. However, when testing at `https://localhost:8443/…/chapter/1`, separate per-chapter API calls are observed instead of a single batch request. This defeats the purpose of the batch endpoint and produces unnecessary network overhead.

## What Changes

- Investigate and fix the root cause of per-chapter API calls during story loading (potential causes: stale `reader-dist/` build, race condition between `handleUnlocked` and route watchers, or missing batch integration in a code path)
- Ensure the frontend exclusively uses the batch endpoint for all initial/reload chapter data fetching
- Verify with browser automation that exactly one batch request is made on story load

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `batch-chapter-loading`: Ensure the frontend requirement "single batch request for chapter data" is reliably met in practice — verify the built frontend matches the source and fix any code path that bypasses batch loading
- `chapter-navigation`: Ensure no code path in the chapter navigation composable or components makes individual per-chapter content requests during initial story load or story switching

## Impact

- `reader-src/src/composables/useChapterNav.ts` — primary investigation target for any non-batch code paths
- `reader-src/src/App.vue` — initialization flow that triggers chapter loading
- `reader-dist/` — may need rebuild to match source
- `writer/routes/chapters.ts` — backend batch endpoint (reference only, likely correct)
- Frontend tests (`useChapterNav.test.ts`) — may need additional assertions
