## Purpose

Captures complete LLM request/response interactions to a dedicated log file for debugging and analysis, separate from the general audit log.

## ADDED Requirements

### Requirement: LLM request logging

The system SHALL log the complete LLM request payload before sending it to the LLM API. The log entry SHALL include: the full system prompt content, the user message content, all LLM parameters (model, temperature, frequency_penalty, presence_penalty, top_k, top_p, repetition_penalty, min_p, top_a), the correlation ID, and story context (series, story name).

#### Scenario: Full request logged on chat execution
- **WHEN** a chat request is executed via `executeChat()`
- **THEN** the LLM interaction logger SHALL write an entry with `data.type` = `"request"`, `data.systemPrompt` containing the full rendered system prompt, `data.userMessage` containing the user's input message, and `data.parameters` containing all LLM sampling parameters

#### Scenario: Request logged before streaming begins
- **WHEN** the LLM API fetch is initiated
- **THEN** the request log entry SHALL be written before the streaming response is read, so that failed requests still have their prompt recorded

### Requirement: LLM response logging

The system SHALL log the complete LLM response content after streaming completes. The log entry SHALL include: the full response text, latency in milliseconds, token usage (prompt_tokens, completion_tokens, total_tokens if available from the API), the correlation ID, and the chapter number written.

#### Scenario: Full response logged on completion
- **WHEN** LLM streaming completes successfully
- **THEN** the LLM interaction logger SHALL write an entry with `data.type` = `"response"`, `data.response` containing the complete generated text, `data.latencyMs` with the total response time, and `data.chapter` with the target chapter number

#### Scenario: Token usage extracted from API response
- **WHEN** the final SSE chunk contains a `usage` object with `prompt_tokens`, `completion_tokens`, `total_tokens`
- **THEN** the log entry SHALL include `data.tokens` with those values

#### Scenario: Token usage unavailable
- **WHEN** the LLM API does not provide token usage information in any streaming chunk
- **THEN** the log entry SHALL include `data.tokens` with `null` values for all fields

#### Scenario: Partial response logged on abort
- **WHEN** the user aborts generation mid-stream
- **THEN** the LLM interaction logger SHALL write a response entry with `data.type` = `"response"`, `data.response` containing the partial content received so far, and `data.aborted` = `true`

### Requirement: LLM error logging

The system SHALL log a terminal error entry when an LLM request fails for any reason other than user abort. This ensures every request entry in the log has a matching terminal entry (response or error).

#### Scenario: Non-2xx API response
- **WHEN** the LLM API returns a non-2xx HTTP status
- **THEN** the LLM interaction logger SHALL write an entry with `data.type` = `"error"`, `data.errorCode` (e.g., `"llm-api"`), `data.httpStatus`, `data.latencyMs`, and `data.errorBody` containing the API error response text

#### Scenario: Missing response body
- **WHEN** the LLM API returns a 2xx status but no response body
- **THEN** the LLM interaction logger SHALL write an entry with `data.type` = `"error"`, `data.errorCode` = `"no-body"`, and `data.latencyMs`

#### Scenario: Empty content after streaming
- **WHEN** streaming completes but no content was extracted from the response
- **THEN** the LLM interaction logger SHALL write an entry with `data.type` = `"error"`, `data.errorCode` = `"no-content"`, and `data.latencyMs`

### Requirement: Dedicated LLM log file

The system SHALL write LLM interaction log entries to a dedicated file, separate from the general audit log. The default path SHALL be `playground/_logs/llm.jsonl`. The file SHALL use the same JSON Lines format and rotation policy (10MB, 5 backups) as the general audit log.

#### Scenario: Default LLM log file path
- **WHEN** `LLM_LOG_FILE` environment variable is not set
- **THEN** the LLM interaction logger SHALL write to `playground/_logs/llm.jsonl`

#### Scenario: Custom LLM log file path
- **WHEN** `LLM_LOG_FILE` is set to `/var/log/heartreverie/llm.jsonl`
- **THEN** the LLM interaction logger SHALL write to that path

#### Scenario: LLM log file disabled
- **WHEN** `LLM_LOG_FILE` is set to an empty string `""`
- **THEN** the LLM interaction logger SHALL NOT write to any file (logging disabled)

#### Scenario: LLM log directory creation
- **WHEN** the directory for the LLM log file does not exist
- **THEN** the system SHALL create it recursively before writing

#### Scenario: LLM log rotation
- **WHEN** the LLM log file exceeds 10MB
- **THEN** the system SHALL rotate the file, renaming existing files (`.1`, `.2`, etc.) and keeping up to 5 backups

### Requirement: LLM log entry format

Each LLM log entry SHALL conform to the existing `LogEntry` structure: `timestamp` (ISO 8601), `level` (`"info"`), `category` (`"llm"`), `correlationId` (string), `message` (string), `data` (structured object). The `data` field SHALL contain a `type` discriminator (`"request"` or `"response"`) to distinguish entry types.

#### Scenario: Request entry structure
- **WHEN** a request entry is written
- **THEN** it SHALL be a valid JSON line with fields: `timestamp`, `level: "info"`, `category: "llm"`, `correlationId`, `message: "LLM request"`, and `data` containing `type: "request"`, `series`, `story`, `model`, `parameters`, `systemPrompt`, `userMessage`

#### Scenario: Response entry structure
- **WHEN** a response entry is written
- **THEN** it SHALL be a valid JSON line with fields: `timestamp`, `level: "info"`, `category: "llm"`, `correlationId`, `message: "LLM response"`, and `data` containing `type: "response"`, `response`, `latencyMs`, `chapter`, `tokens`

### Requirement: LLM log initialization

The LLM interaction logger SHALL be initialized during server startup alongside the general audit logger. The `initLogger()` function SHALL accept an optional `llmLogFile` path (or read `LLM_LOG_FILE` from environment). If initialization fails (e.g., permission error), the system SHALL log a warning and disable LLM file logging without preventing server startup.

#### Scenario: LLM logger initialized at startup
- **WHEN** `initLogger()` is called during server startup
- **THEN** the LLM log file handler SHALL be opened and ready to accept entries

#### Scenario: LLM logger initialization failure
- **WHEN** the LLM log file path is not writable (permission denied)
- **THEN** the system SHALL log a warning to the console and disable LLM file logging without crashing

### Requirement: File-only logging

LLM interaction log entries (request, response, error) SHALL be written ONLY to the dedicated LLM log file. They SHALL NOT be written to the console (stdout/stderr) or to the general audit log file. This prevents large prompt/response content from flooding container logs or bloating the audit log.

#### Scenario: LLM entries not written to console
- **WHEN** a request or response entry is logged by the LLM interaction logger
- **THEN** it SHALL NOT appear in stdout or stderr output

#### Scenario: LLM entries not written to audit log
- **WHEN** a request or response entry is logged by the LLM interaction logger
- **THEN** it SHALL NOT appear in the general audit log file (`playground/_logs/audit.jsonl`)

### Requirement: Independent of global log level

LLM interaction logging SHALL NOT be gated by the global `LOG_LEVEL` environment variable. It SHALL always write entries when the LLM log file is configured (non-empty `LLM_LOG_FILE`). The feature is controlled solely by the `LLM_LOG_FILE` configuration (set = enabled, empty = disabled).

#### Scenario: LLM logging active at LOG_LEVEL=error
- **WHEN** `LOG_LEVEL` is set to `"error"` and `LLM_LOG_FILE` is configured
- **THEN** the LLM interaction logger SHALL still write all request/response/error entries to the LLM log file

#### Scenario: LLM logging disabled by empty path
- **WHEN** `LLM_LOG_FILE` is set to `""`
- **THEN** no LLM interaction entries SHALL be written regardless of `LOG_LEVEL`
