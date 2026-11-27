# Spec Delta

## MODIFIED Requirements

### Requirement: Reasoning text streamed into chapter `<think>` block

The chat execution function (`executeChat()` in `writer/lib/chat-shared.ts`) SHALL inspect each parsed SSE chunk for reasoning text from the upstream LLM and SHALL stream it into the chapter file framed by `<think>` and `</think>` tags. Reasoning text SHALL be extracted from the parsed delta object using the following priority order, per chunk:

1. If `parsed.choices[0].delta.reasoning` is a string with length > 0, that string is the chunk's reasoning text.
2. Otherwise, if `parsed.choices[0].delta.reasoning_content` is a string with length > 0, that string is the chunk's reasoning text.
3. Otherwise, if `parsed.choices[0].delta.reasoning_details` is an array, the chunk's reasoning text is the in-order concatenation of every element's `text` property where `typeof element.text === "string" && element.text.length > 0`. Elements without a string `text` (e.g. items containing only `signature` or `format` fields) SHALL be skipped without error.
4. Otherwise, the chunk has no reasoning text.

This priority order applies to the Chat Completions transport. On the Responses transport, reasoning text comes from the reasoning events defined by the `llm-api-transport` capability and SHALL use the same `<think>` framing.

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

#### Scenario: Reasoning text via reasoning_content
- **GIVEN** the upstream LLM streams `data: {"choices":[{"delta":{"reasoning_content":"Thinking."}}]}` followed by `data: {"choices":[{"delta":{"content":"Answer."}}]}` and `[DONE]` over Chat Completions
- **WHEN** `executeChat()` processes the stream and `delta.reasoning` is absent
- **THEN** the chapter file SHALL contain `<think>\nThinking.\n</think>\n\nAnswer.` after the user-message block
