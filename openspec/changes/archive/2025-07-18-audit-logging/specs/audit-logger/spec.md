## ADDED Requirements

### Requirement: Logger module interface

The system SHALL provide a logger module at `writer/lib/logger.ts` that exports a `createLogger(category: string)` function. The returned logger object SHALL expose methods: `debug(message, data?)`, `info(message, data?)`, `warn(message, data?)`, `error(message, data?)`. Each method SHALL produce a structured log entry.

#### Scenario: Creating a category logger
- **WHEN** `createLogger("llm")` is called
- **THEN** it SHALL return a logger object with `debug`, `info`, `warn`, `error` methods that tag all entries with category `"llm"`

#### Scenario: Logger methods accept message and optional data
- **WHEN** `logger.info("Request received", { path: "/api/chat" })` is called
- **THEN** a log entry SHALL be produced with the message and data fields included

### Requirement: Structured log entry format

Each log entry SHALL contain: `timestamp` (ISO 8601), `level` (debug/info/warn/error), `category` (string), `correlationId` (string or null), `message` (string), `data` (object or undefined). File output SHALL be JSON Lines format (one JSON object per line). Console output SHALL be human-readable with ANSI color codes for levels.

#### Scenario: File output format
- **WHEN** a log entry is written to the log file
- **THEN** it SHALL be a single JSON line containing all structured fields: `{"timestamp":"...","level":"info","category":"llm","correlationId":"abc-123","message":"...","data":{...}}`

#### Scenario: Console output format
- **WHEN** a log entry is written to console
- **THEN** it SHALL display in human-readable format with colored level indicator, timestamp, category, and message

### Requirement: Log level configuration

The logger SHALL respect the `LOG_LEVEL` environment variable. Valid values SHALL be: `debug`, `info`, `warn`, `error`. The default level SHALL be `info`. Messages below the configured level SHALL be suppressed.

#### Scenario: Default log level
- **WHEN** `LOG_LEVEL` is not set
- **THEN** the logger SHALL output entries at `info` level and above (info, warn, error) and suppress `debug` entries

#### Scenario: Debug level enabled
- **WHEN** `LOG_LEVEL` is set to `debug`
- **THEN** the logger SHALL output all entries including debug-level messages

#### Scenario: Error level only
- **WHEN** `LOG_LEVEL` is set to `error`
- **THEN** the logger SHALL only output error-level entries

### Requirement: Log file output with rotation

The logger SHALL write structured JSON lines to a log file. The default path SHALL be `playground/_logs/audit.jsonl` (relative to working directory), configurable via `LOG_FILE` environment variable. The logger SHALL create the log directory if it does not exist. The log file SHALL rotate when it exceeds 10MB, keeping up to 5 backup files.

#### Scenario: Default log file path
- **WHEN** `LOG_FILE` is not set
- **THEN** the logger SHALL write to `playground/_logs/audit.jsonl`

#### Scenario: Custom log file path
- **WHEN** `LOG_FILE` is set to `/tmp/heartreverie.jsonl`
- **THEN** the logger SHALL write to `/tmp/heartreverie.jsonl`

#### Scenario: Log directory creation
- **WHEN** the log file directory does not exist
- **THEN** the logger SHALL create it recursively before writing

#### Scenario: Log rotation
- **WHEN** the log file exceeds 10MB
- **THEN** the logger SHALL rotate the file, keeping up to 5 backup files

### Requirement: Correlation ID support

The logger SHALL support request-scoped correlation IDs via an immutable derivation pattern. The `logger.withContext({ correlationId })` method SHALL return a new logger instance that includes the correlation ID in all subsequent entries. The original logger instance SHALL remain unchanged. This ensures concurrent requests do not share mutable state.

#### Scenario: Derived logger with correlation ID
- **WHEN** `const reqLogger = logger.withContext({ correlationId: "req-abc-123" })` is called and then `reqLogger.info("processing")` is called
- **THEN** the log entry SHALL include `"correlationId": "req-abc-123"`

#### Scenario: Original logger unaffected
- **WHEN** a derived logger is created with a correlation ID
- **THEN** the original logger SHALL continue to emit entries with `"correlationId": null`

#### Scenario: No correlation ID
- **WHEN** `logger.info("startup")` is called without deriving a scoped logger
- **THEN** the log entry SHALL include `"correlationId": null`

### Requirement: Logger initialization

The logger module SHALL export an `initLogger()` function that sets up file and console handlers based on environment configuration. This function SHALL be called once during server startup. If `LOG_FILE` is set to an empty string, file logging SHALL be disabled (console only).

#### Scenario: Initialization creates handlers
- **WHEN** `initLogger()` is called during server startup
- **THEN** the console handler and file handler SHALL be configured and ready

#### Scenario: Disable file logging
- **WHEN** `LOG_FILE` is set to `""`
- **THEN** only console logging SHALL be active; no file handler SHALL be created

### Requirement: Sensitive data exclusion

The logger SHALL never log authentication credentials (passphrases, API keys, Authorization headers). HTTP request logging SHALL exclude request headers containing sensitive values. LLM request logging SHALL redact the `Authorization` header from any logged request metadata.
