## Context

Backend polling at 1-second intervals causes rate-limit (429) spam. The global rate limiter allows 60 requests/minute, but polling alone consumes 60–120 req/min.

## Goals / Non-Goals

**Goals:**
- Eliminate 429 spam during normal backend polling
- Maintain responsive streaming update detection
- Gracefully back off when rate-limited

**Non-Goals:**
- Changing the server-side rate limit configuration
- WebSocket-based push notifications (future enhancement)

## Decisions

1. **Poll interval**: Increase from 1s to 3s. This gives ~20 polls/min × 2 requests = ~40 req/min, leaving ~20 req/min for user actions.

2. **429 backoff**: When `pollBackend` receives a 429, temporarily increase the interval using exponential backoff (double the interval, cap at 30s). On next successful poll, reset to the base 3s interval. Use `clearInterval` + `setInterval` to dynamically adjust.

## Risks / Trade-offs

- 3s polling means streaming content updates are slightly less real-time (3s lag vs 1s). Acceptable trade-off for stability.
- Backoff recovery adds complexity but prevents cascade failures.
