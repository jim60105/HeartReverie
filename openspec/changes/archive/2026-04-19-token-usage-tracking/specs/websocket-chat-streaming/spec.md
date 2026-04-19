## MODIFIED Requirements

### Requirement: Chat send over WebSocket

An authenticated client SHALL send `{ type: "chat:send", id: string, series: string, story: string, message: string }` to initiate a chat message. The `id` field SHALL be a client-generated unique identifier for request-response correlation. The server SHALL process the message identically to the existing `POST /chat` endpoint: read the template, build the prompt, call the LLM API with `stream: true`, and write chunks to disk. In addition, each LLM delta chunk SHALL be sent to the WebSocket client as `{ type: "chat:delta", id, content }` immediately after writing to disk. When generation completes, the server SHALL send `{ type: "chat:done", id, usage: TokenUsageRecord | null }`, where `usage` is the token usage record appended to `_usage.json` for this generation (as defined in the `token-usage-tracking` capability), or `null` when the upstream LLM did not emit a `usage` object. If an error occurs, the server SHALL send `{ type: "chat:error", id, detail }`. The server SHALL create an `AbortController` for each generation and store it in a connection-scoped map keyed by the client-provided `id`, passing the controller's signal to the LLM fetch request. When the generation ends (by completion, error, or abort), the controller SHALL be removed from the map.

#### Scenario: `chat:done` includes usage when provider emits it
- **GIVEN** a successful generation where the upstream LLM emits `usage: { prompt_tokens, completion_tokens, total_tokens }`
- **WHEN** the server sends `chat:done`
- **THEN** the frame SHALL include a non-null `usage` field containing a `TokenUsageRecord` matching the record appended to `_usage.json`

#### Scenario: `chat:done` sets usage to null when provider omits it
- **GIVEN** a successful generation where the upstream LLM does not emit a `usage` object
- **WHEN** the server sends `chat:done`
- **THEN** the frame SHALL include `usage: null` and no record SHALL be appended to `_usage.json`

### Requirement: HTTP chat endpoint backward compatibility

The existing `POST /chat` HTTP endpoint SHALL remain functional. Clients that do not use WebSocket SHALL continue to send chat messages via HTTP. The endpoint SHALL NOT be deprecated in this change. The JSON response body SHALL include the existing `chapter` and `content` fields and SHALL additionally include `usage: TokenUsageRecord | null`, matching the record appended to `_usage.json` for this generation (or `null` when the upstream LLM did not emit usage).

#### Scenario: HTTP response includes usage when provider emits it
- **GIVEN** a successful HTTP chat request where the upstream LLM emits usage
- **WHEN** the server returns the JSON response
- **THEN** the body SHALL include `usage` set to the appended `TokenUsageRecord`

#### Scenario: HTTP response sets usage to null when provider omits it
- **GIVEN** a successful HTTP chat request where the upstream LLM omits usage
- **WHEN** the server returns the JSON response
- **THEN** the body SHALL include `usage: null` and no record SHALL be appended
