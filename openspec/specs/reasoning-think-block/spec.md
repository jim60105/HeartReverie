# Reasoning Think Block

## Purpose

Defines how upstream LLM reasoning text deltas are extracted from SSE chunks and streamed into chapter files framed by `<think>...</think>` tags, while keeping reasoning text out of the HTTP response envelope, the `aiContent` accumulator, and the `response-stream` plugin hook chain.

## Requirements

### Requirement: Reasoning text streamed into chapter `<think>` block

The chat execution function (`executeChat()` in `writer/lib/chat-shared.ts`) SHALL inspect each parsed SSE chunk for reasoning text from the upstream LLM and SHALL stream it into the chapter file framed by `<think>` and `</think>` tags. Reasoning text SHALL be extracted from the parsed delta object using the following priority order, per chunk:

1. If `parsed.choices[0].delta.reasoning` is a string with length > 0, that string is the chunk's reasoning text.
2. Otherwise, if `parsed.choices[0].delta.reasoning_details` is an array, the chunk's reasoning text is the in-order concatenation of every element's `text` property where `typeof element.text === "string" && element.text.length > 0`. Elements without a string `text` (e.g. items containing only `signature` or `format` fields) SHALL be skipped without error.
3. Otherwise, the chunk has no reasoning text.

The chapter file format SHALL be:

```
<user_message>
{user message}
</user_message>

<think>
{streamed reasoning text}
</think>

{streamed model content}
```

The leading `<user_message>...</user_message>\n\n` block is produced by the existing `user-message` plugin's `pre-write` hook and SHALL be unchanged. The `<think>...</think>\n\n` block SHALL be inserted between the closing `</user_message>` and the model content. Models or providers that emit no reasoning text SHALL produce a chapter file with no `<think>` block at all (i.e. the chapter file SHALL be byte-identical to today's format for non-reasoning turns).

#### Scenario: Reasoning text written before content text

- **GIVEN** the upstream LLM streams two SSE chunks `data: {"choices":[{"delta":{"reasoning":"Let me think. "}}]}` and `data: {"choices":[{"delta":{"reasoning":"Three r's."}}]}`, then two chunks `data: {"choices":[{"delta":{"content":"There are "}}]}` and `data: {"choices":[{"delta":{"content":"three r's."}}]}`, then `data: [DONE]`
- **WHEN** `executeChat()` processes the stream
- **THEN** the chapter file SHALL contain (in this exact byte order) `<user_message>\n{message}\n</user_message>\n\n<think>\nLet me think. Three r's.\n</think>\n\nThere are three r's.`

#### Scenario: Reasoning text via reasoning_details fallback

- **GIVEN** the upstream LLM streams `data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"Counting letters."},{"type":"reasoning.signature","signature":"abc"}]}}]}` followed by a content chunk and `[DONE]`
- **WHEN** `executeChat()` processes the stream and `delta.reasoning` is absent
- **THEN** the chapter file `<think>` block SHALL contain `Counting letters.` (the signature item is silently skipped, no error is logged)

#### Scenario: No reasoning emitted produces no `<think>` block

- **GIVEN** an upstream LLM that emits only `delta.content` chunks (no `delta.reasoning`, no `delta.reasoning_details`)
- **WHEN** `executeChat()` processes the stream
- **THEN** the chapter file SHALL contain no `<think>` opening tag, no `</think>` closing tag, and SHALL be byte-identical to the pre-change chapter file format for that prompt/response pair

### Requirement: `<think>` state machine handles open/close transitions

The chat execution function SHALL maintain a single `inThinkBlock: boolean` flag, initially `false`. State transitions per SSE chunk SHALL be (byte sequences are exact):

- Reasoning text observed AND `inThinkBlock === false`: write the bytes `<think>\n` followed by the reasoning text to the chapter file, then set `inThinkBlock = true`.
- Reasoning text observed AND `inThinkBlock === true`: write the reasoning text bytes only (no opener).
- Content delta observed AND `inThinkBlock === true`: write the bytes `\n</think>\n\n` to the chapter file (a leading `\n` ensures `</think>` sits on its own line even when the last reasoning byte was not a newline), set `inThinkBlock = false`, then process the content delta through the existing `persistChunk` path (which dispatches the `response-stream` hook and writes the transformed content bytes).
- Content delta observed AND `inThinkBlock === false`: process the content delta through `persistChunk` as today.

Within a single SSE chunk that contains both `delta.reasoning` (or `reasoning_details`) AND `delta.content`, the reasoning text SHALL be written first, then the `\n</think>\n\n` closer SHALL be emitted, then the content delta SHALL be processed.

The `inThinkBlock` flag SHALL be checked in the streaming `finally` block (the same `finally` that calls `file.close()`); if it is `true` at that point, the bytes `\n</think>\n` SHALL be written to the chapter file before `file.close()` runs (one trailing newline because nothing follows in the chapter). This SHALL apply on every exit path: clean stream completion, client abort (`ChatAbortError`), mid-stream provider error (`ChatError("llm-stream", ...)`), and any other thrown error escaping the streaming loop.

The cleanup write SHALL be wrapped in a nested try/finally so that a thrown closer-write or `onDelta` error does NOT mask the primary error from the streaming loop and does NOT prevent `file.close()` from running. A failed cleanup SHALL be logged at WARN level and otherwise suppressed.

#### Scenario: Interleaved reasoning and content emit multiple `<think>` blocks

- **GIVEN** the upstream LLM emits chunks in this order: `reasoning:"A"`, `content:"X"`, `reasoning:"B"`, `content:"Y"`, then `[DONE]`
- **WHEN** `executeChat()` processes the stream
- **THEN** the chapter file SHALL contain (after the `<user_message>` block) `<think>\nA\n</think>\n\nX<think>\nB\n</think>\n\nY` — i.e. each contiguous reasoning burst gets its own `<think>...</think>\n\n` block

#### Scenario: Single SSE chunk carrying both reasoning and content

- **GIVEN** the upstream LLM emits one chunk `data: {"choices":[{"delta":{"reasoning":"A","content":"X"}}]}` followed by `[DONE]`
- **WHEN** `executeChat()` processes the chunk
- **THEN** the chapter file SHALL contain (after the `<user_message>` block) `<think>\nA\n</think>\n\nX` — reasoning first, then close, then content. `onDelta` SHALL receive bytes in that exact order.

#### Scenario: Reasoning-only stream is treated as no-content error

- **GIVEN** the upstream LLM emits two reasoning chunks then `[DONE]` (zero content chunks)
- **WHEN** `executeChat()` processes the stream
- **THEN** the streaming `finally` SHALL detect `inThinkBlock === true` and write `\n</think>\n` before `file.close()`; the chapter file on disk SHALL be syntactically valid (`<user_message>...</user_message>\n\n<think>\n...\n</think>\n`); `executeChat()` SHALL throw `ChatError("no-content", ..., 502)` exactly as it does today; the LLM-interaction-log entry SHALL include `reasoningLength` matching the streamed reasoning text length

#### Scenario: Abort during reasoning closes the `<think>` block

- **GIVEN** the upstream LLM has streamed one reasoning chunk and the chapter file currently contains `<user_message>...</user_message>\n\n<think>\n<partial>` on disk
- **WHEN** `signal.aborted === true` triggers the narrowed abort catch around `reader.read()` (per the `streaming-cancellation` capability)
- **THEN** the streaming `finally` SHALL write `\n</think>\n` (wrapped in nested try/finally so a write failure cannot mask `ChatAbortError` nor prevent `file.close()`), then `file.close()` SHALL run, then the dedicated abort cleanup branch SHALL emit the LLM-interaction-log entry and `ChatAbortError` SHALL be thrown — leaving on disk a complete `<user_message>...</user_message>\n\n<think>\n<partial>\n</think>\n` chapter file. `onDelta` SHALL have received the `\n</think>\n` cleanup bytes before the abort propagates.

#### Scenario: Mid-stream error during reasoning closes the `<think>` block

- **GIVEN** the upstream LLM has streamed one reasoning chunk and then a chunk whose `error` field is populated (per the `streaming-cancellation` capability's mid-stream-error requirement)
- **WHEN** `handlePayload` throws `ChatError("llm-stream", <provider message>, 502)`
- **THEN** the streaming `finally` SHALL write `\n</think>\n` (with the same nested-try/finally protection), then `file.close()` SHALL run, then the `ChatError` SHALL propagate to the route handler — leaving on disk a complete `<user_message>...</user_message>\n\n<think>\n<partial>\n</think>\n` chapter file

### Requirement: Reasoning text bypasses content hooks and `aiContent`

Reasoning text deltas SHALL NOT be passed through the `response-stream` hook. Reasoning text SHALL NOT be appended to the `aiContent` accumulator (the internal "transformed model answer" buffer that is concatenated with `preContent` to form `ChatResult.content`). Plugin handlers registered for the `post-response` hook SHALL therefore observe the same `content` value they observe today (the `<user_message>` block plus the model's content text), with no `<think>` markup and no reasoning text.

The public `ChatResult.content` field returned to route handlers SHALL be `preContent + aiContent` exactly as today — meaning it CONTINUES to include the `<user_message>` block produced by `pre-write` hooks, but SHALL NOT include any `<think>` markup or reasoning text. The HTTP `POST /chat` response body's `content` field is the same string. The chapter file on disk SHALL therefore contain MORE bytes than `ChatResult.content` for any turn that emitted reasoning (the disk file additionally contains the `<think>` block), and the chapter file SHALL be the source of truth for cross-turn prompt construction.

Reasoning text deltas SHALL be forwarded to the `onDelta` callback (when provided) in the same byte-by-byte order they are written to the chapter file, including the `<think>\n` opener and the `\n</think>\n\n` (or `\n</think>\n` finally-cleanup) closer. This ensures that the WebSocket `chat:delta` envelope carries the full chapter-file-equivalent stream and the frontend `thinking` plugin's `frontend-render` hook can fold reasoning live as it streams.

#### Scenario: `ChatResult.content` envelope excludes `<think>` text but includes `<user_message>`

- **GIVEN** a chat turn that streamed both reasoning text `A` and content `X`, producing a chapter file containing `<user_message>\n{message}\n</user_message>\n\n<think>\nA\n</think>\n\nX`
- **WHEN** the HTTP route handler responds with the JSON completion envelope
- **THEN** the response body's `content` field SHALL be `<user_message>\n{message}\n</user_message>\n\nX` (or whatever the `response-stream` hook chain transformed `X` into) — it SHALL include the `<user_message>` block and the model content, but SHALL NOT contain `<think>`, the reasoning text `A`, or the closing tag

#### Scenario: `response-stream` hook is not dispatched for reasoning

- **GIVEN** a `response-stream` hook handler that mutates `context.chunk` to uppercase any chunk it receives (e.g. via the context-compaction or a test plugin)
- **WHEN** a reasoning delta with text `"thinking..."` is processed by `executeChat()`
- **THEN** the chapter file SHALL contain `thinking...` (lowercase) inside the `<think>` block — the hook SHALL NOT have been invoked for the reasoning delta. Subsequent content deltas SHALL still be passed through the hook as today.

#### Scenario: WebSocket / `onDelta` receives reasoning bytes verbatim

- **GIVEN** a chat turn whose first reasoning delta is the string `"think1"` and whose first content delta is `"answer1"`
- **WHEN** the WebSocket `onDelta` callback is provided to `executeChat()`
- **THEN** `onDelta` SHALL be invoked at least once with `"<think>\n"` + `"think1"` content (potentially split across calls), then with `"\n</think>\n\n"`, then with `"answer1"` (potentially as multiple `chat:delta` envelopes)

### Requirement: Reasoning length recorded in LLM interaction log

The LLM interaction log entry written when a chat completes (whether successfully, by abort, by no-content, or by mid-stream error) SHALL include an optional numeric field `reasoningLength` carrying the total UTF-16 code-unit count (`string.length` in JavaScript) of reasoning text streamed during the turn — i.e. the sum of all extracted reasoning text lengths, NOT including the `<think>\n` and `\n</think>\n\n` framing. This field SHALL parallel the existing `aiContentLength` semantics. When no reasoning text was streamed, the field SHALL be `0` (or omitted at the implementation's discretion, but SHALL NOT be `null` or `undefined` if present).

#### Scenario: Successful turn with reasoning logs reasoningLength

- **GIVEN** a successful chat turn that streamed 42 characters of reasoning text and 100 characters of model content
- **WHEN** the success log entry is emitted
- **THEN** the entry SHALL include `reasoningLength: 42` (or omit the field if zero, but it SHALL NOT be set to `null`)

#### Scenario: Abort during reasoning logs partial reasoningLength

- **GIVEN** a chat turn that streamed 17 characters of reasoning text before the client aborted
- **WHEN** the abort log entry is emitted
- **THEN** the entry SHALL include `reasoningLength: 17` alongside the existing `aborted: true`, `latencyMs`, and `partialLength` fields
