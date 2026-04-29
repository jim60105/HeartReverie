## MODIFIED Requirements

### Requirement: LLM API proxy

The server SHALL expose `POST /api/stories/:series/:name/chat` that accepts a JSON body with a `message` field. The server SHALL construct the prompt using the pipeline above, send it to the LLM API URL (configured via `LLM_API_URL` environment variable, defaulting to `https://openrouter.ai/api/v1/chat/completions`) using native `fetch` with `stream: true` in the request body, and write the assistant's response incrementally as the next numbered chapter file. The server SHALL use the `LLM_API_KEY` environment variable for authentication.

The server SHALL resolve the effective LLM configuration for each chat request by merging an env-derived `llmDefaults` object with the target story's validated `_config.json` overrides using `Object.assign({}, llmDefaults, storyOverrides)`. Merging SHALL happen per request so that edits to a story's `_config.json` take effect on the next chat without a server restart.

The `llmDefaults` object SHALL be built from the following environment variables (applied when the variable is unset or fails parsing, the field SHALL use the stated default): `LLM_MODEL` (default `deepseek/deepseek-v3.2`), `LLM_TEMPERATURE` (default `0.1`), `LLM_FREQUENCY_PENALTY` (default `0.13`), `LLM_PRESENCE_PENALTY` (default `0.52`), `LLM_TOP_K` (default `10`), `LLM_TOP_P` (default `0`), `LLM_REPETITION_PENALTY` (default `1.2`), `LLM_MIN_P` (default `0`), `LLM_TOP_A` (default `1`), `LLM_REASONING_ENABLED` (default `true`), `LLM_REASONING_EFFORT` (default `"high"`).

The server SHALL also read a separate, non-merged env var `LLM_REASONING_OMIT` (default `false`, parsed as a boolean per the rules below). When `LLM_REASONING_OMIT` resolves to `true`, the server SHALL omit the entire `reasoning` block from the upstream chat/completions request body, regardless of the merged `reasoningEnabled` / `reasoningEffort` values. This env var SHALL NOT be exposed in `_config.json`; it is a deployment-level switch only.

`LLM_REASONING_ENABLED` and `LLM_REASONING_OMIT` SHALL be parsed by a shared boolean parser with the rule: `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`; `"false" | "0" | "no" | "off"` (case-insensitive, trimmed) → `false`; the empty string or unset → the documented default; **any other non-empty string** SHALL fall back to the default AND the server SHALL emit a warning to the operational log naming the variable and the unrecognized value. `LLM_REASONING_EFFORT` SHALL be validated against the exact set `{"none", "minimal", "low", "medium", "high", "xhigh"}` (case-sensitive); any other value SHALL fall back to the default `"high"` and the server SHALL emit a warning log on startup.

`storyOverrides` SHALL be the validated partial subset of those same fields read from `playground/<series>/<story>/_config.json` (absent file ⇒ empty overrides). Only the whitelisted keys `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort` SHALL be honoured; unknown keys SHALL be ignored. Values whose type does not match the whitelist SHALL cause the request to fail with an RFC 9457 Problem Details error.

The merged configuration SHALL be used to populate the upstream request body (mapping camelCase fields to their OpenAI-compatible snake_case equivalents: `frequencyPenalty` → `frequency_penalty`, `presencePenalty` → `presence_penalty`, `topK` → `top_k`, `topP` → `top_p`, `repetitionPenalty` → `repetition_penalty`, `minP` → `min_p`, `topA` → `top_a`).

Additionally, the upstream request body SHALL include a `reasoning` object on every chat/completions request **except** when `LLM_REASONING_OMIT` is `true`, populated as follows:
- When the merged `reasoningEnabled` is `true`: `reasoning: { enabled: true, effort: <reasoningEffort> }`.
- When the merged `reasoningEnabled` is `false`: `reasoning: { enabled: false }` (the `effort` property SHALL be omitted).
- When `LLM_REASONING_OMIT` is `true`: the `reasoning` key SHALL NOT appear in the request body at all.

The upstream `fetch` call SHALL additionally attach three hard-coded OpenRouter app-attribution HTTP headers — `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2` (the UTF-8 percent-encoded form of `HeartReverie 浮心夜夢`), and `X-OpenRouter-Categories: roleplay,creative-writing` — alongside `Content-Type` and `Authorization`, on every chat request, regardless of the configured `LLM_API_URL`. The header values SHALL come from a single module-level frozen constant in `writer/lib/chat-shared.ts` and SHALL NOT be configurable at runtime (no env vars, no `_config.json` keys, no API surface). See the `openrouter-app-attribution` capability for the complete specification.

The upstream `fetch` call SHALL also accept an optional `signal: AbortSignal` parameter that is forwarded directly to `fetch()`. When the signal is aborted, both the initial fetch resolution and any in-flight SSE stream read SHALL be cancellable. The server SHALL discriminate aborts by inspecting `signal?.aborted === true` rather than by inspecting the thrown error's class or `name`, so that the dedicated abort branch (close chapter file → log abort → throw `ChatAbortError`) runs regardless of whether the abort reason is a `DOMException`, a custom `Error`, a `ChatAbortError`, or undefined. The HTTP route SHALL pass `c.req.raw.signal`; the WebSocket route SHALL pass a per-request `AbortController.signal`. See the `streaming-cancellation` capability for the complete cancellation contract.

The SSE parser SHALL detect mid-stream provider errors per OpenRouter's documented format: after parsing each `data:` payload as a JSON object, the parser SHALL inspect `parsed.error` (any non-null object value) and `parsed.choices?.[0]?.finish_reason === "error"`. If either signal is present, the parser SHALL log one LLM-interaction-log entry with `errorCode: "stream-error"`, close the chapter file via the existing `finally` block (preserving any partial content), and throw `ChatError("llm-stream", <provider message>, 502)`. The HTTP route SHALL convert this into a 502 RFC 9457 Problem Details response; the WebSocket route SHALL convert it into `{ type: "chat:error", id, detail }`. Mid-stream errors SHALL NOT be silently swallowed.

When the upstream provider returns a non-2xx status, the server SHALL include the upstream response body (truncated if very large) in both the operational log entry AND in the `detail` field of the RFC 9457 Problem Details response returned to the client, so that a strict provider rejecting the `reasoning` field is diagnosable end-to-end.

The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

In addition to `delta.content`, the SSE parser SHALL inspect each parsed chunk for upstream reasoning text via `choices[0].delta.reasoning` (preferred) and `choices[0].delta.reasoning_details[].text` (fallback), and SHALL stream that reasoning text into the chapter file framed by `<think>` and `</think>` tags placed between the `<user_message>` block and the model content. Reasoning text SHALL NOT be appended to the `aiContent` accumulator returned in the HTTP response body's `content` field, and SHALL NOT be passed through the `response-stream` plugin hook. The chapter file on disk SHALL therefore contain a superset of the response envelope's `content` field for any turn that emitted reasoning. See the `reasoning-think-block` capability for the complete state-machine and field-extraction contract.

The operational debug log entry and the LLM interaction log entry produced for each chat request SHALL include the resolved values of `reasoningEnabled` and `reasoningEffort` alongside the existing sampler parameters. The LLM interaction log entry SHALL additionally carry an optional `reasoningLength` field whose value is the total character count of reasoning text streamed during the turn (success, abort, and mid-stream-error log entries alike), per the `reasoning-think-block` capability.

#### Scenario: Successful streaming chat completion

- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a valid message
- **THEN** the server SHALL call the LLM API with `stream: true`, create the next sequential chapter file (e.g., `002.md` if `001.md` exists), write the user message wrapped in `<user_message>` tags at the top of the file, then write each content delta to the file as it arrives from the SSE stream, and return the chapter number and complete content in the response after the stream finishes

#### Scenario: User message persisted before AI content

- **WHEN** the server begins writing a new chapter file during a chat request
- **THEN** the chapter file SHALL contain `<user_message>\n{message}\n</user_message>\n\n` at the beginning, followed by the AI response content

#### Scenario: Reasoning text persisted into chapter file `<think>` block

- **GIVEN** a chat request to a model that emits OpenRouter `delta.reasoning` deltas before its content deltas
- **WHEN** the SSE stream completes
- **THEN** the chapter file on disk SHALL contain `<user_message>\n{message}\n</user_message>\n\n<think>\n{reasoning text}\n</think>\n\n{model content}` in that exact byte order, AND the HTTP response body's `content` field SHALL contain `<user_message>\n{message}\n</user_message>\n\n{model content}` (i.e. the response envelope SHALL include the `<user_message>` block and model content but EXCLUDE the `<think>` block, while the chapter file on disk preserves all three)
