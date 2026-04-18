## Why

The current logging system logs LLM request metadata (model, parameters, prompt length) at debug level but does NOT log the actual prompt content or the full response content. This makes debugging prompt issues, analyzing LLM behavior, and auditing AI interactions impossible without manually inspecting chapter files and reconstructing the system prompt. Full request/response logging is essential for iterating on prompt templates, diagnosing unexpected LLM outputs, and maintaining a complete audit trail.

## What Changes

- Add a dedicated LLM interaction log that captures the **full system prompt**, **user message**, and **complete LLM response** for every chat request
- Log all LLM request parameters (model, temperature, penalties, sampling) alongside the prompt content
- Include metadata: correlation ID, timestamps (request start, response complete), latency, token counts (if available from API response headers/body), story context (series/story/chapter)
- Write LLM interaction logs to a separate log file from the general audit log to avoid bloating the main log with large prompt/response payloads
- Make the LLM interaction log path configurable via a new `LLM_LOG_FILE` environment variable, defaulting to `playground/_logs/llm.jsonl`
- Respect the existing `LOG_FILE=` (empty) disable convention — if `LLM_LOG_FILE` is explicitly set to empty, disable LLM logging
- Apply the same file rotation policy (10MB, 5 backups) as the main audit log

## Capabilities

### New Capabilities
- `llm-interaction-log`: Full request/response logging for LLM chat interactions, including prompt content, response content, parameters, timing, and token usage metadata

### Modified Capabilities
- `audit-logger`: Add support for multiple log file targets (the logger module needs to support creating loggers that write to different files, not just the single global audit log)

## Impact

- **Code**: `writer/lib/logger.ts` (multi-file support), `writer/lib/chat-shared.ts` (emit full prompt/response log entries), `writer/lib/config.ts` (new env var)
- **Environment**: New `LLM_LOG_FILE` variable; existing behavior unchanged if not set
- **Storage**: LLM logs can be large (full prompts may be 10k+ chars); rotation keeps disk usage bounded
- **Privacy**: Logs contain full story content and user messages — same security posture as existing chapter files (filesystem-local, no external transmission)
