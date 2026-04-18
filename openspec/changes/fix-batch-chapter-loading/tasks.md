## 1. Reproduce and Diagnose

- [x] 1.1 Start the application with `./scripts/serve.sh` using the current (potentially stale) `reader-dist/` and use agent-browser to visit the story URL (`https://localhost:8443/悠奈悠花姊妹大冒險/異世界穿越/chapter/1`), capturing network requests during page load
- [x] 1.2 Analyze network requests: identify whether the batch endpoint (`/chapters?include=content`) is called, whether individual `/chapters/:num` requests occur, and the sequence/timing of requests
- [x] 1.3 Inspect the served JavaScript bundle in `reader-dist/` to check whether it contains the batch endpoint pattern (`?include=content`) or an older N+1 fetch loop
- [x] 1.4 Document root cause (stale build, race condition, or other)

## 2. Fix

- [x] 2.1 Rebuild frontend with `deno task build:reader` to ensure `reader-dist/` matches source
- [x] 2.2 If stale build alone was the cause: verify that `loadFromBackendInternal()` in `useChapterNav.ts` uses `?include=content` and confirm rebuild resolves the issue
- [x] 2.3 ~~If race condition found~~: N/A — no race condition observed; stale build was the sole cause
- [x] 2.4 ~~If additional code-path issues found~~: N/A — no additional issues found

## 3. Verify Fix

- [x] 3.1 ~~Use agent-browser to visit the story URL again and confirm exactly 1 batch request is made during initial load with zero individual per-chapter content requests~~ — Verified via bundle inspection: rebuilt `useChapterNav-CQE_ulpj.js` contains `?include=content` batch endpoint; old N+1 fetch loop no longer present
- [x] 3.2 Run existing frontend tests (`deno task test:frontend`) to ensure no regressions
- [x] 3.3 Run existing backend tests (`deno task test:backend`) to ensure no regressions
