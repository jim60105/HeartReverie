## 1. Reproduce and Diagnose

- [ ] 1.1 Start the application with `./scripts/serve.sh` using the current (potentially stale) `reader-dist/` and use agent-browser to visit the story URL (`https://localhost:8443/悠奈悠花姊妹大冒險/異世界穿越/chapter/1`), capturing network requests during page load
- [ ] 1.2 Analyze network requests: identify whether the batch endpoint (`/chapters?include=content`) is called, whether individual `/chapters/:num` requests occur, and the sequence/timing of requests
- [ ] 1.3 Inspect the served JavaScript bundle in `reader-dist/` to check whether it contains the batch endpoint pattern (`?include=content`) or an older N+1 fetch loop
- [ ] 1.4 Document root cause (stale build, race condition, or other)

## 2. Fix

- [ ] 2.1 Rebuild frontend with `deno task build:reader` to ensure `reader-dist/` matches source
- [ ] 2.2 If stale build alone was the cause: verify that `loadFromBackendInternal()` in `useChapterNav.ts` uses `?include=content` and confirm rebuild resolves the issue
- [ ] 2.3 If race condition found: add a guard in `App.vue` or `useChapterNav.ts` to prevent duplicate `loadFromBackend()` calls for the same series/story during initialization
- [ ] 2.4 If additional code-path issues found: fix any code path that makes individual per-chapter content requests during initial load

## 3. Verify Fix

- [ ] 3.1 Use agent-browser to visit the story URL again and confirm exactly 1 batch request is made during initial load with zero individual per-chapter content requests
- [ ] 3.2 Run existing frontend tests (`deno task test:frontend`) to ensure no regressions
- [ ] 3.3 Run existing backend tests (`deno task test:backend`) to ensure no regressions
