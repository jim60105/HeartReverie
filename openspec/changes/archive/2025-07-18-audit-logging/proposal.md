## Why

The HeartReverie backend currently has no structured logging. Scattered `console.error` calls make debugging difficult — there's no record of LLM requests/responses, file operations, template rendering, or plugin hook execution. For a developer-oriented tool, comprehensive audit logs are essential for:

1. **Debugging**: Tracing issues through the request lifecycle (prompt assembly → LLM call → response streaming → file write)
2. **Future analysis**: Understanding LLM behavior, token usage patterns, and response quality over time
3. **Operation visibility**: Knowing exactly what file changes occurred and when

## What Changes

Introduce a structured logging system that records every significant backend operation with full detail. The logger will:

- Output structured JSON log entries to both console (human-readable) and a rotating log file
- Record all LLM requests with full input (system prompt, user message, model parameters) and full output (response content, token usage)
- Record all file operations (create, write, delete) with paths and content summaries
- Record template rendering, plugin hook dispatches, authentication attempts, and WebSocket events
- Use configurable log levels (debug, info, warn, error) with environment variable control

## Capabilities

### New Capabilities

- `audit-logger`: Core structured logging library — log levels, JSON output to console and file, rotation, context tracking per request
- `audit-logging-integration`: Integration points across the backend — LLM calls, file operations, template rendering, plugin hooks, auth, WebSocket lifecycle

### Modified Capabilities

_(none — purely additive)_

## Impact

- `writer/lib/logger.ts` — new logger module
- `writer/lib/config.ts` — new LOG_LEVEL, LOG_FILE env vars
- `writer/lib/chat-shared.ts` — LLM request/response logging with correlation IDs
- `writer/lib/template.ts` — template render timing and variable logging
- `writer/lib/hooks.ts` — plugin hook dispatch logging
- `writer/lib/middleware.ts` — auth attempt logging (success/failure)
- `writer/lib/plugin-manager.ts` — replaced ~30 console calls with structured plugin logger
- `writer/routes/ws.ts` — WebSocket lifecycle, auth, file ops logging
- `writer/routes/chat.ts` — error logging
- `writer/routes/prompt.ts` — file ops logging (write/delete template)
- `writer/routes/chapters.ts` — file ops logging (delete chapter, init story)
- `writer/routes/lore.ts` — file ops logging (write/delete passage)
- `writer/routes/plugins.ts` — plugin containment warning logging
- `writer/app.ts` — HTTP request/response middleware logging
- `writer/server.ts` — initLogger() call, startup logging
- Environment: new `LOG_LEVEL` and `LOG_FILE` variables
- No frontend changes
- No breaking changes
