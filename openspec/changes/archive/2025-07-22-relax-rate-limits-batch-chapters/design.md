## Context

HeartReverie is a single-user interactive fiction engine. The backend has rate limiting middleware that was ported from a multi-user Express pattern (`express-rate-limit`). The current limits (60 global, 5–10 per endpoint) regularly block normal operation:

1. **Polling fallback**: When WebSocket disconnects, `useChapterNav` polls every 3 seconds (20–40 req/min) for chapter changes.
2. **N+1 chapter loading**: `loadFromBackendInternal()` makes 1 request to list chapters + N individual GET requests to fetch each chapter's content. A story with 100 chapters triggers 101 requests in a burst.
3. **Page load burst**: Initial load fetches series list, story list, chapters, template, parameters, and config in rapid succession.

The WebSocket/HTTP fallback architecture is correctly implemented (polling is disabled when WS is active), so there is no redundant API usage — the issue is purely that the limits are too tight for the existing correct behavior.

## Goals / Non-Goals

**Goals:**
- Ensure normal single-user workflows never hit rate limits
- Eliminate the N+1 HTTP request pattern for chapter loading
- Maintain backward compatibility with existing API consumers

**Non-Goals:**
- Making rate limits configurable via env vars (unnecessary complexity for single-user app)
- Implementing pagination or lazy loading for chapters (batch is sufficient for expected story sizes)
- Removing rate limiting entirely (still useful as a safety net against infinite loops)

## Decisions

### Decision 1: Relax rate limits to generous single-user values

**Choice**: Global 300/min, auth 30/min, chat 30/min, preview 60/min

**Rationale**: This is a personal app with a single user. Rate limiting serves only as a safety net against accidental infinite loops, not as protection against multi-user abuse. The values were chosen to be 5–10× higher than worst-case normal usage patterns (polling burst + page load).

**Alternative considered**: Removing rate limiting entirely — rejected because it still provides protection against frontend bugs that could spam the backend.

### Decision 2: Add `?include=content` query parameter to existing list endpoint

**Choice**: Extend `GET /api/stories/:series/:name/chapters` with an optional `?include=content` query parameter that changes the response shape from `number[]` to `{number, content}[]`.

**Rationale**: This is the minimal change that eliminates N+1 requests while preserving full backward compatibility. The endpoint without the parameter still returns `number[]` for other consumers (e.g., WebSocket subscription polling only needs counts).

**Alternative considered**: Separate `/chapters/all` endpoint — rejected because it duplicates route logic and the query parameter approach is more RESTful.

### Decision 3: Frontend batch loading in a single fetch

**Choice**: `loadFromBackendInternal()` makes one request with `?include=content` and directly assigns the response array to `chapters.value`.

**Rationale**: Simplifies the code from a loop with N fetches to a single assignment. Response shape `[{number, content}]` matches `ChapterData[]` exactly.

## Risks / Trade-offs

- **Large response size for very long stories** → Acceptable for single-user local deployment. A story with 500 chapters of 2KB each would be ~1MB, well within reason. If real-world usage reveals stories exceeding ~5MB total chapter content, pagination can be added as a follow-up (out of scope for this change).
- **Rate limits may still be hit in edge cases** → The 300/min global limit allows ~5 requests/second sustained, which is generous for any human-driven interaction.
- **Memory usage on batch load** → All chapters are loaded into memory at once. This is the existing behavior (the old N+1 pattern also stored all chapters in `chapters.value`), so no regression.
