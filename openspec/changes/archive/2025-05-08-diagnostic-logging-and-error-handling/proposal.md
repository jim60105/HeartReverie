## Why

An audit of the HeartReverie core backend (`writer/`) revealed **19 locations** where errors are either silently swallowed or returned to the client without any server-side logging. This creates zero observability in production:

- **Empty catch blocks** return fallback values (empty arrays, `null`, `{}`) for *any* error, not just the expected "file not found" case. A disk permission error, corrupt JSON, or I/O timeout is indistinguishable from a missing file.
- **500 responses without logging** — multiple route handlers return HTTP 500 to the client but never call `log.error(...)`, making it impossible to diagnose failures from server logs alone.
- **Silent streaming failures** — malformed JSON chunks from the LLM are dropped without trace; WebSocket polling errors produce no signal even when systematic.

**Real-world impact:** A Sharp/AVIF image processing failure went undiagnosed for days because the error was caught and discarded. The client received `{ images: [] }` and operators had no indication anything was wrong until users reported missing thumbnails. Similar silent failures in story listing and chapter operations could cause data loss (e.g., duplicate story creation when `listChapterFiles` masks a disk error as "no chapters exist").

## What Changes

A systematic fix of all identified catch blocks and error response paths in `writer/`:

1. **Distinguish `Deno.errors.NotFound` from other errors** in every catch block that currently swallows all exceptions. Only the "file/directory does not exist" case should return a fallback; all other errors propagate or are logged.
2. **Add `log.error(...)` to every route handler that returns 5xx** before constructing the error response.
3. **Add debug-level logging** to streaming parse failures and WebSocket poll errors so repeated systematic failures surface in debug logs.
4. **Add console.error fallback** to the logger subsystem itself, so log-write failures don't create a permanent blind spot.
5. **Return 400 (not silent `{}`)** for request body parse failures.

## Capabilities

### New Capabilities

- `error-handling-conventions`: Cross-cutting specification defining mandatory error handling patterns for all backend catch blocks and route handlers.

### Modified Capabilities

None — existing API contracts (status codes, response shapes) are preserved for success paths. Error responses become *more specific* (e.g., a permission error now returns 500 with a logged message instead of silently returning an empty array), which is a correctness improvement, not a contract change.

## Impact

- `writer/lib/story.ts` — `listChapterFiles` error handling
- `writer/lib/chat-shared.ts` — streaming JSON parse, system prompt file reads
- `writer/lib/lore.ts` — directory read and passage read error handling
- `writer/lib/logger.ts` — write-failure fallback
- `writer/lib/generation-registry.ts` — lock context (minor)
- `writer/routes/chapters.ts` — story init + 500 logging
- `writer/routes/stories.ts` — 500 logging
- `writer/routes/lore.ts` — 500 logging (3 endpoints)
- `writer/routes/images.ts` — error classification
- `writer/routes/plugins.ts` — 404 vs 500 distinction
- `writer/routes/ws.ts` — debug logging for poll failures
- `writer/routes/chat.ts` — request parse failure handling
- `writer/routes/plugin-actions.ts` — request parse + file error handling
