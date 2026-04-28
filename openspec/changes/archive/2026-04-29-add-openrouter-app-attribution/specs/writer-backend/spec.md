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

When the upstream provider returns a non-2xx status, the server SHALL include the upstream response body (truncated if very large) in both the operational log entry AND in the `detail` field of the RFC 9457 Problem Details response returned to the client, so that a strict provider rejecting the `reasoning` field is diagnosable end-to-end.

The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

The operational debug log entry and the LLM interaction log entry produced for each chat request SHALL include the resolved values of `reasoningEnabled` and `reasoningEffort` alongside the existing sampler parameters.

#### Scenario: Successful streaming chat completion

- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a valid message
- **THEN** the server SHALL call the LLM API with `stream: true`, create the next sequential chapter file (e.g., `002.md` if `001.md` exists), write the user message wrapped in `<user_message>` tags at the top of the file, then write each content delta to the file as it arrives from the SSE stream, and return the chapter number and complete content in the response after the stream finishes

#### Scenario: User message persisted before AI content

- **WHEN** the server begins writing a new chapter file during a chat request
- **THEN** the chapter file SHALL contain `<user_message>\n{message}\n</user_message>\n\n` at the beginning, followed by the AI response content

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
- **THEN** the server SHALL return HTTP 500 with a descriptive error message indicating the missing configuration

#### Scenario: Custom LLM API URL

- **WHEN** `LLM_API_URL` is set to a non-default value (e.g., a self-hosted vLLM endpoint)
- **THEN** the server SHALL send chat completion requests to that URL instead of the OpenRouter default

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
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "high" }`

#### Scenario: Reasoning disabled emits explicit enabled:false

- **GIVEN** `LLM_REASONING_ENABLED=false` is set in the environment and the target story has no `_config.json`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": false }` with no `effort` property

#### Scenario: Per-story reasoning override replaces env default

- **GIVEN** env default `reasoningEffort = "high"` and the target story's `_config.json` contains `{ "reasoningEffort": "low" }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "low" }`

#### Scenario: Boolean env parsing for LLM_REASONING_ENABLED

- **WHEN** `LLM_REASONING_ENABLED` is set to one of `"false"`, `"0"`, `"no"`, `"off"` (any case, with surrounding whitespace)
- **THEN** the env-derived `reasoningEnabled` default SHALL be `false`; for `"true"`, `"1"`, `"yes"`, `"on"` (any case) the default SHALL be `true`; for the empty string or when the variable is unset, the default SHALL be `true`

#### Scenario: Unrecognized boolean env value falls back with warning

- **WHEN** `LLM_REASONING_ENABLED` is set to an unrecognized non-empty value such as `"falsey"` or `"truth"`
- **THEN** the env-derived `reasoningEnabled` default SHALL fall back to `true`, AND the server SHALL emit a warning log on startup naming the variable and the unrecognized value

#### Scenario: Invalid LLM_REASONING_EFFORT falls back to default

- **WHEN** `LLM_REASONING_EFFORT` is set to a value outside `{ "none", "minimal", "low", "medium", "high", "xhigh" }`
- **THEN** the env-derived `reasoningEffort` default SHALL fall back to `"high"` and a warning SHALL be emitted to the operational log

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
- **WHEN** a chat request targets that story (with `reasoningEffort` falling through to env default `"high"`)
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "high" }`

#### Scenario: Null reasoning fields fall through to env defaults

- **GIVEN** env defaults `reasoningEnabled = true` and `reasoningEffort = "high"`, and the target story's `_config.json` contains `{ "reasoningEnabled": null, "reasoningEffort": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `reasoning: { "enabled": true, "effort": "high" }` (both nulls are dropped during validation, falling through to the defaults)

#### Scenario: Upstream provider rejection surfaces the response body

- **GIVEN** a custom `LLM_API_URL` whose backend rejects the `reasoning` field with HTTP 400 and a JSON body `{"error":"unknown field: reasoning"}`
- **WHEN** a chat request is dispatched
- **THEN** the server SHALL respond to the client with an RFC 9457 Problem Details body whose `detail` field includes (a truncated form of) the upstream response body, AND SHALL log the same upstream body at error level

#### Scenario: Attribution headers attached on every chat request

- **WHEN** the server dispatches any chat completion request to the upstream LLM
- **THEN** the upstream `fetch` call SHALL carry exactly `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2` (UTF-8 percent-encoded form of `HeartReverie 浮心夜夢`), and `X-OpenRouter-Categories: roleplay,creative-writing` in addition to `Content-Type` and `Authorization`

#### Scenario: Attribution headers identical regardless of LLM_API_URL

- **GIVEN** `LLM_API_URL` is set to a non-OpenRouter endpoint
- **WHEN** a chat request is dispatched
- **THEN** the upstream `fetch` call SHALL still carry the three hard-coded attribution headers with the documented values
