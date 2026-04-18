## Context

The HeartReverie backend already has a structured logging system (`writer/lib/logger.ts`) with JSON Lines file output, log rotation, correlation IDs, and category-based loggers. The chat execution flow in `writer/lib/chat-shared.ts` currently logs:
- Request metadata at debug level (model, parameters, prompt/message lengths)
- Response completion at info level (model, latency, content length)
- Response content at debug level (full content in `data` field)

However, the **full system prompt** sent to the LLM is never logged. The user message is only logged by length, not content. This makes it impossible to reproduce or analyze LLM interactions without manually reconstructing the prompt from template + story state.

The logger currently supports a single file target (the global audit log at `playground/_logs/audit.jsonl`). LLM interaction data (full prompts of 10k+ chars, full responses) would bloat this general-purpose log.

## Goals / Non-Goals

**Goals:**
- Log the complete LLM request payload (system prompt, user message, all parameters) for every chat interaction
- Log the complete LLM response content with timing and token metadata
- Write LLM interaction logs to a dedicated file, separate from the general audit log
- Reuse existing logger infrastructure (rotation, structured format, level filtering)
- Make the feature configurable (enable/disable, custom file path)

**Non-Goals:**
- Real-time log streaming or external log aggregation (out of scope)
- Log retention policies beyond file rotation (manual cleanup is acceptable)
- Compression of log files
- Logging partial/streaming chunks (only the final complete response)
- Token counting from the client side (only log token info if returned by the LLM API)

## Decisions

### Decision 1: Dedicated log file vs. embedded in audit log

**Choice:** Dedicated `playground/_logs/llm.jsonl` file for LLM interactions.

**Rationale:** LLM prompts can be 10,000+ characters. Mixing these with general HTTP/auth/file operation logs makes the audit log unwieldy for routine debugging. A dedicated file allows focused analysis of LLM behavior without noise. The same rotation policy (10MB / 5 backups) bounds disk usage.

**Alternative considered:** Logging everything to the existing audit log at debug level — rejected because even with level filtering, the file would grow rapidly and searching for non-LLM events becomes slow.

### Decision 2: Logger module extension approach

**Choice:** Add a named log target system initialized at startup. `initLogger()` opens both targets (audit + llm). A new `createLlmLogger()` factory returns a logger bound to the LLM target that writes **file-only** (no console/audit duplication).

**Rationale:** The current logger uses global singleton state for file handle, rotation, and queue. Adding an ad-hoc `createFileLogger(path)` would conflict with this architecture. Instead, treating the LLM log as a second named target initialized alongside the audit target keeps the architecture consistent. File-only behavior is critical — full prompts (10k+ chars) must NOT leak to stdout/container logs.

**Alternative considered:** A generic `createFileLogger(category, filePath)` factory — rejected because it creates parallel infrastructure that conflicts with the startup-initialized singleton pattern and doesn't address console suppression.

### Decision 3: Log entry structure for LLM interactions

**Choice:** Use the standard `LogEntry` format with a structured `data` field containing:
```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "level": "info",
  "category": "llm",
  "correlationId": "uuid",
  "message": "LLM interaction",
  "data": {
    "type": "request" | "response",
    "series": "...",
    "story": "...",
    "chapter": 1,
    "model": "...",
    "parameters": { "temperature": 0.1, ... },
    "systemPrompt": "...",
    "userMessage": "...",
    "response": "...",
    "latencyMs": 1234,
    "tokens": { "prompt": null, "completion": null, "total": null }
  }
}
```

**Rationale:** Maintaining the same `LogEntry` schema means existing log parsing tools work on both files. The `data` field is already designed for arbitrary structured content. Using `type: "request"` and `type: "response"` as separate entries allows logging the request before streaming begins and the response after completion, supporting partial-failure analysis.

**Alternative considered:** A single combined entry logged after response completes — simpler but loses the request context if the stream fails midway. Two entries (request + response) provide better debugging for failures.

### Decision 4: Configuration via environment variable

**Choice:** New `LLM_LOG_FILE` environment variable. Default: `playground/_logs/llm.jsonl`. Empty string disables. Follows the same convention as `LOG_FILE`.

**Rationale:** Consistent with existing `LOG_FILE` pattern. Separate variable avoids overloading `LOG_FILE` semantics. Default path keeps LLM logs co-located with the audit log for discoverability.

### Decision 5: Token count extraction

**Choice:** Extract token usage from the final SSE chunk's `usage` field if present. Log `null` for any field not provided by the API. Include `stream_options: { include_usage: true }` in the request body to opt-in to usage reporting on OpenAI-compatible APIs.

**Rationale:** OpenRouter and OpenAI-compatible APIs include a `usage` object in the final streaming chunk when `stream_options.include_usage` is set to `true`. This is a standard OpenAI API parameter (not provider-specific), so we include it to maximize token reporting coverage. If a provider ignores this option, the fields remain `null` — graceful degradation.

### Decision 6: File-only logging for LLM entries

**Choice:** LLM interaction entries (request/response/error) are written ONLY to the LLM log file, NOT to console or the audit log. This prevents full prompts from flooding stdout/container logs.

**Rationale:** Full system prompts can be 10,000+ characters. Writing these to console or the general audit log defeats the purpose of a dedicated file. The LLM logger bypasses the normal console+file dual-write path.

### Decision 7: Dedicated LLM log level

**Choice:** LLM interaction logging is NOT gated by the global `LOG_LEVEL`. It has its own implicit "always enabled" behavior (controlled solely by `LLM_LOG_FILE` being set or empty). This prevents `LOG_LEVEL=warn` from silently disabling the feature.

**Rationale:** The purpose of LLM logging is auditing/debugging interactions, which should be independent of the general log verbosity. Users expect that if the feature is configured (file path set), it works regardless of `LOG_LEVEL`.

### Decision 8: Error/failure terminal entries

**Choice:** In addition to "request" and "response" entries, add a terminal "error" entry type for failed LLM calls (non-2xx status, missing body, stream failures). This ensures every request entry has a matching terminal entry.

**Rationale:** Without an error entry, the log would contain orphaned request entries with no outcome, making analysis unreliable. Every request MUST have exactly one terminal entry: "response" (success), "response" with `aborted: true`, or "error".

## Risks / Trade-offs

- **[Disk usage]** Full prompt logging produces large files → Mitigated by 10MB rotation with 5 backups (max ~60MB for LLM logs). Each interaction ~20-40KB so ~250-500 interactions per rotation cycle.
- **[Performance]** Writing large log entries on every request → Mitigated by file-only writes (no console serialization). Log write happens after response is complete, not on the hot path.
- **[Sensitive content]** Story content in logs may contain personal creative writing → Same security posture as existing chapter files on disk. No external transmission. LLM entries are file-only, never written to console/stdout.
- **[Log file not available on abort]** If user aborts mid-stream, response entry logged with partial content → Acceptable; the partial content matches what was written to the chapter file.
- **[Orphaned request entries]** If the process crashes mid-stream → Unavoidable; the request entry exists without a terminal entry. Acceptable for crash scenarios.
