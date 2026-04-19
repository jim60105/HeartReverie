## 1. Logger Core

- [x] 1.1 Create `writer/lib/logger.ts` with `initLogger()` and `createLogger(category)` functions; implement structured JSON log entry format with timestamp, level, category, correlationId, message, data fields
- [x] 1.2 Implement console handler with human-readable ANSI-colored output format
- [x] 1.3 Implement rotating file handler writing JSON Lines to configurable path (default `playground/_logs/audit.jsonl`), rotation at 10MB, 5 backups
- [x] 1.4 Implement `LOG_LEVEL` environment variable support (debug/info/warn/error, default: info) and `LOG_FILE` env var (empty string disables file output)
- [x] 1.5 Implement correlation ID support: `withContext({ correlationId })` method that returns a derived logger instance with the correlation ID immutably bound (no mutable shared state)
- [x] 1.6 Add `LOG_LEVEL` and `LOG_FILE` to `writer/lib/config.ts` environment variable loading

## 2. Integration — LLM

- [x] 2.1 Add LLM request/response logging in `writer/lib/chat-shared.ts`: info-level metadata (model, latency, status, tokens), debug-level full payloads (messages, params, response content)
- [x] 2.2 Add correlation ID generation per chat execution (pass through ChatOptions)

## 3. Integration — File Operations

- [x] 3.1 Add file operation logging in `writer/lib/story.ts`, `writer/lib/chat-shared.ts`, `writer/routes/chapters.ts`, `writer/routes/prompt.ts`, and `writer/routes/lore.ts`: log writes, deletes, mkdir with path and byte count; never log file content at info level

## 4. Integration — Template & Plugins

- [x] 4.1 Add template rendering logging in `writer/lib/template.ts`: info-level path/variable-count/latency, debug-level full rendered output and variables
- [x] 4.2 Add plugin hook dispatch logging in `writer/lib/hooks.ts`: debug-level stage/handler-count/plugin-names/latency

## 5. Integration — Auth, WebSocket, HTTP

- [x] 5.1 Add authentication attempt logging in `writer/lib/middleware.ts` and `writer/routes/ws.ts`: info for success, warn for failure
- [x] 5.2 Add WebSocket lifecycle logging in `writer/routes/ws.ts`: connected, authenticated, message type, closed with code/reason
- [x] 5.3 Add HTTP request logging middleware in `writer/app.ts` or `writer/lib/middleware.ts`: method, path, status, latency

## 6. Cleanup & Server Init

- [x] 6.1 Replace all existing `console.log`/`console.error`/`console.warn` calls in `writer/` with structured logger calls
- [x] 6.2 Call `initLogger()` in server startup (`writer/server.ts`) before other initialization

## 7. Testing

- [x] 7.1 Add unit tests for logger module: log level filtering, structured entry format, correlation ID isolation between derived loggers, sensitive data exclusion, fallback on missing env vars
- [x] 7.2 Run full backend test suite (`deno task test:backend`) and confirm all tests pass

## 8. Documentation

- [x] 8.1 Update `AGENTS.md` with new environment variables (`LOG_LEVEL`, `LOG_FILE`) and logger module description
