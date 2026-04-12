# WebSocket Connection

## Purpose

Provides a persistent WebSocket connection between the frontend and backend for real-time bidirectional communication, including first-message authentication, a JSON message protocol, connection lifecycle management, and story subscription for chapter updates.

## Requirements

### Requirement: WebSocket upgrade endpoint

The backend SHALL expose a WebSocket upgrade endpoint at `GET /api/ws` using Hono's `upgradeWebSocket()` helper from `hono/deno`. The endpoint SHALL upgrade the HTTP connection to a WebSocket connection. The endpoint SHALL NOT require authentication headers on the upgrade request itself — authentication is handled via the first WebSocket message.

#### Scenario: Successful WebSocket upgrade
- **WHEN** a client sends a GET request to `/api/ws` with appropriate WebSocket upgrade headers
- **THEN** the server SHALL upgrade the connection to a WebSocket and keep it open awaiting the authentication message

#### Scenario: Non-WebSocket request to upgrade endpoint
- **WHEN** a client sends a regular HTTP GET to `/api/ws` without WebSocket upgrade headers
- **THEN** the server SHALL return HTTP 426 Upgrade Required

### Requirement: First-message authentication

The server SHALL require the client to send `{ type: "auth", passphrase: string }` as its first WebSocket message. The server SHALL validate the passphrase using timing-safe comparison (existing `@std/crypto/timing-safe-equal` utility). On success, the server SHALL respond with `{ type: "auth:ok" }` and mark the connection as authenticated. On failure, the server SHALL respond with `{ type: "auth:error", detail: string }` and close the connection with WebSocket close code 4001. Any non-auth message received before authentication SHALL be rejected with `{ type: "error", detail: "Not authenticated" }`.

#### Scenario: Valid passphrase authenticates connection
- **WHEN** the client sends `{ type: "auth", passphrase: "correct-passphrase" }` as its first message
- **THEN** the server SHALL respond with `{ type: "auth:ok" }` and the connection SHALL be marked as authenticated

#### Scenario: Invalid passphrase closes connection
- **WHEN** the client sends `{ type: "auth", passphrase: "wrong-passphrase" }` as its first message
- **THEN** the server SHALL respond with `{ type: "auth:error", detail: "Invalid passphrase" }` and close the connection with code 4001

#### Scenario: Non-auth message before authentication
- **WHEN** the client sends `{ type: "chat:send", ... }` before sending an auth message
- **THEN** the server SHALL respond with `{ type: "error", detail: "Not authenticated" }` and SHALL NOT process the message

### Requirement: JSON message protocol

All WebSocket messages SHALL be JSON text frames with a `type` string field as the discriminator. Client-to-server message types SHALL be: `auth`, `chat:send`, `chat:resend`, `subscribe`. Server-to-client message types SHALL be: `auth:ok`, `auth:error`, `chat:delta`, `chat:done`, `chat:error`, `chapters:updated`, `chapters:content`, `error`. Messages with unknown `type` values SHALL be silently ignored (no error response).

#### Scenario: Valid message parsed and dispatched
- **WHEN** the server receives `{ type: "subscribe", series: "s1", story: "n1" }`
- **THEN** the server SHALL parse the JSON, identify the message type as `subscribe`, and dispatch to the subscription handler

#### Scenario: Unknown message type ignored
- **WHEN** the server receives `{ type: "unknown-type", data: "foo" }`
- **THEN** the server SHALL silently ignore the message without sending an error response or closing the connection

#### Scenario: Malformed JSON rejected
- **WHEN** the server receives a non-JSON text frame (e.g., `not valid json`)
- **THEN** the server SHALL respond with `{ type: "error", detail: "Invalid JSON" }` and SHALL NOT close the connection

### Requirement: Connection lifecycle management

The server SHALL track active WebSocket connections. When a connection is closed (by client or server), the server SHALL clean up all associated state: authentication flag, active subscriptions, and any running chapter monitoring intervals. The server SHALL handle unexpected disconnections (e.g., network drops) gracefully — ongoing LLM generation SHALL continue writing to disk even if the WebSocket connection is lost.

#### Scenario: Client disconnects during idle
- **WHEN** an authenticated client closes the WebSocket connection
- **THEN** the server SHALL clean up all subscriptions and monitoring intervals for that connection

#### Scenario: Client disconnects during LLM generation
- **WHEN** the WebSocket connection is lost while the server is streaming LLM output
- **THEN** the server SHALL continue writing LLM chunks to the chapter file on disk and SHALL NOT abort the generation

#### Scenario: Server detects stale connection
- **WHEN** a WebSocket connection has not sent any message (including pong) for 60 seconds
- **THEN** the server SHALL close the connection with code 4002 and clean up associated state

### Requirement: Story subscription

An authenticated client SHALL send `{ type: "subscribe", series: string, story: string }` to subscribe to chapter updates for a specific story. The server SHALL start a 1-second polling interval to monitor the story's chapter directory for new files. When the chapter count changes, the server SHALL push `{ type: "chapters:updated", series, story, count }`. When the last chapter's content changes, the server SHALL push `{ type: "chapters:content", series, story, chapter, content }`. Only one subscription SHALL be active per connection — a new `subscribe` message SHALL replace the previous subscription.

#### Scenario: Subscribe to chapter updates
- **WHEN** an authenticated client sends `{ type: "subscribe", series: "s1", story: "n1" }`
- **THEN** the server SHALL start monitoring the chapter directory for `s1/n1` and push update messages when changes are detected

#### Scenario: New chapter detected via server polling
- **WHEN** a new chapter file appears in the monitored story directory
- **THEN** the server SHALL push `{ type: "chapters:updated", series: "s1", story: "n1", count: 6 }` within 1 second

#### Scenario: Subscription replacement
- **WHEN** a client sends `subscribe` for story A, then sends `subscribe` for story B
- **THEN** the server SHALL stop monitoring story A and start monitoring story B; only story B updates SHALL be pushed
