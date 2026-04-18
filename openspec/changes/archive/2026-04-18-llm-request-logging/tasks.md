## 1. Logger Module Extension

- [x] 1.1 Add `LLM_LOG_FILE` to `writer/lib/config.ts` environment variable loading (default: `playground/_logs/llm.jsonl`, empty string disables)
- [x] 1.2 Add LLM log target state (`llmLogFilePath`, `llmLogFile` handle) to `writer/lib/logger.ts` as a named target alongside the existing audit target
- [x] 1.3 Extend `initLogger()` to open and configure the LLM log target (read `LLM_LOG_FILE` env, create directory, open file handle, handle permission errors gracefully with warning)
- [x] 1.4 Implement `createLlmLogger()` factory function that returns a logger bound to the LLM target — writes file-only (no console, no audit log), not gated by global LOG_LEVEL
- [x] 1.5 Implement rotation logic for the LLM log file (reuse existing rotation approach with the LLM file handle)
- [x] 1.6 Extend `closeLogger()` to close the LLM log file handle
- [x] 1.7 Implement no-op logger return when LLM target is disabled (LLM_LOG_FILE empty)

## 2. Chat Execution Integration

- [x] 2.1 Create LLM interaction logger instance in `writer/lib/chat-shared.ts` using `createLlmLogger()`
- [x] 2.2 Log full LLM request entry (type: "request") before `fetch()` call — include systemPrompt, userMessage, model, all parameters, series, story, correlationId
- [x] 2.3 Extract token usage from final SSE chunk `usage` field (prompt_tokens, completion_tokens, total_tokens) if present during stream parsing
- [x] 2.4 Log full LLM response entry (type: "response") after streaming completes — include response content, latencyMs, chapter, tokens
- [x] 2.5 Log partial response entry on abort — include partial content, aborted: true, latencyMs
- [x] 2.6 Log error entry (type: "error") on LLM API failure — include errorCode, httpStatus, latencyMs, errorBody for non-2xx; errorCode for no-body/no-content

## 3. Configuration & Documentation

- [x] 3.1 Add `LLM_LOG_FILE` to `AGENTS.md` environment variables table
- [x] 3.2 Add `LLM_LOG_FILE` to `.env.example` with a comment

## 4. Testing

- [x] 4.1 Add unit tests for `createLlmLogger()` — verify it writes to the LLM log file in JSON Lines format, does NOT write to console or audit log
- [x] 4.2 Add unit tests for LLM log target initialization (default path, custom path, disabled with empty string, directory creation, permission error handling)
- [x] 4.3 Add test verifying LLM logging is independent of LOG_LEVEL (still writes at LOG_LEVEL=error)
- [x] 4.4 Add integration test for `executeChat()` verifying request + response entries are written to LLM log file with correct structure
- [x] 4.5 Add test for token usage extraction from SSE stream (present and absent cases)
- [x] 4.6 Add test for abort scenario logging partial content with aborted: true
- [x] 4.7 Add test for error scenarios (non-2xx, no-body, no-content) producing terminal error entries
