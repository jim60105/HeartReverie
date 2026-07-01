## MODIFIED Requirements

### Requirement: First-message authentication

The first message a client sends on a newly upgraded connection MUST be an `auth` message of the form `{ type: "auth", passphrase: string }`; any other message type before authentication is a protocol violation. The server SHALL validate the passphrase using timing-safe comparison (existing `@std/crypto/timing-safe-equal` utility). On success, the server SHALL respond with `{ type: "auth:ok" }` and mark the connection as authenticated. On failure, the server SHALL respond with `{ type: "auth:error", detail: string }` and close the connection with WebSocket close code 4001. A non-`auth` message received before authentication SHALL be rejected with `{ type: "error", detail: "Not authenticated" }` **and the server SHALL then close the connection with code 4001** — an unauthenticated connection SHALL NOT remain open after sending a non-`auth` message.

Before parsing any inbound message on an unauthenticated connection, the server SHALL enforce a small pre-auth message-payload byte cap, sized to the `auth` envelope with margin (the legitimate `auth` message is well under 1 KiB; the cap SHALL be a small fixed value with comfortable headroom). The cap is expressed in terms of the payload delivered to the message handler (the Deno adapter reassembles fragments at the message level), not individual wire frames. A pre-auth payload exceeding the cap SHALL cause the server to close the connection with code 1009 (Message Too Big) **before** `JSON.parse` is invoked, so an unauthenticated peer cannot force a large transient allocation. This guard is required because Hono's `bodyLimit` middleware does not apply to WebSocket payloads. The cap applies only before authentication; the existing post-auth message-length limit (`MAX_MESSAGE_LENGTH`) on the chat `message` field is unchanged.

The legitimate `auth` envelope is always a JSON **text** frame. Any **non-string** (binary — `Blob`, `ArrayBuffer`, or typed-array) pre-auth frame SHALL be rejected outright, closing the connection with code 1003 (Unsupported Data), **before** the byte-cap measurement. This is required for the byte cap to be sound: measuring the string length of a binary frame would under-count it (e.g. `String(blob)` yields `"[object Blob]"`), which would otherwise let a large binary payload bypass the cap.

#### Scenario: Valid passphrase authenticates connection
- **WHEN** the client sends `{ type: "auth", passphrase: "correct-passphrase" }` as its first message
- **THEN** the server SHALL respond with `{ type: "auth:ok" }` and the connection SHALL be marked as authenticated

#### Scenario: Invalid passphrase closes connection
- **WHEN** the client sends `{ type: "auth", passphrase: "wrong-passphrase" }` as its first message
- **THEN** the server SHALL respond with `{ type: "auth:error", detail: "Invalid passphrase" }` and close the connection with code 4001

#### Scenario: Non-auth message before authentication closes the socket
- **WHEN** the client sends `{ type: "chat:send", ... }` (or any non-`auth` type) before sending an auth message
- **THEN** the server SHALL respond with `{ type: "error", detail: "Not authenticated" }`, SHALL NOT process the message, **and SHALL close the connection with code 4001**

#### Scenario: Oversized pre-auth payload rejected before parsing
- **WHEN** an unauthenticated client sends a message payload whose byte length exceeds the pre-auth cap
- **THEN** the server SHALL close the connection with code 1009 without invoking `JSON.parse` on the payload

#### Scenario: Binary pre-auth frame rejected before size measurement
- **WHEN** an unauthenticated client sends a non-string (binary) frame of any size before authenticating
- **THEN** the server SHALL close the connection with code 1003 without measuring it against the string byte cap and without invoking `JSON.parse`, so a large binary payload cannot bypass the pre-auth cap

#### Scenario: A normal auth message is within the pre-auth cap
- **WHEN** an unauthenticated client sends a well-formed `{ type: "auth", passphrase: "…" }` message of realistic size
- **THEN** the payload SHALL be under the pre-auth cap and SHALL be parsed and processed normally

### Requirement: Connection lifecycle management

The server SHALL track active WebSocket connections. When a connection is closed (by client or server), the server SHALL clean up all associated state: authentication flag, active subscriptions, and any running chapter monitoring intervals. The server SHALL handle unexpected disconnections (e.g., network drops) gracefully — ongoing LLM generation SHALL continue writing to disk even if the WebSocket connection is lost.

The server SHALL enforce an **authentication deadline** on every newly upgraded connection: a connection that has not completed authentication within the deadline SHALL be closed with code 4002. An unauthenticated connection SHALL be governed **only** by this auth-deadline timer; the 60-second idle timer SHALL NOT run before authentication, so there is no overlap between the two and the close reason for an unauthenticated stall is deterministic (4002, auth deadline). Inbound messages received **before** authentication SHALL NOT reset the auth deadline, so an unauthenticated peer cannot keep a socket open indefinitely by sending periodic messages. On successful authentication the server SHALL clear the auth-deadline timer and start the existing 60-second idle timeout (reset by inbound activity), whose behavior for authenticated connections is otherwise unchanged.

The server SHALL enforce a global cap on the number of concurrent live WebSocket connections. The cap enforcement point SHALL be defined: when the live count is at the cap, the server SHALL refuse the new connection — rejecting the HTTP upgrade if the cap can be evaluated before the upgrade completes, otherwise accepting and then immediately closing with code 1013 (Try Again Later). The server SHALL maintain an accurate live-connection count using explicit per-connection accounting: a connection is counted exactly once upon admission (`counted`) and released exactly once (`released`) on its first close-or-error event, so that neither `onError`-followed-by-`onClose` ordering, nor an upgrade path that yields neither callback, can cause a leaked count (permanent denial) or a double release (negative count / cap bypass).

#### Scenario: Client disconnects during idle
- **WHEN** an authenticated client closes the WebSocket connection
- **THEN** the server SHALL clean up all subscriptions and monitoring intervals for that connection

#### Scenario: Client disconnects during LLM generation
- **WHEN** the WebSocket connection is lost while the server is streaming LLM output
- **THEN** the server SHALL continue writing LLM chunks to the chapter file on disk and SHALL NOT abort the generation

#### Scenario: Server detects stale connection
- **WHEN** an authenticated WebSocket connection has not sent any message (including pong) for 60 seconds
- **THEN** the server SHALL close the connection with code 4002 and clean up associated state

#### Scenario: Unauthenticated connection closed at the auth deadline despite pre-auth frames
- **WHEN** a connection is upgraded and the client sends only non-`auth` frames (or nothing) and never authenticates within the auth deadline
- **THEN** the server SHALL close the connection with code 4002 regardless of how many pre-auth frames were sent, because pre-auth frames do not reset the auth deadline

#### Scenario: Concurrent-connection cap rejects excess upgrades
- **WHEN** the number of live WebSocket connections is already at the configured cap and a new client attempts `GET /api/ws`
- **THEN** the server SHALL reject or immediately close the new connection (close code 1013) and SHALL NOT increase the live count beyond the cap

#### Scenario: Live count decrements on close so the cap recovers
- **WHEN** a connection that counted toward the cap is closed
- **THEN** the server SHALL decrement the live-connection count exactly once, allowing a subsequent upgrade to succeed

#### Scenario: Error-then-close releases the count exactly once
- **WHEN** a counted connection emits an `error` event and then a `close` event (or vice versa)
- **THEN** the server SHALL release the count exactly once across both events (idempotent release), and the live count SHALL NOT go negative or be double-decremented
