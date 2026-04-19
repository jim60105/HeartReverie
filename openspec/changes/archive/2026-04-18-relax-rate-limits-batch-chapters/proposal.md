## Why

The existing API rate limits (60 global, 10 per-endpoint per minute) are too restrictive for normal single-user operation. When WebSocket disconnects, HTTP fallback polling alone consumes 20–40 req/min, and story loading makes N+1 requests for N chapters — a story with 100 chapters triggers 101 HTTP requests in a burst, easily exceeding the 60/min global limit and blocking the user.

## What Changes

- Relax API rate limits to accommodate single-user usage patterns:
  - Global: 60 → 300 req/min
  - Auth: 10 → 30 req/min (was 5 in spec, 10 in code)
  - Chat: 10 → 30 req/min
  - Preview-prompt: 10 → 60 req/min (new tier)
- Add batch chapter loading: `GET /api/stories/:series/:name/chapters?include=content` returns all chapter numbers and contents in a single response (`[{number, content}]`)
- Frontend `loadFromBackendInternal()` now makes 1 request instead of N+1

## Capabilities

### New Capabilities

- `batch-chapter-loading`: Batch endpoint for loading all chapters with content in a single HTTP request, eliminating N+1 query patterns

### Modified Capabilities

- `writer-backend`: Rate limiting requirement updated with relaxed limits for single-user deployment and a new preview-prompt tier

## Impact

- Backend: `writer/routes/chapters.ts` (batch query parameter support), `writer/app.ts` (rate limit values)
- Frontend: `reader-src/src/composables/useChapterNav.ts` (uses batch endpoint)
- Tests: `reader-src/src/composables/__tests__/useChapterNav.test.ts`, `reader-src/src/router/__tests__/router.test.ts` (mocks updated for single-request pattern)
- No breaking changes: the original `GET /chapters` without `?include=content` still returns `[number]` as before
