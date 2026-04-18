## MODIFIED Requirements

### Requirement: Logger initialization

The logger module SHALL export an `initLogger()` function that sets up file and console handlers based on environment configuration. This function SHALL be called once during server startup. If `LOG_FILE` is set to an empty string, file logging SHALL be disabled (console only). The function SHALL also initialize the LLM interaction log file target based on `LLM_LOG_FILE` environment variable (default: `playground/_logs/llm.jsonl`). If `LLM_LOG_FILE` is set to an empty string, LLM file logging SHALL be disabled.

#### Scenario: Initialization creates handlers
- **WHEN** `initLogger()` is called during server startup
- **THEN** the console handler, audit file target, and LLM file target SHALL be configured and ready

#### Scenario: Disable file logging
- **WHEN** `LOG_FILE` is set to `""`
- **THEN** only console logging SHALL be active; no audit file target SHALL be created

#### Scenario: Disable LLM file logging
- **WHEN** `LLM_LOG_FILE` is set to `""`
- **THEN** the audit log file target SHALL still function normally, but no LLM file target SHALL be created

#### Scenario: LLM log file defaults
- **WHEN** `LLM_LOG_FILE` is not set
- **THEN** the LLM log file target SHALL write to `playground/_logs/llm.jsonl`

## ADDED Requirements

### Requirement: LLM log target

The logger module SHALL support a named LLM log target initialized at startup alongside the audit log target. The module SHALL export a `createLlmLogger()` function that returns a logger instance bound to the LLM log target. This logger SHALL write entries ONLY to the LLM log file (bypassing console and audit log). The LLM log target SHALL use the same JSON Lines format and rotation policy (10MB, 5 backups) as the audit target. The LLM logger SHALL NOT be gated by the global `LOG_LEVEL`.

#### Scenario: Creating an LLM logger
- **WHEN** `createLlmLogger()` is called after `initLogger()` has completed
- **THEN** it SHALL return a logger instance that writes entries exclusively to the LLM log file

#### Scenario: LLM logger bypasses console
- **WHEN** the LLM logger writes an entry
- **THEN** the entry SHALL NOT appear on console (stdout/stderr)

#### Scenario: LLM logger bypasses audit log
- **WHEN** the LLM logger writes an entry
- **THEN** the entry SHALL NOT appear in the audit log file

#### Scenario: LLM log target uses same rotation policy
- **WHEN** the LLM log file exceeds 10MB
- **THEN** it SHALL rotate the file using the same policy as the audit log (up to 5 backups)

#### Scenario: LLM logger disabled when target not initialized
- **WHEN** `createLlmLogger()` is called but `LLM_LOG_FILE` was set to `""` during init
- **THEN** it SHALL return a no-op logger that silently discards all entries
