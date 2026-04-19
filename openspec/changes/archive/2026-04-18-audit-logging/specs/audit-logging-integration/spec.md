## ADDED Requirements

### Requirement: LLM request/response logging

The chat execution logic SHALL log every LLM API call. At `info` level: model name, token counts (prompt/completion/total), latency in ms, and HTTP status. At `debug` level: additionally log the full system prompt, user message, model parameters, and complete response content.

#### Scenario: Info-level LLM logging
- **WHEN** an LLM API call completes successfully and `LOG_LEVEL` is `info`
- **THEN** the logger SHALL emit an info entry with category `"llm"` containing: model, latency_ms, status, and token counts (if provided by the API)

#### Scenario: Debug-level LLM logging
- **WHEN** an LLM API call completes and `LOG_LEVEL` is `debug`
- **THEN** the logger SHALL additionally emit a debug entry with the full request body (messages array, all parameters) and the full response content

#### Scenario: LLM error logging
- **WHEN** an LLM API call returns a non-OK HTTP status
- **THEN** the logger SHALL emit an error entry with category `"llm"` containing: status code, error body, model, and latency_ms

### Requirement: File operation logging

All file system operations performed by the backend (chapter writes, chapter deletes, story directory creation, prompt file saves, lore passage writes/deletes) SHALL be logged at `info` level with category `"file"`. Each entry SHALL include: operation type (`write`, `delete`, `mkdir`), file path, and content length (for writes). This covers: `writer/lib/chat-shared.ts`, `writer/lib/story.ts`, `writer/routes/chapters.ts`, `writer/routes/prompt.ts`, and `writer/routes/lore.ts`.

#### Scenario: Chapter write logged
- **WHEN** a new chapter file is written during chat execution
- **THEN** the logger SHALL emit an info entry with `{ category: "file", data: { op: "write", path: "...", bytes: N } }`

#### Scenario: Chapter delete logged
- **WHEN** a chapter file is deleted during resend
- **THEN** the logger SHALL emit an info entry with `{ category: "file", data: { op: "delete", path: "..." } }`

#### Scenario: Lore passage write logged
- **WHEN** a lore passage is created or updated via the API
- **THEN** the logger SHALL emit an info entry with `{ category: "file", data: { op: "write", path: "...", bytes: N } }`

#### Scenario: Prompt file save logged
- **WHEN** the prompt template is saved via the API
- **THEN** the logger SHALL emit an info entry with `{ category: "file", data: { op: "write", path: "...", bytes: N } }`

### Requirement: Template rendering logging

Template rendering (system prompt generation) SHALL be logged. At `info` level: template path, number of variables resolved, render latency. At `debug` level: additionally log the full rendered output and all template variables.

#### Scenario: Template render info logging
- **WHEN** a system prompt template is rendered
- **THEN** the logger SHALL emit an info entry with category `"template"` containing: template path, variable count, and latency_ms

#### Scenario: Template render debug logging
- **WHEN** template is rendered and `LOG_LEVEL` is `debug`
- **THEN** the logger SHALL additionally emit a debug entry with the full rendered prompt text and all template variable names/values

#### Scenario: Template error logging
- **WHEN** template rendering produces a Vento error
- **THEN** the logger SHALL emit an error entry with category `"template"` containing the error details

### Requirement: Plugin hook dispatch logging

Every plugin hook dispatch SHALL be logged at `debug` level with category `"plugin"`. The entry SHALL include: hook stage name, number of handlers called, total dispatch latency, and plugin names that handled the hook.

#### Scenario: Hook dispatch logged
- **WHEN** a backend hook is dispatched (e.g., `prompt-assembly`, `pre-write`, `post-response`)
- **THEN** the logger SHALL emit a debug entry with `{ category: "plugin", data: { stage: "...", handlers: N, plugins: [...], latency_ms: N } }`

### Requirement: Authentication logging

Authentication attempts SHALL be logged at `info` level with category `"auth"`. Successful attempts log source (HTTP/WebSocket). Failed attempts log source and are tagged at `warn` level.

#### Scenario: Successful auth logged
- **WHEN** a valid passphrase is provided via HTTP header or WebSocket first message
- **THEN** the logger SHALL emit an info entry with `{ category: "auth", data: { success: true, source: "http"|"ws" } }`

#### Scenario: Failed auth logged
- **WHEN** an invalid passphrase is provided
- **THEN** the logger SHALL emit a warn entry with `{ category: "auth", data: { success: false, source: "http"|"ws" } }`

### Requirement: WebSocket lifecycle logging

WebSocket connections SHALL be logged at `info` level with category `"ws"`. Events logged: connection established, authenticated, message received (type only), connection closed (code, reason), idle timeout.

#### Scenario: WebSocket connection logged
- **WHEN** a WebSocket connection is established
- **THEN** the logger SHALL emit an info entry with `{ category: "ws", data: { event: "connected" } }`

#### Scenario: WebSocket message logged
- **WHEN** a WebSocket message is received from the client
- **THEN** the logger SHALL emit a debug entry with `{ category: "ws", data: { event: "message", type: "chat:send"|... } }`

#### Scenario: WebSocket close logged
- **WHEN** a WebSocket connection is closed
- **THEN** the logger SHALL emit an info entry with `{ category: "ws", data: { event: "closed", code: N, reason: "..." } }`

### Requirement: HTTP request logging

Each HTTP request SHALL be logged at `info` level with category `"http"`. The entry SHALL include: method, path, status code, and latency_ms. Request bodies SHALL NOT be logged at info level (only at debug level for non-sensitive endpoints).

#### Scenario: HTTP request logged
- **WHEN** an HTTP request completes
- **THEN** the logger SHALL emit an info entry with `{ category: "http", data: { method: "POST", path: "/api/stories/...", status: 200, latency_ms: N } }`

### Requirement: Replace existing console calls

All existing `console.log`, `console.error`, and `console.warn` calls in the `writer/` directory SHALL be replaced with equivalent structured logger calls using appropriate categories and levels.

#### Scenario: No bare console calls remain
- **WHEN** inspecting the `writer/` source directory (excluding test files)
- **THEN** no direct `console.log`, `console.error`, or `console.warn` calls SHALL exist; all logging SHALL go through the structured logger
