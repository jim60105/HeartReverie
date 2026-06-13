## ADDED Requirements

### Requirement: Structured Vento error is carried over the WebSocket chat:error envelope

When a chat generation initiated over WebSocket fails with a Vento template error (a `ChatError` whose `code === "vento"` carrying a structured `ventoError` payload), the server SHALL carry that structured payload to the client additively on the `chat:error` envelope. The `chat:error` variant of `WsServerMessage` SHALL be extended with an OPTIONAL field `ventoError?: Record<string, unknown>` holding the same structured error object the HTTP transport returns as its 422 `{ type: "vento-error", ... }` body. The envelope's `detail` field SHALL carry a short human-readable string (e.g. "Template rendering error"). This field is additive: existing WebSocket clients that ignore unknown fields SHALL be unaffected, and a future frontend consumer SHALL be able to render the same `VentoErrorCard` from the WebSocket payload that it renders from the HTTP 422 body. Both the WebSocket send and continue paths SHALL emit `ventoError` for vento errors via the shared `translateChatError` translator.

#### Scenario: WebSocket chat:error carries structured ventoError for a template error
- **WHEN** a WebSocket `chat:send` (or `chat:continue`) fails with a `ChatError("vento", …, 422, ventoError)`
- **THEN** the server SHALL emit `{ type: "chat:error", id, detail: <short string>, ventoError: <structured payload> }` where `ventoError` matches the structured object the HTTP transport returns in its 422 body

#### Scenario: Non-vento WebSocket errors omit ventoError
- **WHEN** a WebSocket chat round fails with a non-vento `ChatError` or an unexpected non-`ChatError` throw
- **THEN** the emitted `chat:error` envelope SHALL carry only `{ type, id, detail }` and SHALL NOT include a `ventoError` field

#### Scenario: Existing clients are unaffected by the additive field
- **WHEN** a client that does not recognize `ventoError` receives a `chat:error` envelope containing it
- **THEN** the client SHALL be able to process the message using only `type`, `id`, and `detail`, ignoring the unknown field
