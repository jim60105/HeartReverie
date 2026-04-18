## Context

The batch chapter loading endpoint (`GET /chapters?include=content`) was added in commit 8cd2393 and the frontend `useChapterNav` composable's `loadFromBackendInternal()` was updated to use it. However, the user observes per-chapter API calls in the browser network tab when visiting a story URL directly.

Current code analysis shows `loadFromBackendInternal()` at `useChapterNav.ts:233-238` does call the batch endpoint. The most likely root cause is:

1. **Stale `reader-dist/` build (primary suspect)** — the built frontend output doesn't match the source. Since `reader-dist/` is the served directory and must be rebuilt with `deno task build:reader`, any source change not followed by a rebuild means the browser runs old code. The source uses `?include=content` but the served bundle may still contain an older N+1 fetch loop.

Secondary, less likely causes:
2. **Duplicate load trigger** — `App.vue:handleUnlocked` and the route watcher in `initRouteSync()` could both fire. However, the route watcher uses `watch()` without `immediate: true` and `loadFromBackend()` sets `currentSeries/currentStory` before route sync, so this is unlikely.
3. **HTTP polling fallback** — `pollBackend()` makes individual `/chapters/:lastNum` requests for streaming updates when WebSocket is disconnected. This could appear as extra individual requests, but it only fetches one chapter (the last), not a fan-out across all chapters.

## Goals / Non-Goals

**Goals:**
- Identify and fix the exact cause of per-chapter API requests during story load
- Ensure exactly one batch request is made on initial story load and story switching
- Eliminate any redundant or individual chapter content fetches during initial load
- Verify the fix with browser automation (agent-browser)
- Rebuild `reader-dist/` and confirm it reflects the fix

**Non-Goals:**
- Changing the batch endpoint API contract (backend is correct)
- Removing the individual chapter endpoint (still needed for last-chapter polling)
- Changing the WebSocket streaming architecture
- Backward compatibility concerns (no users in production)

## Decisions

### 1. Reproduce first with the current served build, then fix

Run the application with `./scripts/serve.sh` using the current `reader-dist/` (without rebuilding) and capture network requests. This preserves the stale build evidence. Then inspect the served bundle to confirm whether it contains the batch endpoint pattern. Only rebuild after documenting the root cause.

**Alternative considered:** Rebuild first and then test. Rejected because rebuilding destroys evidence of a stale build being the root cause.

### 2. Rebuild reader-dist as part of the fix

Always run `deno task build:reader` to ensure the served frontend matches the source. This is a mandatory step regardless of whether code changes are needed.

### 3. Guard against duplicate load on init

Ensure `App.vue`'s `handleUnlocked` and the route watcher in `useChapterNav` don't both trigger `loadFromBackend()` for the same story on initial load. The route watcher uses Vue's `watch()` without `immediate: true`, so it shouldn't fire for the initial route value — but a race condition in the reactivity system during app initialization could cause it.

If a race condition is found, add a guard (e.g., a `loading` flag or token check) to prevent concurrent loads for the same series/story.

## Risks / Trade-offs

- **[Risk]** The issue may not be reproducible after a fresh build → **Mitigation**: If a rebuild alone fixes it, document that `reader-dist/` was stale and add a note/check to prevent stale builds
- **[Risk]** The issue may be in polling, not initial load → **Mitigation**: Even if initial load is correct, reduce unnecessary polling requests and clearly distinguish polling from initial load in the network tab
- **[Risk]** Browser automation may not capture fine-grained network requests → **Mitigation**: Use agent-browser's network interception or screenshot the network tab
