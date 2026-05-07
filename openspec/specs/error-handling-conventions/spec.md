# Error Handling Conventions

## Purpose

Cross-cutting specification defining mandatory error handling patterns for all backend code in `writer/`. These conventions ensure production observability, correct error classification, and prevent silent failures.

## Requirements

### Requirement: Catch block error classification

All catch blocks in `writer/` that handle filesystem operations SHALL distinguish `Deno.errors.NotFound` from other error types. Only the NotFound case MAY return a fallback value (empty array, null, default). All other errors SHALL either be rethrown or result in an error response with server-side logging.

#### Scenario: File legitimately does not exist
- **WHEN** a filesystem operation throws `Deno.errors.NotFound`
- **AND** the code path expects that the file/directory may not exist (e.g., first-time story creation, optional config file)
- **THEN** the catch block SHALL return the documented fallback value (empty array, null, or default)

#### Scenario: Unexpected filesystem error
- **WHEN** a filesystem operation throws an error that is NOT `Deno.errors.NotFound`
- **THEN** the catch block SHALL log the error with context (operation name, file path, error message)
- **AND** either rethrow the error or return an appropriate error response (5xx for server errors, 4xx for client errors)

#### Scenario: Pattern for NotFound classification
- **WHEN** a developer writes a new catch block for filesystem operations
- **THEN** the pattern SHALL be:
  ```typescript
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return fallbackValue;
    }
    log.error(`[context] ${error}`);
    throw error;
  }
  ```

### Requirement: Server-side logging for 5xx responses

Every route handler catch block that returns an HTTP 5xx response SHALL log the error server-side before constructing the response.

#### Scenario: Route handler catches unexpected error
- **WHEN** a route handler catches an error that will result in a 5xx response
- **THEN** the handler SHALL call `log.error(...)` with the route context (HTTP method + path pattern) and the caught error
- **AND** THEN return the `problemJson()` response

#### Scenario: Log format for route errors
- **WHEN** logging a route handler error
- **THEN** the log message SHALL include: `[METHOD /api/path] error message`
- **AND** the full error object SHALL be passed to enable stack trace capture

### Requirement: Logger self-protection

The logger subsystem (`writer/lib/logger.ts`) SHALL NOT silently discard its own write failures.

#### Scenario: Log file write fails
- **WHEN** the logger fails to write to the log file (disk full, permissions, I/O error)
- **THEN** the logger SHALL emit the original log message and the write error to `console.error`
- **AND** the console.error output SHALL be debounced (maximum once per 60-second window)

#### Scenario: Logger recovery
- **WHEN** the logger successfully writes after a period of failures
- **THEN** it MAY emit a single recovery message indicating how many messages were affected

### Requirement: WebSocket polling error visibility

WebSocket polling catch blocks SHALL log errors at debug level to provide visibility into systematic failures.

#### Scenario: Single transient poll error
- **WHEN** a WebSocket polling operation fails once
- **THEN** it SHALL be logged at debug level with the operation context

#### Scenario: Repeated poll errors (rate limiting)
- **WHEN** WebSocket polling errors occur repeatedly (more than once per 5-second window for a given operation)
- **THEN** only one debug log entry SHALL be emitted per 5-second window **per operation key** (e.g., `"chapter-read"`, `"generation-check"`) to prevent log flooding
- **AND** a failure in one operation SHALL NOT suppress logging for a different operation

### Requirement: Request body parse failure handling

Route handlers that parse JSON request bodies SHALL NOT silently default to an empty object on parse failure.

#### Scenario: Malformed JSON request body
- **WHEN** `c.req.json()` throws a parse error
- **THEN** the handler SHALL log the error at warn level
- **AND** return HTTP 400 with a Problem Details response indicating invalid JSON

#### Scenario: Valid JSON request body
- **WHEN** `c.req.json()` succeeds
- **THEN** processing SHALL continue normally (no behavior change)

### Requirement: LLM streaming parse error logging

Malformed JSON chunks received during LLM streaming SHALL be logged at debug level.

#### Scenario: Malformed streaming chunk
- **WHEN** a JSON chunk from the LLM API fails to parse
- **THEN** the error SHALL be logged at debug level with a truncated payload (maximum 200 bytes)
- **AND** processing SHALL continue with the next chunk (existing resilience behavior preserved)

### Requirement: Error serialization

All error logging SHALL use a shared `serializeError()` utility to safely extract structured information from caught `unknown` values.

#### Scenario: Error instance caught
- **WHEN** a caught value is an `Error` instance
- **THEN** `serializeError` SHALL return an object with `name`, `message`, and `stack` properties

#### Scenario: Non-Error value caught
- **WHEN** a caught value is not an `Error` instance (e.g., a string, number, or null)
- **THEN** `serializeError` SHALL return an object with a `message` property containing `String(value)`

#### Scenario: Usage in log calls
- **WHEN** a developer logs a caught error
- **THEN** they SHALL use `serializeError(error)` to extract the message rather than calling `.message` directly on the `unknown` value

### Requirement: Error response correctness

Route handlers SHALL NOT return success responses (2xx) with empty/fallback data when the actual cause is a server error.

#### Scenario: Image metadata read failure (not NotFound)
- **WHEN** reading image metadata fails with an error other than NotFound (e.g., corrupt JSON, I/O error)
- **THEN** the handler SHALL return 500 with a Problem Details response
- **AND** log the error server-side

#### Scenario: Plugin file serving failure (not NotFound)
- **WHEN** serving a plugin file fails with an error other than NotFound (e.g., permission denied)
- **THEN** the handler SHALL return 500 (not 404)
- **AND** log the error at warn level
