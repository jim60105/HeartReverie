## Why

The backend polling interval (1 second) triggers the global API rate limiter (60 req/min). Each poll cycle makes 1–2 requests (chapter list + last chapter content), consuming 60–120 requests/minute from polling alone, leaving no headroom for user actions. This causes 429 errors to spam the console.

## What Changes

- Increase backend polling interval from 1 second to 3 seconds (~20 polls/min = ~40 req/min, leaving headroom)
- Add exponential backoff on 429 responses — temporarily increase poll interval when rate-limited, then recover

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `auto-reload`: Increase backend poll interval and add 429 backoff

## Impact

- `reader/js/chapter-nav.js`: Poll interval constants and backoff logic in `pollBackend`
