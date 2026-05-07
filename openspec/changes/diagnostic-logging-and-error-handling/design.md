## Context

The HeartReverie backend (`writer/`) uses Deno + Hono with a custom file-based logger (`writer/lib/logger.ts`). Error responses follow RFC 9457 Problem Details via the `problemJson()` helper in `writer/lib/errors.ts`. The backend operates on the filesystem (`playground/` directory tree) for story, chapter, and lore data.

Currently, many catch blocks were written with the assumption that "the only realistic error is file-not-found" — a reasonable shortcut during early development, but one that creates dangerous blind spots in production where permission errors, corrupt data, disk failures, and network timeouts all get masked as "no data".

## Goals / Non-Goals

**Goals:**

- G1: Every catch block that currently swallows all errors SHALL distinguish `Deno.errors.NotFound` from other error types
- G2: Every route handler returning HTTP 5xx SHALL log the error server-side before responding
- G3: The logger subsystem SHALL emit `console.error` when its own write operations fail (debounced to avoid log storms)
- G4: WebSocket polling failures SHALL be logged at debug level when they recur
- G5: Request body JSON parse failures SHALL log and return 400 immediately (not silently default to `{}`)
- G6: LLM streaming JSON parse failures SHALL be logged at debug level with a truncated payload snippet

**Non-Goals:**

- Structured logging format changes (current format is adequate)
- Adding external log aggregation (Loki, ELK, etc.)
- Retry logic for transient failures
- User-facing error message improvements (keep RFC 9457 format)
- Changing success-path behavior or API contracts
- Adding new dependencies

## Decisions

### D1: Error classification pattern — `instanceof Deno.errors.NotFound`

All catch blocks that legitimately expect "file may not exist" SHALL use:

```typescript
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    // Expected: return fallback (empty array, null, default)
  }
  // Unexpected: log and rethrow/return error response
  log.error(`[context] Unexpected error: ${error}`);
  throw error; // or return problemJson(c, 500, ...)
}
```

**Why:** `Deno.errors.NotFound` is the idiomatic Deno way to detect filesystem "not found" errors. It's a specific class, not a string match, so it's reliable across Deno versions. All other error types (PermissionDenied, ConnectionRefused, etc.) fall through to the error path.

**Alternative considered:** Checking `error.code === "ENOENT"` — rejected because Deno uses typed error classes, not Node.js error codes.

### D2: Route handler 500 logging — `log.error` before `problemJson`

Every route handler catch block that returns a 5xx response SHALL call `log.error(...)` with:
- The route context (method + path pattern)
- The caught error (message + stack if available)

```typescript
} catch (error) {
  log.error(`[POST /api/stories/:series/:name/chapters] ${error}`);
  return problemJson(c, 500, "Internal error while saving chapter");
}
```

**Why:** The existing `log` module writes to `logs/` on disk with timestamps. This provides a persistent record for post-incident investigation. Without this line, the 500 reaches the client but leaves no server-side trace.

### D3: Logger self-healing — debounced console.error fallback

When `writer/lib/logger.ts` fails to write to its log file (e.g., disk full, permissions revoked), it SHALL:
1. Emit `console.error(...)` with the original log message and the write error
2. Debounce: only emit once per 60-second window per error type to avoid flooding stderr
3. Track a failure counter; if failures exceed a threshold, log a single summary warning on recovery

```typescript
let lastConsoleErrorTime = 0;
const DEBOUNCE_MS = 60_000;

function fallbackLog(message: string, writeError: unknown): void {
  const now = Date.now();
  if (now - lastConsoleErrorTime > DEBOUNCE_MS) {
    console.error(`[logger] Write failed: ${writeError} — original message: ${message}`);
    lastConsoleErrorTime = now;
  }
}
```

**Why:** The logger is the last line of defense. If it fails silently, *all* logging is lost. `console.error` goes to stderr, which container runtimes (Docker, Kubernetes) capture separately. Debouncing prevents a broken disk from generating millions of stderr lines.

### D4: WebSocket poll failure logging — debug level with per-operation rate limiting

The 4 catch blocks in `routes/ws.ts` (polling loop) SHALL log at debug level. To avoid flooding logs when a systematic error occurs (e.g., backend restart during active polling), logging SHALL be rate-limited **per operation key** using a `Map<string, number>`:

```typescript
const wsErrorTimestamps = new Map<string, number>();
const WS_ERROR_DEBOUNCE_MS = 5_000;

function logWsPollError(operation: string, error: unknown): void {
  const now = Date.now();
  const lastLog = wsErrorTimestamps.get(operation) ?? 0;
  if (now - lastLog > WS_ERROR_DEBOUNCE_MS) {
    log.debug(`[ws:poll] Error during ${operation}: ${serializeError(error).message}`);
    wsErrorTimestamps.set(operation, now);
  }
}
```

**Why:** WebSocket polling runs every few seconds per connected client. A systematic failure (disk unmounted, permission change) would generate hundreds of log lines per minute without rate limiting. Using a per-operation Map (keyed by e.g., `"chapter-read"`, `"generation-check"`) ensures that a failure in one operation doesn't suppress logging for a *different* operation that fails concurrently. Debug level keeps production logs clean while making the signal visible when debug logging is enabled.

**Alternative considered:** A single global timestamp — rejected because it creates cross-operation suppression: if `chapter-read` errors every 2s, it would prevent `generation-check` errors from ever being logged.

### D5: Request body parse — log + 400 immediately

Routes that currently do `catch(() => ({}))` on `c.req.json()` SHALL instead:

```typescript
let body: RequestBody;
try {
  body = await c.req.json();
} catch (error) {
  log.warn(`[POST /api/chat] Malformed request body: ${error}`);
  return problemJson(c, 400, "Invalid JSON in request body");
}
```

**Why:** A malformed request body is a client error (4xx), not something to silently ignore. The current pattern causes the handler to proceed with an empty object, leading to confusing downstream errors or silent no-ops.

### D6: LLM streaming parse — debug log with truncated payload

In `lib/chat-shared.ts`, when a streaming JSON chunk fails to parse:

```typescript
} catch (parseError) {
  log.debug(`[chat:stream] Malformed JSON chunk (${chunk.length} bytes): ${chunk.slice(0, 200)}`);
  // Continue processing next chunk (existing behavior preserved)
}
```

**Why:** LLM APIs occasionally emit malformed chunks (partial UTF-8, trailing garbage). Logging at debug avoids noise in production but provides forensic data when investigating streaming issues. The 200-byte truncation prevents multi-KB chunks from bloating log files.

### D7: Shared error serialization utility — `serializeError`

All error logging SHALL use a shared utility to safely extract meaningful information from caught `unknown` values:

```typescript
// writer/lib/errors.ts (add to existing module)

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
```

Usage in log calls:

```typescript
} catch (error) {
  const details = serializeError(error);
  log.error(`[GET /api/stories] ${details.message}`, details);
  return problemJson(c, 500, "Failed to list stories");
}
```

**Why:** Caught errors in TypeScript are typed as `unknown`. Calling `.message` or `.stack` directly requires unsafe type assertions or `instanceof` checks at every call site. A shared utility centralizes this logic, ensures consistent output format, and handles edge cases (thrown strings, numbers, `null`). Placing it in `writer/lib/errors.ts` co-locates it with the existing `problemJson()` helper.

## Architecture

No architectural changes. This is a cross-cutting improvement to existing error handling paths. The call graph, module boundaries, and API contracts remain unchanged.

```
┌─────────────────────────────────────────────────────┐
│  Route Handler (catch block)                        │
│  ┌───────────────────────────────────────────────┐  │
│  │ 1. log.error(...) / log.warn(...) / log.debug │  │
│  │ 2. Classify: NotFound → fallback              │  │
│  │            : Other    → problemJson 5xx/4xx   │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  lib/logger.ts                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │ Write to logs/ directory                      │  │
│  │ On failure → console.error (debounced)        │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Migration / Rollout

No migration needed. Changes are purely additive (logging) or correctness fixes (error classification). No configuration changes, no new environment variables, no database migrations.

Rollout is immediate on deploy. The only observable difference:
- Server logs will contain error entries that were previously invisible
- Some edge-case error responses change from `200 + empty data` to `500 + Problem Details` (this is a correctness fix — the previous behavior was incorrect)
