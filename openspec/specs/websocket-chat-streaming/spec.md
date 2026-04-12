# WebSocket Chat Streaming

## Purpose

Enables real-time bidirectional chat over WebSocket, with dual-write to disk and WebSocket for streaming LLM responses, while maintaining backward compatibility with the existing HTTP chat endpoint.

## Requirements

### Requirement: Chat send over WebSocket

An authenticated client SHALL send `{ type: "chat:send", id: string, series: string, story: string, message: string }` to initiate a chat message. The `id` field SHALL be a client-generated unique identifier for request-response correlation. The server SHALL process the message identically to the existing `POST /chat` endpoint: read the template, build the prompt, call the LLM API with `stream: true`, and write chunks to disk. In addition, each LLM delta chunk SHALL be sent to the WebSocket client as `{ type: "chat:delta", id, content }` immediately after writing to disk. When generation completes, the server SHALL send `{ type: "chat:done", id }`. If an error occurs, the server SHALL send `{ type: "chat:error", id, detail }`.

#### Scenario: Successful streaming chat over WebSocket
- **WHEN** the client sends `{ type: "chat:send", id: "msg-1", series: "s1", story: "n1", message: "走向藥妝店" }`
- **THEN** the server SHALL stream LLM deltas as `{ type: "chat:delta", id: "msg-1", content: "..." }` messages, write each chunk to the chapter file, and send `{ type: "chat:done", id: "msg-1" }` when complete

#### Scenario: Chat error returns error message
- **WHEN** the LLM API returns an error during WebSocket chat
- **THEN** the server SHALL send `{ type: "chat:error", id: "msg-1", detail: "LLM API error" }` and SHALL NOT close the WebSocket connection

#### Scenario: Request-response correlation
- **WHEN** the client sends a chat message with `id: "msg-1"`
- **THEN** all `chat:delta`, `chat:done`, and `chat:error` messages related to this request SHALL include `id: "msg-1"`

### Requirement: Chat resend over WebSocket

An authenticated client SHALL send `{ type: "chat:resend", id: string, series: string, story: string, message: string }` to delete the last chapter and re-send a message. The server SHALL first delete the last chapter file (equivalent to `DELETE /api/stories/:series/:name/chapters/last`), then process the chat message identically to `chat:send`. The same delta streaming and correlation rules SHALL apply.

#### Scenario: Resend deletes last chapter then streams
- **WHEN** the client sends `{ type: "chat:resend", id: "msg-2", series: "s1", story: "n1", message: "改去便利商店" }`
- **THEN** the server SHALL delete the last chapter file of story `n1`, then stream the new LLM response as `chat:delta` messages with `id: "msg-2"`, and finalize with `chat:done`

#### Scenario: Resend when no chapters exist
- **WHEN** the client sends `chat:resend` for a story with zero chapters
- **THEN** the server SHALL send `{ type: "chat:error", id, detail: "No chapters to delete" }` and SHALL NOT proceed with the chat

### Requirement: Dual-write file and WebSocket

During LLM generation initiated via WebSocket, the server SHALL perform dual-write for each SSE chunk from the upstream LLM: (1) write the chunk content to the chapter file on disk using the existing incremental `file.write()` pattern, then (2) send the chunk as a `chat:delta` WebSocket message. Both operations SHALL occur sequentially within the same async iteration of the SSE stream reader. If the WebSocket connection is lost during generation, the server SHALL continue writing to disk and silently skip WebSocket sends.

#### Scenario: Each chunk written to file and WebSocket
- **WHEN** the LLM streams a chunk "今天天氣很好"
- **THEN** the server SHALL first append "今天天氣很好" to the chapter file, then send `{ type: "chat:delta", id, content: "今天天氣很好" }` over WebSocket

#### Scenario: WebSocket lost during generation
- **WHEN** the WebSocket connection drops while the server is streaming LLM output
- **THEN** the server SHALL continue writing chunks to the chapter file and SHALL NOT throw errors for failed WebSocket sends

#### Scenario: Post-response hooks still execute
- **WHEN** LLM generation completes via WebSocket chat
- **THEN** the server SHALL execute all post-response hooks (e.g., state-patches plugin) identically to HTTP-initiated chat

### Requirement: HTTP chat endpoint backward compatibility

The existing `POST /chat` HTTP endpoint SHALL remain functional and unchanged. Clients that do not use WebSocket SHALL continue to send chat messages via HTTP. The endpoint SHALL NOT be deprecated in this change.

#### Scenario: HTTP chat still works
- **WHEN** a client sends `POST /chat` with appropriate headers and body
- **THEN** the server SHALL process the request identically to pre-WebSocket behavior, blocking until generation completes and returning the full response
