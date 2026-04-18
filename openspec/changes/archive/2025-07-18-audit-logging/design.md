## Context

The backend currently used scattered `console.error`/`console.log`/`console.warn` calls (~45 total across the codebase). There was no structured logging, no log files, and no way to trace a request through the system. LLM requests (the most expensive and complex operation) had zero observability beyond a single error log.

## Goals / Non-Goals

**Goals:**
- Structured JSON log entries with timestamp, level, category, and payload
- Dual output: console (human-readable with color) + file (JSON lines)
- Full LLM request/response logging (system prompt, user message, parameters, response content, token counts)
- File operation logging (path, operation type, content length)
- Request-level context tracking (correlation ID per request/WebSocket message)
- Configurable log level via `LOG_LEVEL` environment variable
- Log file path configurable via `LOG_FILE` environment variable
- Log file rotation by size (10MB default)

**Non-Goals:**
- External log aggregation (no ELK/Splunk integration)
- Metrics/telemetry/APM
- Frontend logging
- Log encryption or access control
- Real-time log streaming to browser

## Decisions

1. **Custom logger module** — A lightweight custom `writer/lib/logger.ts` module provides all logging functionality. We chose this over Deno's `@std/log` standard library module because: (a) `@std/log` may be deprecated, (b) a simple custom facade gives us full control and minimal dependency. The module exports `initLogger()`, `createLogger(category)`, and `_resetLogger()` for testing.

2. **Structured JSON format for file output** — Each log entry is a single JSON line containing: `timestamp`, `level`, `category`, `correlationId`, `message`, `data`. Console output uses a human-readable format with ANSI colors.

3. **Categories for domain separation** — Predefined categories: `llm`, `file`, `template`, `plugin`, `auth`, `ws`, `http`, `system`. Each log call specifies its category.

4. **Correlation ID per request** — Generate a UUID per HTTP request or WebSocket message. Use an immutable derivation pattern: `logger.withContext({ correlationId })` returns a new logger instance. This avoids mutable shared state between concurrent requests. The `ChatOptions` interface already threads context; extend it with `correlationId`.

5. **Log full LLM payloads** — Both request body (messages, parameters) and response content are logged at `debug` level. At `info` level, only metadata (model, token counts, latency) is logged.

6. **File rotation at 10MB** — Custom rotation logic shifts `audit.jsonl` → `.1` → `.2` → ... → `.5`, with `maxBackups: 5`.

7. **Default log level: `info`** — Set via `LOG_LEVEL` env var. Accepts: `debug`, `info`, `warn`, `error`.

8. **Default log file: `playground/_logs/audit.jsonl`** — Under the playground directory so it's co-located with story data but in a system-reserved `_` prefixed directory (excluded from story listings).

9. **Replace existing console.error/log calls** — All existing scattered calls will be replaced with structured logger calls.

## Risks / Trade-offs

- **Risk**: Full LLM payload logging at debug level produces large log files. Mitigated by: default level is `info` (metadata only), rotation at 10MB with 5 backups (max ~50MB).
- **Risk**: Logging adds latency to hot paths. Mitigated by: file writes are async/buffered via `@std/log` handlers; logging overhead is negligible compared to LLM API latency.
- **Trade-off**: Correlation ID is passed via immutable derived loggers (not via async context or mutable state). This is slightly more verbose but is concurrency-safe and works reliably in Deno.
- **Security**: Never log authentication credentials (passphrases, API keys, Authorization headers) at any level.
- **Trade-off**: Storing logs under `playground/_logs/` means they persist with the volume mount in container deployments. This is intentional — logs should survive container restarts.
