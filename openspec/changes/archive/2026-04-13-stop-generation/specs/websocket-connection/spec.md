## MODIFIED Requirements

### Requirement: JSON message protocol

All WebSocket messages SHALL be JSON text frames with a `type` string field as the discriminator. Client-to-server message types SHALL be: `auth`, `chat:send`, `chat:resend`, `chat:abort`, `subscribe`. Server-to-client message types SHALL be: `auth:ok`, `auth:error`, `chat:delta`, `chat:done`, `chat:error`, `chat:aborted`, `chapters:updated`, `chapters:content`, `error`. Messages with unknown `type` values SHALL be silently ignored (no error response).

#### Scenario: Valid message parsed and dispatched
- **WHEN** the server receives `{ type: "subscribe", series: "s1", story: "n1" }`
- **THEN** the server SHALL parse the JSON, identify the message type as `subscribe`, and dispatch to the subscription handler

#### Scenario: Unknown message type ignored
- **WHEN** the server receives `{ type: "unknown-type", data: "foo" }`
- **THEN** the server SHALL silently ignore the message without sending an error response or closing the connection

#### Scenario: Malformed JSON rejected
- **WHEN** the server receives a non-JSON text frame (e.g., `not valid json`)
- **THEN** the server SHALL respond with `{ type: "error", detail: "Invalid JSON" }` and SHALL NOT close the connection

#### Scenario: Abort message dispatched to handler
- **WHEN** the server receives `{ type: "chat:abort", id: "msg-1" }` while a generation with `id: "msg-1"` is active
- **THEN** the server SHALL parse the JSON, identify the message type as `chat:abort`, and dispatch to the abort handler
