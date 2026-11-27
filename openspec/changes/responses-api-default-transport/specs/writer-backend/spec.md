# Spec Delta

## MODIFIED Requirements

### Requirement: LLM API proxy

The server SHALL expose `POST /api/stories/:series/:name/chat` that accepts a JSON body with a `message` field. The server SHALL construct the prompt using the pipeline above, send it to the upstream endpoint selected per the `llm-api-transport` capability (`<LLM_API_BASE_URL>/responses` by default with fallback to `<LLM_API_BASE_URL>/chat/completions`, where the `LLM_API_BASE_URL` environment variable defaults to `https://openrouter.ai/api/v1`) using native `fetch` with `stream: true` in the request body, and write the assistant's response incrementally as the next numbered chapter file. When the `LLM_API_KEY` environment variable is set to a non-empty value, the server SHALL attach an `Authorization: Bearer <key>` header to the upstream request. When `LLM_API_KEY` is unset or empty, the `Authorization` header SHALL be omitted entirely so that keyless local or private LLM providers (e.g. Ollama, vLLM, LM Studio) work without a key, and the chat flow SHALL NOT fail with HTTP 500 for the missing key.

The server SHALL resolve the effective LLM configuration for each chat request by merging an env-derived `llmDefaults` object with the target story's validated `_config.json` overrides using `Object.assign({}, llmDefaults, storyOverrides)`. Merging SHALL happen per request so that edits to a story's `_config.json` take effect on the next chat without a server restart.

The `llmDefaults` object SHALL be built from the following environment variables (applied when the variable is unset or fails parsing, the field SHALL use the stated default): `LLM_MODEL` (default `deepseek/deepseek-v4-pro`), `LLM_TEMPERATURE` (default `0.1`), `LLM_FREQUENCY_PENALTY` (default `0.13`), `LLM_PRESENCE_PENALTY` (default `0.52`), `LLM_TOP_K` (default `10`), `LLM_TOP_P` (default `0`), `LLM_REPETITION_PENALTY` (default `1.2`), `LLM_MIN_P` (default `0`), `LLM_TOP_A` (default `1`), `LLM_REASONING_ENABLED` (default `true`), `LLM_REASONING_EFFORT` (default `"xhigh"`), `LLM_MAX_COMPLETION_TOKENS` (**default `null`** — meaning "no application-level limit; let the provider decide").

`LLM_MAX_COMPLETION_TOKENS` SHALL be parsed by a dedicated positive-safe-integer-or-null parser. The rule SHALL be: trim the raw string; if the trimmed value is empty (i.e. unset / empty / whitespace-only), the parsed result SHALL be `null` with no warning. Otherwise, the trimmed string SHALL be required to fully match `^[1-9]\d*$` (no leading zeros, no sign, no decimal point, no exponent), and `Number(...)` of the matched string SHALL satisfy `Number.isSafeInteger(parsed) && parsed > 0`; on success the parsed result SHALL be that positive safe integer. On *any* validation failure for a non-empty value (including `"abc"`, `"4096abc"`, `"1e3"`, `"0"`, `"-100"`, `"3.14"`, `"01024"`, and any decimal string ≥ `2^53`) the parsed result SHALL fall back to `null` AND the server SHALL emit a warning to the operational log naming the variable and the offending value. The resulting `llmDefaults.maxCompletionTokens` field SHALL therefore be of type `number | null`, with `null` meaning "no application-level limit".

The server SHALL also read a separate, non-merged env var `LLM_REASONING_OMIT` (default `false`, parsed as a boolean per the rules below). When `LLM_REASONING_OMIT` resolves to `true`, the server SHALL omit the entire `reasoning` block from the upstream chat/completions request body, regardless of the merged `reasoningEnabled` / `reasoningEffort` values. This env var SHALL NOT be exposed in `_config.json`; it is a deployment-level switch only.

`LLM_REASONING_ENABLED` and `LLM_REASONING_OMIT` SHALL be parsed by a shared boolean parser with the rule: `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`; `"false" | "0" | "no" | "off"` (case-insensitive, trimmed) → `false`; the empty string or unset → the documented default; **any other non-empty string** SHALL fall back to the default AND the server SHALL emit a warning to the operational log naming the variable and the unrecognized value. `LLM_REASONING_EFFORT` SHALL be validated against the exact set `{"none", "minimal", "low", "medium", "high", "xhigh", "max"}` (case-sensitive); any other value SHALL fall back to the default `"xhigh"` and the server SHALL emit a warning log on startup.

`storyOverrides` SHALL be the validated partial subset of those same fields read from `playground/<series>/<story>/_config.json` (absent file ⇒ empty overrides). Only the whitelisted keys `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens` SHALL be honoured; unknown keys SHALL be ignored. Values whose type does not match the whitelist SHALL cause the request to fail with an RFC 9457 Problem Details error. For `maxCompletionTokens` specifically the validator SHALL accept `null` as a valid value carrying the explicit meaning "no application-level limit"; non-null values SHALL still be required to be a positive finite safe integer.

The merged configuration SHALL be used to populate the upstream request body (mapping camelCase fields to their OpenAI-compatible snake_case equivalents: `frequencyPenalty` → `frequency_penalty`, `presencePenalty` → `presence_penalty`, `topK` → `top_k`, `topP` → `top_p`, `repetitionPenalty` → `repetition_penalty`, `minP` → `min_p`, `topA` → `top_a`, `maxCompletionTokens` → `max_completion_tokens`). The `max_completion_tokens` field SHALL appear in the upstream chat/completions request body **only when the merged `maxCompletionTokens` is a positive safe integer**; when the merged value is `null`, the `max_completion_tokens` key SHALL be omitted entirely from the request body so that the upstream provider applies its own default.

For `maxCompletionTokens` only, the merge step SHALL treat `null` in `storyOverrides` as an *explicit* override that replaces any non-null env default with `null`, in contrast to the default `Object.assign(...)` semantics where a `null` override would normally fall through to the env default. All other fields keep the existing fall-through-on-null merge semantics.

Additionally, the upstream request body SHALL include a `reasoning` object on every chat/completions request **except** when `LLM_REASONING_OMIT` is `true`, populated as follows:
- When the merged `reasoningEnabled` is `true`: `reasoning: { enabled: true, effort: <reasoningEffort> }`.
- When the merged `reasoningEnabled` is `false`: `reasoning: { enabled: false }` (the `effort` property SHALL be omitted).
- When `LLM_REASONING_OMIT` is `true`: the `reasoning` key SHALL NOT appear in the request body at all.

The upstream `fetch` call SHALL additionally attach three hard-coded OpenRouter app-attribution HTTP headers — `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie`, and `X-OpenRouter-Categories: roleplay,creative-writing` — alongside `Content-Type` and (when `LLM_API_KEY` is set) the `Authorization` header, on every chat request, regardless of the configured `LLM_API_BASE_URL`. The header values SHALL come from a single module-level frozen constant in `writer/lib/chat-llm-fetch.ts` and SHALL NOT be configurable at runtime (no env vars, no `_config.json` keys, no API surface). See the `openrouter-app-attribution` capability for the complete specification.

The upstream `fetch` call SHALL also accept an optional `signal: AbortSignal` parameter that is forwarded directly to `fetch()`. When the signal is aborted, both the initial fetch resolution and any in-flight SSE stream read SHALL be cancellable. The server SHALL discriminate aborts by inspecting `signal?.aborted === true` rather than by inspecting the thrown error's class or `name`, so that the dedicated abort branch (close chapter file → log abort → throw `ChatAbortError`) runs regardless of whether the abort reason is a `DOMException`, a custom `Error`, a `ChatAbortError`, or undefined. The HTTP route SHALL pass `c.req.raw.signal`; the WebSocket route SHALL pass a per-request `AbortController.signal`. See the `streaming-cancellation` capability for the complete cancellation contract.

The SSE parser SHALL detect mid-stream provider errors per OpenRouter's documented format: after parsing each `data:` payload as a JSON object, the parser SHALL inspect `parsed.error` (any non-null object value) and `parsed.choices?.[0]?.finish_reason === "error"`. If either signal is present, the parser SHALL log one LLM-interaction-log entry with `errorCode: "stream-error"`, close the chapter file via the existing `finally` block (preserving any partial content), and throw `ChatError("llm-stream", <provider message>, 502)`. The HTTP route SHALL convert this into a 502 RFC 9457 Problem Details response; the WebSocket route SHALL convert it into `{ type: "chat:error", id, detail }`. Mid-stream errors SHALL NOT be silently swallowed.

When the upstream provider returns a non-2xx status, the server SHALL include the upstream response body (truncated if very large) in both the operational log entry AND in the `detail` field of the RFC 9457 Problem Details response returned to the client, so that a strict provider rejecting the `reasoning` field is diagnosable end-to-end.

The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

When the Responses transport serves the request, the SSE payloads SHALL be parsed per the `llm-api-transport` capability; the remainder of this paragraph and the next describe the Chat Completions transport. The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

In addition to `delta.content`, the SSE parser SHALL inspect each parsed chunk for upstream reasoning text via `choices[0].delta.reasoning` (preferred), `choices[0].delta.reasoning_content` (second), and `choices[0].delta.reasoning_details[].text` (fallback), and SHALL stream that reasoning text into the chapter file framed by `<think>` and `</think>` tags placed between the `<user_message>` block and the model content. Reasoning text SHALL NOT be appended to the `aiContent` accumulator returned in the HTTP response body's `content` field, and SHALL NOT be passed through the `response-stream` plugin hook. The chapter file on disk SHALL therefore contain a superset of the response envelope's `content` field for any turn that emitted reasoning. See the `reasoning-think-block` capability for the complete state-machine and field-extraction contract.

The operational debug log entry and the LLM interaction log entry produced for each chat request SHALL include the resolved values of `reasoningEnabled`, `reasoningEffort`, and `maxCompletionTokens` alongside the existing sampler parameters. The `maxCompletionTokens` value SHALL be either a positive safe integer or the JSON literal `null` (matching the merged `LlmConfig` field type). The LLM interaction log entry SHALL additionally carry an optional `reasoningLength` field whose value is the total character count of reasoning text streamed during the turn (success, abort, and mid-stream-error log entries alike), per the `reasoning-think-block` capability.

#### Scenario: Successful streaming chat completion

- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a valid message
- **THEN** the server SHALL call the LLM API with `stream: true`, create the next sequential chapter file (e.g., `002.md` if `001.md` exists), write the user message wrapped in `<user_message>` tags at the top of the file, then write each content delta to the file as it arrives from the SSE stream, and return the chapter number and complete content in the response after the stream finishes

#### Scenario: User message persisted before AI content

- **WHEN** the server begins writing a new chapter file during a chat request
- **THEN** the chapter file SHALL contain `<user_message>\n{message}\n</user_message>\n\n` at the beginning, followed by the AI response content

#### Scenario: Reasoning text streamed into `<think>` block

- **GIVEN** a chat request to a model that emits OpenRouter `delta.reasoning` deltas before its content deltas
- **WHEN** the SSE stream completes
- **THEN** the chapter file on disk SHALL contain `<user_message>\n{message}\n</user_message>\n\n<think>\n{reasoning text}\n</think>\n\n{model content}` in that exact byte order, AND the HTTP response body's `content` field SHALL contain `<user_message>\n{message}\n</user_message>\n\n{model content}` (i.e. the response envelope SHALL include the `<user_message>` block and model content but EXCLUDE the `<think>` block, while the chapter file on disk preserves all three)

#### Scenario: Chapter file updated incrementally during streaming

- **WHEN** the LLM SSE stream is in progress
- **THEN** the chapter file on disk SHALL contain the user message block followed by all content deltas received so far, allowing the frontend's 1-second polling to display partial content in real time

#### Scenario: Stream error mid-generation

- **WHEN** the SSE stream errors after some content has been written to the chapter file
- **THEN** the server SHALL keep the partial chapter file on disk (including the user message block) and return an HTTP error response with error details

#### Scenario: LLM API error

- **WHEN** the LLM API returns an error status
- **THEN** the server SHALL return an appropriate HTTP error status with the error details and SHALL NOT create a new chapter file

#### Scenario: Missing API key

- **WHEN** the `LLM_API_KEY` environment variable is not set
- **THEN** the server SHALL proceed with the chat request without an `Authorization` header, and SHALL NOT return HTTP 500 for the missing key

#### Scenario: Custom LLM API URL

- **WHEN** `LLM_API_BASE_URL` is set to a non-default value (e.g., `http://vllm.internal:8000/v1`)
- **THEN** the server SHALL send every upstream request to that base URL plus the transport path (`/responses` or `/chat/completions`) instead of the OpenRouter default

#### Scenario: Custom env sampling parameters apply as defaults

- **WHEN** `LLM_TEMPERATURE` is set to `0.7` in the environment and the target story has no `_config.json`
- **THEN** the chat completion request body SHALL contain `temperature: 0.7` instead of the default `0.1`

#### Scenario: Invalid env sampling parameter value

- **WHEN** an LLM parameter env var contains a non-numeric value (e.g., `LLM_TEMPERATURE=abc`)
- **THEN** the server SHALL fall back to the documented default value for that parameter when building `llmDefaults`

#### Scenario: Per-story override replaces env default

- **GIVEN** env default `temperature=0.1` and the target story's `_config.json` contains `{ "temperature": 0.9 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `temperature: 0.9`

#### Scenario: Per-story partial override preserves other env defaults

- **GIVEN** the target story's `_config.json` contains only `{ "temperature": 0.9 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `temperature: 0.9` and SHALL contain every other LLM parameter at its env-derived default value

#### Scenario: Malformed per-story config aborts the request

- **GIVEN** the target story's `_config.json` cannot be parsed as JSON or contains a wrong-type value
- **WHEN** a chat request targets that story
- **THEN** the server SHALL respond with an RFC 9457 Problem Details error and SHALL NOT send a request upstream and SHALL NOT create a new chapter file

#### Scenario: Path traversal prevention

- **WHEN** a client sends a request with path parameters containing `..` or other traversal sequences
- **THEN** the server SHALL reject the request with HTTP 400

#### Scenario: Reasoning block defaults applied when no overrides are present

- **GIVEN** `LLM_REASONING_ENABLED` and `LLM_REASONING_EFFORT` are unset and the target story has no `_config.json`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "xhigh" }`

#### Scenario: Reasoning disabled emits explicit enabled:false

- **GIVEN** `LLM_REASONING_ENABLED=false` is set in the environment and the target story has no `_config.json`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": false }` with no `effort` property

#### Scenario: Per-story reasoning override replaces env default

- **GIVEN** env default `reasoningEffort = "xhigh"` and the target story's `_config.json` contains `{ "reasoningEffort": "low" }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "low" }`

#### Scenario: Boolean env parsing for LLM_REASONING_ENABLED

- **WHEN** `LLM_REASONING_ENABLED` is set to one of `"false"`, `"0"`, `"no"`, `"off"` (any case, with surrounding whitespace)
- **THEN** the env-derived `reasoningEnabled` default SHALL be `false`; for `"true"`, `"1"`, `"yes"`, `"on"` (any case) the default SHALL be `true`; for the empty string or when the variable is unset, the default SHALL be `true`

#### Scenario: Unrecognized boolean env value falls back with warning

- **WHEN** `LLM_REASONING_ENABLED` is set to an unrecognized non-empty value such as `"falsey"` or `"truth"`
- **THEN** the env-derived `reasoningEnabled` default SHALL fall back to `true`, AND the server SHALL emit a warning log on startup naming the variable and the unrecognized value

#### Scenario: Invalid LLM_REASONING_EFFORT falls back to default

- **WHEN** `LLM_REASONING_EFFORT` is set to a value outside `{ "none", "minimal", "low", "medium", "high", "xhigh", "max" }`
- **THEN** the env-derived `reasoningEffort` default SHALL fall back to `"xhigh"` and a warning SHALL be emitted to the operational log

#### Scenario: LLM_REASONING_OMIT suppresses the reasoning block

- **GIVEN** `LLM_REASONING_OMIT=true` is set in the environment
- **WHEN** any chat request is sent upstream
- **THEN** the upstream chat completion request body SHALL NOT contain a `reasoning` key at all, regardless of the merged `reasoningEnabled` / `reasoningEffort` values

#### Scenario: Per-story reasoningEnabled override flips env default off

- **GIVEN** env default `reasoningEnabled = true` (from `LLM_REASONING_ENABLED` unset or `true`) and the target story's `_config.json` contains `{ "reasoningEnabled": false }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": false }` (no `effort`)

#### Scenario: Per-story reasoningEnabled override flips env default on

- **GIVEN** env default `reasoningEnabled = false` (from `LLM_REASONING_ENABLED=false`) and the target story's `_config.json` contains `{ "reasoningEnabled": true }`
- **WHEN** a chat request targets that story (with `reasoningEffort` falling through to env default `"xhigh"`)
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "xhigh" }`

#### Scenario: Null reasoning fields fall through to env defaults

- **GIVEN** env defaults `reasoningEnabled = true` and `reasoningEffort = "xhigh"`, and the target story's `_config.json` contains `{ "reasoningEnabled": null, "reasoningEffort": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "xhigh" }` (both nulls are dropped during validation, falling through to the defaults)

#### Scenario: Default model is deepseek-v4-pro when LLM_MODEL is unset

- **GIVEN** `LLM_MODEL` is unset in the environment and the target story has no `_config.json` (or its `_config.json` does not override `model`)
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `model: "deepseek/deepseek-v4-pro"`

#### Scenario: Default max_completion_tokens is omitted when LLM_MAX_COMPLETION_TOKENS is unset

- **GIVEN** `LLM_MAX_COMPLETION_TOKENS` is unset in the environment and the target story has no `_config.json` (or its `_config.json` does not override `maxCompletionTokens`)
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` AND the upstream chat completion request body SHALL NOT contain a `max_completion_tokens` key at all

#### Scenario: Custom env LLM_MAX_COMPLETION_TOKENS applies as default

- **GIVEN** `LLM_MAX_COMPLETION_TOKENS=8192` is set in the environment and the target story has no `_config.json`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `max_completion_tokens: 8192`

#### Scenario: Per-story maxCompletionTokens override replaces env default

- **GIVEN** env default `maxCompletionTokens=null` (or any value) and the target story's `_config.json` contains `{ "maxCompletionTokens": 16384 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `max_completion_tokens: 16384`

#### Scenario: Per-story maxCompletionTokens=null overrides a non-null env default

- **GIVEN** env default `LLM_MAX_COMPLETION_TOKENS=8192` (so `llmDefaults.maxCompletionTokens` is `8192`) and the target story's `_config.json` contains `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` (the explicit per-story `null` overrides the env default rather than falling through) AND the upstream chat completion request body SHALL NOT contain a `max_completion_tokens` key

#### Scenario: Invalid LLM_MAX_COMPLETION_TOKENS falls back to null with warning

- **WHEN** `LLM_MAX_COMPLETION_TOKENS` is set to a value that fails the positive-safe-integer regex/predicate, including `"abc"`, `"4096abc"`, `"1e3"`, `"0"`, `"-100"`, `"3.14"`, `"01024"` (leading zero), or any decimal string whose numeric value is `≥ 2^53`
- **THEN** the env-derived `maxCompletionTokens` default SHALL fall back to `null`, AND the server SHALL emit a warning log on startup naming the variable and the unrecognized value

#### Scenario: Empty or whitespace-only LLM_MAX_COMPLETION_TOKENS resolves to null silently

- **WHEN** `LLM_MAX_COMPLETION_TOKENS` is unset, empty, or contains only whitespace
- **THEN** the env-derived `maxCompletionTokens` default SHALL be `null` AND no warning log SHALL be emitted

#### Scenario: max_completion_tokens omitted when merged value is null

- **GIVEN** any combination of env vars and `_config.json` overrides that result in a merged `maxCompletionTokens` of `null`
- **WHEN** any chat request is dispatched upstream
- **THEN** the upstream request body SHALL NOT contain a `max_completion_tokens` key at all

#### Scenario: max_completion_tokens present when merged value is a positive integer

- **GIVEN** any combination of env vars and `_config.json` overrides that result in a merged `maxCompletionTokens` of a positive safe integer N
- **WHEN** any chat request is dispatched upstream
- **THEN** the upstream request body SHALL contain `max_completion_tokens: N` exactly once

#### Scenario: Operational and interaction logs include maxCompletionTokens

- **WHEN** the server dispatches a chat request
- **THEN** both the operational debug log entry (`LLM request payload`) and the LLM interaction log entry (`LLM request`, with the value nested under `parameters`) SHALL include the resolved `maxCompletionTokens` value alongside the existing sampler parameters
- **AND** that value SHALL be either a positive safe integer or the JSON literal `null`, matching the merged `LlmConfig` field type

#### Scenario: Upstream provider rejection surfaces the response body

- **GIVEN** a custom `LLM_API_BASE_URL` whose backend rejects the `reasoning` field with HTTP 400 and a JSON body `{"error":"unknown field: reasoning"}`
- **WHEN** a chat request is dispatched
- **THEN** the server SHALL respond to the client with an RFC 9457 Problem Details body whose `detail` field includes (a truncated form of) the upstream response body, AND SHALL log the same upstream body at error level

#### Scenario: Attribution headers attached on every chat request

- **WHEN** the server dispatches any chat completion request to the upstream LLM
- **THEN** the upstream `fetch` call SHALL carry exactly `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie`, and `X-OpenRouter-Categories: roleplay,creative-writing` in addition to `Content-Type` and (when `LLM_API_KEY` is set) the `Authorization` header

#### Scenario: Attribution headers identical regardless of LLM_API_URL

- **GIVEN** `LLM_API_BASE_URL` is set to a non-OpenRouter endpoint
- **WHEN** a chat request is dispatched
- **THEN** the upstream `fetch` call SHALL still carry the three hard-coded attribution headers with the documented values

#### Scenario: Abort during initial fetch resolution returns 499 (HTTP)

- **GIVEN** an HTTP `POST /api/stories/:series/:name/chat` request whose underlying TCP connection is closed by the client before the upstream `fetch()` resolves
- **WHEN** the request signal (`c.req.raw.signal`) is aborted by the runtime
- **THEN** `executeChat()` SHALL throw `ChatAbortError`, the route handler SHALL respond with HTTP 499 (Client Closed Request) and an RFC 9457 Problem Details body, SHALL NOT respond with HTTP 502, and SHALL NOT have created any chapter file on disk (chapter file is opened only after upstream fetch validates)

#### Scenario: Abort during streaming preserves partial chapter

- **GIVEN** an HTTP chat request that has streamed N content deltas to the chapter file
- **WHEN** the request signal is aborted while `await reader.read()` is pending in the SSE loop
- **THEN** `executeChat()` SHALL throw `ChatAbortError`, the chapter file SHALL retain the leading user-message block plus exactly the N deltas already written, and the LLM interaction log SHALL include one entry with `aborted: true`

#### Scenario: Mid-stream error chunk surfaces as RFC 9457 502

- **GIVEN** the upstream provider streams two normal `data:` chunks followed by an error chunk `{"id":"…","error":{"message":"Provider connection lost","code":502},"choices":[{"finish_reason":"error","delta":{}}]}`
- **WHEN** `executeChat()` parses the error chunk
- **THEN** the route handler SHALL respond with HTTP 502 and an RFC 9457 Problem Details body whose `detail` field is `"Provider connection lost"`, the chapter file SHALL retain the user-message block plus the two streamed deltas, and the LLM interaction log SHALL include one entry with `errorCode: "stream-error"`

### Requirement: LLM defaults exposure endpoint

The server SHALL register an authenticated `GET /api/llm-defaults` route that returns the env-derived `llmDefaults` filtered to exactly the keys allowed in the per-story `_config.json` whitelist. The route SHALL be registered under the same `X-Passphrase`-checking middleware as the per-story config routes; an unauthenticated request SHALL be rejected with HTTP 401 and a Problem Details body, exactly mirroring the existing per-story config route's auth behaviour.

The response body SHALL be a JSON object whose top-level keys are exactly the per-story `_config.json` whitelist: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort` (and `maxCompletionTokens` once that field is added to the whitelist by the `update-llm-defaults-and-completion-tokens` change). Every key SHALL be present and well-typed: `model` SHALL be a non-empty string, `reasoningEnabled` SHALL be a boolean, `reasoningEffort` SHALL be one of the literal `REASONING_EFFORTS` values, every other listed key SHALL be a finite number (positive safe integer for `maxCompletionTokens` once added). The response SHALL NOT include any other key — in particular the route handler SHALL NOT serialize the entire `LlmConfig` object, and SHALL NOT leak `LLM_API_BASE_URL`, `LLM_API_KEY`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, or any other non-whitelist field.

The endpoint SHALL NOT depend on any URL parameters and SHALL NOT consult any per-story config — it returns the env defaults only, identical for every authenticated client.

#### Scenario: Authenticated client receives whitelist-shaped defaults

- **GIVEN** the server is started with `LLM_MODEL=deepseek/deepseek-v4-pro`, `LLM_TEMPERATURE=0.1`, `LLM_REASONING_ENABLED=true`, `LLM_REASONING_EFFORT=high`, and the remaining `LLM_*` env vars at their defaults
- **WHEN** an authenticated client sends `GET /api/llm-defaults` with a valid `X-Passphrase` header
- **THEN** the server SHALL respond `200 OK` with a JSON body containing exactly the per-story whitelist keys, including `model: "deepseek/deepseek-v4-pro"`, `temperature: 0.1`, `reasoningEnabled: true`, `reasoningEffort: "high"`, AND no other keys

#### Scenario: Unauthenticated request is rejected

- **WHEN** a client sends `GET /api/llm-defaults` without an `X-Passphrase` header (or with an incorrect one)
- **THEN** the server SHALL respond with HTTP 401 and an RFC 9457 Problem Details body, identical in shape to the existing per-story config route's unauthenticated response, AND SHALL NOT include any LLM defaults in the body

#### Scenario: Response excludes secrets and non-LLM config

- **WHEN** an authenticated client receives a `GET /api/llm-defaults` response
- **THEN** the response body SHALL NOT contain any of: `apiKey`, `apiUrl`, `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_API_MODE`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`, AND SHALL NOT contain any key not listed in the per-story `_config.json` whitelist

#### Scenario: Response keys lock-step with the per-story whitelist

- **GIVEN** `writer/lib/story-config.ts` exports a single source-of-truth constant `STORY_LLM_CONFIG_KEYS` listing the whitelisted per-story `_config.json` keys
- **WHEN** the per-story `_config.json` whitelist gains or loses a key (e.g. `maxCompletionTokens` is added by the `update-llm-defaults-and-completion-tokens` change) by editing `STORY_LLM_CONFIG_KEYS`
- **THEN** the `GET /api/llm-defaults` response SHALL gain or lose the same key in the same shape, AND a backend test SHALL compare `Object.keys(response).sort()` against `[...STORY_LLM_CONFIG_KEYS].sort()` and fail loudly if the two sets of keys diverge

#### Scenario: Response is not cached by intermediaries

- **WHEN** an authenticated client receives a `GET /api/llm-defaults` response
- **THEN** the response SHALL include a `Cache-Control: no-store` header so a deployment env change picked up by a manual server restart is reflected on the next fetch without intermediary cache hits
