# Writer Backend

## Purpose

Deno application using Hono framework with TypeScript that serves the reader frontend, exposes REST API endpoints for story management, and proxies chat requests to an LLM API with a faithful prompt construction pipeline.
## Requirements
### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with TypeScript ESM modules. Route handlers SHALL be organized into separate module files under `writer/routes/`. Middleware functions SHALL be extracted into `writer/lib/middleware.ts`. Configuration SHALL be centralized in `writer/lib/config.ts`. Error response construction SHALL use a shared `problemJson()` helper from `writer/lib/errors.ts`. The server SHALL also register the lore CRUD routes from `writer/routes/lore.ts` alongside other core routes during initialization. The server SHALL listen on plain HTTP with no in-application TLS support; operators are expected to terminate TLS at an upstream reverse proxy or ingress controller.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started via `deno run`
- **THEN** the server SHALL listen on plain HTTP and serve files from the `reader/` directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers, each imported from its respective route module, including the lore CRUD routes

#### Scenario: Modular route structure
- **WHEN** a developer inspects the `writer/routes/` directory
- **THEN** each file contains handlers for a single API domain (auth, stories, chapters, chat, plugins, prompt, lore)

#### Scenario: TypeScript type checking passes
- **WHEN** a developer runs `deno check` on the writer backend entry point
- **THEN** all TypeScript files under `writer/` SHALL pass type checking without errors

#### Scenario: No TLS code paths remain

- **WHEN** a developer greps the `writer/` source tree for `cert`, `key`, `tls`, `https`, `HTTP_ONLY`, `CERT_FILE`, or `KEY_FILE`
- **THEN** there SHALL be no occurrences other than (a) comments or documentation strings, (b) the `Cache-Control: no-store` header, (c) unrelated identifiers like `apiKey`, `tlsCertKey`-style ConfigMap keys, or (d) the `LLM_*` configuration knobs — i.e. the server SHALL contain no code path that constructs `Deno.serveTls`, reads cert/key files, generates self-signed certificates, or branches on `HTTP_ONLY`

### Requirement: Type-safe dependency injection

The dependency bag passed to `createApp()` and route registrars SHALL conform to the `AppDeps` interface defined in `writer/types.ts`. Route registrar functions SHALL receive typed dependency parameters rather than untyped objects.

#### Scenario: createApp receives typed dependencies
- **WHEN** `createApp()` is called with a dependency object
- **THEN** the parameter SHALL be typed as `AppDeps` and the TypeScript compiler SHALL reject any call that does not satisfy the interface

#### Scenario: Route registrar receives typed deps
- **WHEN** a route registrar function (e.g., `registerChatRoutes`) receives the deps parameter
- **THEN** the parameter SHALL be typed as the appropriate subset interface of `AppDeps`, and accessing properties not defined in the interface SHALL produce a compile-time error

### Requirement: Story directory listing

The server SHALL expose `GET /api/stories` to list story series directories under `playground/`. The server SHALL expose `GET /api/stories/:series` to list story name directories under `playground/:series/`. Directory listings SHALL exclude hidden files/directories (those starting with `.`), non-directory entries, and system-reserved directories (underscore-prefixed directories such as `_lore`/`_prompts`, plus the exact literals `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd`).

#### Scenario: List all story series
- **WHEN** a client sends `GET /api/stories`
- **THEN** the server SHALL return a JSON array of directory names found directly under `playground/`, excluding hidden directories, underscore-prefixed directories (e.g., `_lore/`, `_prompts/`), and reserved platform directories (e.g., `lost+found/`, `$RECYCLE.BIN/`, `System Volume Information/`)

#### Scenario: List stories within a series
- **WHEN** a client sends `GET /api/stories/:series` with a valid series name
- **THEN** the server SHALL return a JSON array of directory names found under `playground/:series/`, excluding hidden directories, underscore-prefixed directories (e.g., `_lore/`), and reserved platform directories (e.g., `lost+found/`, `$RECYCLE.BIN/`, `System Volume Information/`)

#### Scenario: Series not found
- **WHEN** a client sends `GET /api/stories/:series` with a non-existent series name
- **THEN** the server SHALL return HTTP 404

### Requirement: Reserved directory name validation
The server SHALL reject series and story identifiers that are system-reserved in all endpoints that accept series or story parameters. System-reserved identifiers SHALL include names starting with `_` (underscore) and the exact, case-sensitive literals `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd` after standard URL decoding of the path segment.

#### Scenario: Reject underscore-prefixed series name
- **WHEN** a client sends a request with series parameter set to `_lore` or any other underscore-prefixed name
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject underscore-prefixed story name
- **WHEN** a client sends a request with story parameter set to `_lore` or any other underscore-prefixed name in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal lost+found series name
- **WHEN** a client sends a request with series parameter set to `lost+found` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal lost+found story name
- **WHEN** a client sends a request with story parameter set to `lost+found` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject URL-encoded lost+found series name
- **WHEN** a client sends a request where the series path segment is `lost%2Bfound`
- **THEN** the server SHALL treat the decoded value as `lost+found` and return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal Windows system series name
- **WHEN** a client sends a request with series parameter set to `$RECYCLE.BIN` or `System Volume Information` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal macOS system story name
- **WHEN** a client sends a request with story parameter set to `.Spotlight-V100`, `.Trashes`, or `.fseventsd` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

### Requirement: Chapter file management

The server SHALL expose endpoints to list, read, and create numbered `.md` chapter files within a story directory. Chapter files follow the naming pattern `NNN.md` (e.g., `001.md`, `002.md`). The server SHALL expose `POST /api/stories/:series/:name/init` to create an empty `001.md` file if it does not already exist.

#### Scenario: List chapters
- **WHEN** a client sends `GET /api/stories/:series/:name/chapters`
- **THEN** the server SHALL return a JSON array of chapter numbers found as `NNN.md` files in the story directory, sorted numerically

#### Scenario: Read a specific chapter
- **WHEN** a client sends `GET /api/stories/:series/:name/chapters/:number` with a valid chapter number
- **THEN** the server SHALL return the content of the corresponding `.md` file as plain text or JSON

#### Scenario: Chapter not found
- **WHEN** a client sends `GET /api/stories/:series/:name/chapters/:number` with a non-existent chapter number
- **THEN** the server SHALL return HTTP 404

#### Scenario: Initialize a new story
- **WHEN** a client sends `POST /api/stories/:series/:name/init` and `001.md` does not exist
- **THEN** the server SHALL create an empty `001.md` file in the story directory and return HTTP 201

#### Scenario: Initialize an already-initialized story
- **WHEN** a client sends `POST /api/stories/:series/:name/init` and `001.md` already exists
- **THEN** the server SHALL return HTTP 200 without modifying the existing file

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `isFirstRound` (boolean, true when no chapters with content exist), and `plugin_fragments` (array of strings — fragment bodies contributed by plugins via the prompt-assembly hook, ordered by handler priority). Additionally, `renderSystemPrompt()` SHALL call `pluginManager.getDynamicVariables({ series, name, storyDir })` and spread the returned variables into the Vento template context. It SHALL also call the lore retrieval engine in `writer/lib/lore.ts` directly with the active series and story context, and spread the returned lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) into the Vento template render context. `renderSystemPrompt()` SHALL return `{ messages: ChatMessage[]; error: VentoError | null }` — never a single `prompt: string`. See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

`renderSystemPrompt()` SHALL install a custom Vento plugin (the `vento-message-tag` capability) on the shared `Environment` that registers the `{{ message }}` / `{{ /message }}` tag pair. Before calling `runString`, the server SHALL generate a fresh per-render UUID nonce via `crypto.randomUUID()`, build a fresh `__messages: []` array, and inject both `__msgNonce` and `__messages` into the data context passed to `runString`. After `runString` resolves, the server SHALL invoke `splitRenderedMessages()` to assemble the final `ChatMessage[]` from the rendered string and the side-channel buffer (see the `vento-message-tag` capability for assembly semantics).

`renderSystemPrompt()` SHALL return `{ messages: ChatMessage[], error: VentoError | null }` (a discriminated union — when `error` is non-null, `messages` is an empty array; when `error` is null, `messages` is non-empty). `BuildPromptResult` SHALL replace its previous `prompt: string` field with `messages: ChatMessage[]`. The `ChatMessage` type SHALL be `{ role: "system" | "user" | "assistant"; content: string }` and SHALL be exported from `writer/types.ts`.

Before rendering the template, the server SHALL invoke the `prompt-assembly` hook stage. Each registered plugin handler SHALL return a string (the fragment body). The server SHALL collect all returned fragment strings into the `plugin_fragments` array, ordered by handler priority. The `plugin_fragments` array SHALL be passed to the Vento template alongside the existing variables.

The Vento template rendering call SHALL pass all variables to the `system.md` template, including plugin variables collected from the prompt-assembly hook and lore variables computed directly by the lore retrieval engine.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The upstream `messages` array SHALL be the assembled `ChatMessage[]` returned by `renderSystemPrompt()`, used verbatim. The server SHALL NOT append, prepend, or otherwise inject any message that the template did not produce. In particular, the prior behaviour of auto-appending `{role: "user", content: <request.message>}` is REMOVED — the template is the single source of truth for the message sequence.

Before including chapter content in the `previous_context` array, the server SHALL strip tags declared in each plugin's `promptStripTags` manifest field from the chapter text, rather than using a hardcoded list. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_fragments`, pass `previous_context` as an empty array, `user_input` as the raw user message, `isFirstRound` as `true`, and `plugin_fragments` as the collected array to the template
- **AND** the upstream `messages` array sent to the LLM API SHALL be exactly the `ChatMessage[]` returned by the template (no automatically-appended user message)

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_fragments`, pass `previous_context` as an array of stripped chapter contents in numerical order, `user_input` as the raw user message, `isFirstRound` as `false`, and `plugin_fragments` as the collected array to the template
- **AND** the upstream `messages` array SHALL be exactly the `ChatMessage[]` returned by the template

#### Scenario: Plugin-contributed prompt fragments assembled
- **WHEN** the `prompt-assembly` hook is invoked and multiple plugins have registered handlers
- **THEN** each handler SHALL be called in priority order and the returned fragment strings SHALL be collected into the `plugin_fragments` array passed to the template

#### Scenario: No plugins contribute prompt fragments
- **WHEN** the `prompt-assembly` hook is invoked and no plugins have registered handlers
- **THEN** `plugin_fragments` SHALL be an empty array and the template SHALL render without plugin prompt sections

#### Scenario: Chapter tag stripping uses plugin-declared promptStripTags
- **WHEN** a chapter's content contains tags declared by plugins in their `promptStripTags` manifest field (e.g., `<options>`, `<disclaimer>`, `<user_message>`)
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain any tags declared in any plugin's `promptStripTags`
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `system.md` with variables collected from the prompt-assembly hook and from the lore retrieval engine as the template data, with the message-tag Vento plugin installed on the environment

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message

#### Scenario: Lore variables available in template
- **WHEN** the lore system is active and lore passages exist for the current story context
- **THEN** the template rendering SHALL include lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) in the Vento template context alongside other variables

#### Scenario: Per-render isolation of message buffer
- **WHEN** two `renderSystemPrompt()` calls run concurrently
- **THEN** each call SHALL receive its own `__msgNonce` and its own `__messages` buffer, and the assembled message arrays SHALL be independent

#### Scenario: Template missing user-role message
- **WHEN** the rendered template emits no `user`-role message
- **THEN** `renderSystemPrompt()` SHALL return `{ messages: [], error: <vento-error with type 'multi-message:no-user-message'> }` and the chat handler SHALL respond with a 422 RFC 9457 Problem Details error without calling the upstream LLM API

### Requirement: Lore API route registration

The server SHALL register lore CRUD routes as a core route module at `writer/routes/lore.ts`, mounted under the `/api/lore/` path prefix. These routes SHALL be subject to the same authentication middleware as other API routes and SHALL be registered during server initialization alongside other core routes.

#### Scenario: Lore API routes are registered
- **WHEN** the server starts
- **THEN** the lore route handlers SHALL be mounted under `/api/lore/` path prefix and be accessible via HTTP requests

#### Scenario: Lore API routes require authentication
- **WHEN** a client sends a request to any `/api/lore/` endpoint without valid authentication
- **THEN** the server SHALL return HTTP 401 Unauthorized

### Requirement: LLM API proxy

The server SHALL expose `POST /api/stories/:series/:name/chat` that accepts a JSON body with a `message` field. The server SHALL construct the prompt using the pipeline above, send it to the LLM API URL (configured via `LLM_API_URL` environment variable, defaulting to `https://openrouter.ai/api/v1/chat/completions`) using native `fetch` with `stream: true` in the request body, and write the assistant's response incrementally as the next numbered chapter file. The server SHALL use the `LLM_API_KEY` environment variable for authentication.

The server SHALL resolve the effective LLM configuration for each chat request by merging an env-derived `llmDefaults` object with the target story's validated `_config.json` overrides using `Object.assign({}, llmDefaults, storyOverrides)`. Merging SHALL happen per request so that edits to a story's `_config.json` take effect on the next chat without a server restart.

The `llmDefaults` object SHALL be built from the following environment variables (applied when the variable is unset or fails parsing, the field SHALL use the stated default): `LLM_MODEL` (default `deepseek/deepseek-v4-pro`), `LLM_TEMPERATURE` (default `0.1`), `LLM_FREQUENCY_PENALTY` (default `0.13`), `LLM_PRESENCE_PENALTY` (default `0.52`), `LLM_TOP_K` (default `10`), `LLM_TOP_P` (default `0`), `LLM_REPETITION_PENALTY` (default `1.2`), `LLM_MIN_P` (default `0`), `LLM_TOP_A` (default `1`), `LLM_REASONING_ENABLED` (default `true`), `LLM_REASONING_EFFORT` (default `"xhigh"`), `LLM_MAX_COMPLETION_TOKENS` (default `4096`).

`LLM_MAX_COMPLETION_TOKENS` SHALL be parsed by a dedicated positive-safe-integer parser with the rule: trim the raw string, require a full-string decimal-integer match against `^[1-9]\d*$` (no leading zeros, no sign, no decimal point, no exponent), then `Number(...)` the matched string and validate `Number.isSafeInteger(parsed) && parsed > 0`. Empty / unset / whitespace-only → fallback to `4096` with no warning. Any non-empty value that fails the regex or the safe-integer check (including `"abc"`, `"4096abc"`, `"1e3"`, `"0"`, `"-100"`, `"3.14"`, `"01024"`, and any decimal string ≥ `2^53`) SHALL fall back to `4096` AND the server SHALL emit a warning to the operational log naming the variable and the offending value.

The server SHALL also read a separate, non-merged env var `LLM_REASONING_OMIT` (default `false`, parsed as a boolean per the rules below). When `LLM_REASONING_OMIT` resolves to `true`, the server SHALL omit the entire `reasoning` block from the upstream chat/completions request body, regardless of the merged `reasoningEnabled` / `reasoningEffort` values. This env var SHALL NOT be exposed in `_config.json`; it is a deployment-level switch only.

`LLM_REASONING_ENABLED` and `LLM_REASONING_OMIT` SHALL be parsed by a shared boolean parser with the rule: `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`; `"false" | "0" | "no" | "off"` (case-insensitive, trimmed) → `false`; the empty string or unset → the documented default; **any other non-empty string** SHALL fall back to the default AND the server SHALL emit a warning to the operational log naming the variable and the unrecognized value. `LLM_REASONING_EFFORT` SHALL be validated against the exact set `{"none", "minimal", "low", "medium", "high", "xhigh"}` (case-sensitive); any other value SHALL fall back to the default `"xhigh"` and the server SHALL emit a warning log on startup.

`storyOverrides` SHALL be the validated partial subset of those same fields read from `playground/<series>/<story>/_config.json` (absent file ⇒ empty overrides). Only the whitelisted keys `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens` SHALL be honoured; unknown keys SHALL be ignored. Values whose type does not match the whitelist SHALL cause the request to fail with an RFC 9457 Problem Details error.

The merged configuration SHALL be used to populate the upstream request body (mapping camelCase fields to their OpenAI-compatible snake_case equivalents: `frequencyPenalty` → `frequency_penalty`, `presencePenalty` → `presence_penalty`, `topK` → `top_k`, `topP` → `top_p`, `repetitionPenalty` → `repetition_penalty`, `minP` → `min_p`, `topA` → `top_a`, `maxCompletionTokens` → `max_completion_tokens`). The `max_completion_tokens` field SHALL appear in every upstream chat/completions request body (no opt-out switch).

Additionally, the upstream request body SHALL include a `reasoning` object on every chat/completions request **except** when `LLM_REASONING_OMIT` is `true`, populated as follows:
- When the merged `reasoningEnabled` is `true`: `reasoning: { enabled: true, effort: <reasoningEffort> }`.
- When the merged `reasoningEnabled` is `false`: `reasoning: { enabled: false }` (the `effort` property SHALL be omitted).
- When `LLM_REASONING_OMIT` is `true`: the `reasoning` key SHALL NOT appear in the request body at all.

The upstream `fetch` call SHALL additionally attach three hard-coded OpenRouter app-attribution HTTP headers — `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie`, and `X-OpenRouter-Categories: roleplay,creative-writing` — alongside `Content-Type` and `Authorization`, on every chat request, regardless of the configured `LLM_API_URL`. The header values SHALL come from a single module-level frozen constant in `writer/lib/chat-shared.ts` and SHALL NOT be configurable at runtime (no env vars, no `_config.json` keys, no API surface). See the `openrouter-app-attribution` capability for the complete specification.

The upstream `fetch` call SHALL also accept an optional `signal: AbortSignal` parameter that is forwarded directly to `fetch()`. When the signal is aborted, both the initial fetch resolution and any in-flight SSE stream read SHALL be cancellable. The server SHALL discriminate aborts by inspecting `signal?.aborted === true` rather than by inspecting the thrown error's class or `name`, so that the dedicated abort branch (close chapter file → log abort → throw `ChatAbortError`) runs regardless of whether the abort reason is a `DOMException`, a custom `Error`, a `ChatAbortError`, or undefined. The HTTP route SHALL pass `c.req.raw.signal`; the WebSocket route SHALL pass a per-request `AbortController.signal`. See the `streaming-cancellation` capability for the complete cancellation contract.

The SSE parser SHALL detect mid-stream provider errors per OpenRouter's documented format: after parsing each `data:` payload as a JSON object, the parser SHALL inspect `parsed.error` (any non-null object value) and `parsed.choices?.[0]?.finish_reason === "error"`. If either signal is present, the parser SHALL log one LLM-interaction-log entry with `errorCode: "stream-error"`, close the chapter file via the existing `finally` block (preserving any partial content), and throw `ChatError("llm-stream", <provider message>, 502)`. The HTTP route SHALL convert this into a 502 RFC 9457 Problem Details response; the WebSocket route SHALL convert it into `{ type: "chat:error", id, detail }`. Mid-stream errors SHALL NOT be silently swallowed.

When the upstream provider returns a non-2xx status, the server SHALL include the upstream response body (truncated if very large) in both the operational log entry AND in the `detail` field of the RFC 9457 Problem Details response returned to the client, so that a strict provider rejecting the `reasoning` field is diagnosable end-to-end.

The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

In addition to `delta.content`, the SSE parser SHALL inspect each parsed chunk for upstream reasoning text via `choices[0].delta.reasoning` (preferred) and `choices[0].delta.reasoning_details[].text` (fallback), and SHALL stream that reasoning text into the chapter file framed by `<think>` and `</think>` tags placed between the `<user_message>` block and the model content. Reasoning text SHALL NOT be appended to the `aiContent` accumulator returned in the HTTP response body's `content` field, and SHALL NOT be passed through the `response-stream` plugin hook. The chapter file on disk SHALL therefore contain a superset of the response envelope's `content` field for any turn that emitted reasoning. See the `reasoning-think-block` capability for the complete state-machine and field-extraction contract.

The operational debug log entry and the LLM interaction log entry produced for each chat request SHALL include the resolved values of `reasoningEnabled`, `reasoningEffort`, and `maxCompletionTokens` alongside the existing sampler parameters. The LLM interaction log entry SHALL additionally carry an optional `reasoningLength` field whose value is the total character count of reasoning text streamed during the turn (success, abort, and mid-stream-error log entries alike), per the `reasoning-think-block` capability.

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

- **WHEN** `LLM_REASONING_EFFORT` is set to a value outside `{ "none", "minimal", "low", "medium", "high", "xhigh" }`
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

#### Scenario: Default max_completion_tokens is 4096 when LLM_MAX_COMPLETION_TOKENS is unset

- **GIVEN** `LLM_MAX_COMPLETION_TOKENS` is unset in the environment and the target story has no `_config.json` (or its `_config.json` does not override `maxCompletionTokens`)
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `max_completion_tokens: 4096`

#### Scenario: Custom env LLM_MAX_COMPLETION_TOKENS applies as default

- **GIVEN** `LLM_MAX_COMPLETION_TOKENS=8192` is set in the environment and the target story has no `_config.json`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `max_completion_tokens: 8192`

#### Scenario: Per-story maxCompletionTokens override replaces env default

- **GIVEN** env default `maxCompletionTokens=4096` (or any value) and the target story's `_config.json` contains `{ "maxCompletionTokens": 16384 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream chat completion request body SHALL contain `max_completion_tokens: 16384`

#### Scenario: Invalid LLM_MAX_COMPLETION_TOKENS falls back with warning

- **WHEN** `LLM_MAX_COMPLETION_TOKENS` is set to a value that fails the positive-safe-integer regex/predicate, including `"abc"`, `"4096abc"`, `"1e3"`, `"0"`, `"-100"`, `"3.14"`, `"01024"` (leading zero), or any decimal string whose numeric value is `≥ 2^53`
- **THEN** the env-derived `maxCompletionTokens` default SHALL fall back to `4096`, AND the server SHALL emit a warning log on startup naming the variable and the unrecognized value

#### Scenario: Empty or whitespace-only LLM_MAX_COMPLETION_TOKENS falls back silently

- **WHEN** `LLM_MAX_COMPLETION_TOKENS` is unset, empty, or contains only whitespace
- **THEN** the env-derived `maxCompletionTokens` default SHALL be `4096` AND no warning log SHALL be emitted (matching the silent-fallback behaviour of the other `numEnv` fields)

#### Scenario: max_completion_tokens always present in upstream body

- **GIVEN** any valid combination of env vars and `_config.json` overrides
- **WHEN** any chat request is dispatched upstream
- **THEN** the upstream request body SHALL contain a `max_completion_tokens` key whose value is the merged `maxCompletionTokens` integer (no opt-out switch)

#### Scenario: Operational and interaction logs include maxCompletionTokens

- **WHEN** the server dispatches a chat request
- **THEN** both the operational debug log entry (`LLM request payload`) and the LLM interaction log entry (`LLM request`, with the value nested under `parameters`) SHALL include the resolved `maxCompletionTokens` integer alongside the existing sampler parameters

#### Scenario: Upstream provider rejection surfaces the response body

- **GIVEN** a custom `LLM_API_URL` whose backend rejects the `reasoning` field with HTTP 400 and a JSON body `{"error":"unknown field: reasoning"}`
- **WHEN** a chat request is dispatched
- **THEN** the server SHALL respond to the client with an RFC 9457 Problem Details body whose `detail` field includes (a truncated form of) the upstream response body, AND SHALL log the same upstream body at error level

#### Scenario: Attribution headers attached on every chat request

- **WHEN** the server dispatches any chat completion request to the upstream LLM
- **THEN** the upstream `fetch` call SHALL carry exactly `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie`, and `X-OpenRouter-Categories: roleplay,creative-writing` in addition to `Content-Type` and `Authorization`

#### Scenario: Attribution headers identical regardless of LLM_API_URL

- **GIVEN** `LLM_API_URL` is set to a non-OpenRouter endpoint
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

### Requirement: Delete last chapter

The server SHALL expose `DELETE /api/stories/:series/:name/chapters/last` that deletes the highest-numbered `.md` chapter file in the story directory. The endpoint SHALL use the same path validation as other story endpoints. After deletion, the server SHALL return HTTP 200 with a JSON body containing the deleted chapter number. If no chapter files exist, the server SHALL return HTTP 404.

#### Scenario: Delete the last chapter file
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains `001.md`, `002.md`, and `003.md`
- **THEN** the server SHALL delete `003.md` and return HTTP 200 with `{ "deleted": 3 }`

#### Scenario: Delete when only one chapter exists
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains only `001.md`
- **THEN** the server SHALL delete `001.md` and return HTTP 200 with `{ "deleted": 1 }`

#### Scenario: Delete when no chapters exist
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains no `.md` chapter files
- **THEN** the server SHALL return HTTP 404

#### Scenario: Path traversal prevention on delete
- **WHEN** a client sends a DELETE request with path parameters containing `..` or other traversal sequences
- **THEN** the server SHALL reject the request with HTTP 400

### Requirement: Passphrase verification middleware

The writer backend SHALL mount a `verifyPassphrase` middleware on all `/api/` routes that checks the `X-Passphrase` header against `process.env.PASSPHRASE` using `crypto.timingSafeEqual`. If `PASSPHRASE` is not set, the middleware SHALL return HTTP 503 with a JSON body `{ "error": "PASSPHRASE environment variable is not set. Set it to enable API access." }` on all `/api` routes. If set but missing or incorrect, the middleware SHALL return HTTP 401.

#### Scenario: Middleware mounted before all API routes
- **WHEN** the server starts
- **THEN** the `verifyPassphrase` middleware SHALL be mounted via `app.use('/api', verifyPassphrase)` before any API route handlers

#### Scenario: PASSPHRASE not set returns 503
- **WHEN** a client sends any request to `/api/*` and the `PASSPHRASE` environment variable is not set
- **THEN** the server SHALL return HTTP 503 with `{ "error": "PASSPHRASE environment variable is not set. Set it to enable API access." }`

#### Scenario: Valid passphrase proceeds
- **WHEN** a client sends a request with a valid `X-Passphrase` header matching `process.env.PASSPHRASE`
- **THEN** the middleware SHALL call `next()` and allow the request to proceed

#### Scenario: Invalid passphrase returns 401
- **WHEN** a client sends a request with an incorrect or missing `X-Passphrase` header and `PASSPHRASE` is set
- **THEN** the middleware SHALL return HTTP 401

### Requirement: Auth verify endpoint

The writer backend SHALL expose `GET /api/auth/verify` that returns `{ "ok": true }` with HTTP 200 when the passphrase is valid or not configured. The endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

#### Scenario: Verify endpoint success
- **WHEN** a client sends `GET /api/auth/verify` with a valid passphrase (or no passphrase required)
- **THEN** the server SHALL return HTTP 200 with `{ "ok": true }`

### Requirement: Rate limiting
The server SHALL enforce request rate limits on API routes using fixed-window counters. Rate limits are relaxed for single-user deployment scenarios. Four rate-limit tiers SHALL be configured:
- **Global API**: 300 requests per minute on all `/api` routes
- **Auth verify**: 30 requests per minute on `/api/auth/verify`
- **Chat endpoint**: 30 requests per minute on `/api/stories/:series/:name/chat`
- **Preview prompt**: 60 requests per minute on `/api/stories/:series/:name/preview-prompt`

Stricter per-endpoint limits SHALL take precedence over the global limit. When a rate limit is exceeded, the server SHALL return HTTP 429 with a Problem Details JSON body.

#### Scenario: Global rate limit enforced
- **WHEN** a client exceeds 300 requests per minute to `/api` routes
- **THEN** the server SHALL return HTTP 429 with a Problem Details error

#### Scenario: Auth verify rate limit enforced
- **WHEN** a client exceeds 30 requests per minute to `/api/auth/verify`
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Chat endpoint rate limit enforced
- **WHEN** a client exceeds 30 requests per minute to the chat endpoint
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Preview prompt rate limit enforced
- **WHEN** a client exceeds 60 requests per minute to the preview-prompt endpoint
- **THEN** the server SHALL return HTTP 429 before the global limit is reached

#### Scenario: Normal usage within limits
- **WHEN** a client sends requests within the configured rate limits (including rapid page loads, polling fallback at 3-second intervals, and batch chapter loading)
- **THEN** all requests SHALL be processed normally without throttling

### Requirement: Error response sanitization
The server SHALL NOT forward raw upstream error response bodies (e.g., from the LLM API) to the client. Error responses SHALL contain only a generic error message and an HTTP status code. Internal error details SHALL be logged server-side but never exposed to the client.

#### Scenario: LLM error is sanitized
- **WHEN** the LLM API returns an error with a detailed error body
- **THEN** the server SHALL return a generic error message (e.g., `{ "error": "Chat request failed" }`) and log the full error details server-side

#### Scenario: Internal server error is sanitized
- **WHEN** an unexpected error occurs during request processing
- **THEN** the server SHALL return HTTP 500 with a generic message and SHALL NOT include stack traces or internal details in the response

### Requirement: Chapter count cap
The server SHALL limit the number of chapter files loaded into the chat prompt context to prevent memory exhaustion. When constructing the messages array for the LLM API, the server SHALL load at most a configurable maximum number of the most recent chapters (default: 50). Older chapters beyond the cap SHALL be excluded from the prompt.

#### Scenario: Chapters within cap
- **WHEN** a story has 30 chapters and the cap is 50
- **THEN** all 30 chapters SHALL be included in the prompt context

#### Scenario: Chapters exceed cap
- **WHEN** a story has 80 chapters and the cap is 50
- **THEN** only the 50 most recent chapters SHALL be included in the prompt context, and the earliest 30 SHALL be excluded

### Requirement: Request audit logging for security events
The server SHALL log security-relevant events including: failed authentication attempts, rate limit hits, path traversal rejections, and API errors. Logs SHALL include the timestamp, client IP (if available), request method, request path, and event type. Logs SHALL NOT include sensitive data such as passphrase values or full request bodies.

#### Scenario: Failed auth attempt is logged
- **WHEN** a client sends a request with an invalid passphrase
- **THEN** the server SHALL log the event with type `auth_failure`, the request path, and the client IP

#### Scenario: Rate limit hit is logged
- **WHEN** a client exceeds a rate limit
- **THEN** the server SHALL log the event with type `rate_limit`, the request path, and the client IP

#### Scenario: Successful requests are not logged
- **WHEN** a client sends a normal successful request
- **THEN** the server SHALL NOT generate an audit log entry for routine operations

### Requirement: Plugin loader initialization

The writer backend SHALL initialize the plugin loader at server startup, before any HTTP routes are mounted. The loader SHALL scan the built-in plugin directory (`plugins/`) and an optional external plugin directory specified by the `PLUGIN_DIR` environment variable. For each discovered plugin, the loader SHALL read the plugin manifest (JSON or YAML), validate its structure, register the plugin in the plugin registry, and call the plugin's `init` lifecycle hook. If a plugin fails to load (invalid manifest, missing required fields, init error), the server SHALL log a warning and continue loading remaining plugins. The server SHALL NOT crash due to a single plugin failure.

#### Scenario: Built-in plugins loaded at startup
- **WHEN** the server starts and the `plugins/` directory contains valid plugin manifests
- **THEN** all valid plugins SHALL be loaded, registered, and initialized before HTTP routes become available

#### Scenario: External plugin directory loaded
- **WHEN** the `PLUGIN_DIR` environment variable is set to a valid directory path
- **THEN** plugins from that directory SHALL be loaded in addition to built-in plugins

#### Scenario: No external plugin directory configured
- **WHEN** the `PLUGIN_DIR` environment variable is not set
- **THEN** only built-in plugins from `plugins/` SHALL be loaded

#### Scenario: Plugin with invalid manifest
- **WHEN** a plugin directory contains a manifest with missing required fields or invalid syntax
- **THEN** the server SHALL log a warning identifying the plugin and the validation error, skip that plugin, and continue loading others

#### Scenario: Plugin init failure
- **WHEN** a plugin's `init` lifecycle hook throws an error
- **THEN** the server SHALL log the error, mark the plugin as failed, and continue loading remaining plugins

### Requirement: Dynamic template variable collection from plugins

The `PluginManager` SHALL support collecting dynamic template variables from plugin backend modules. Plugin modules MAY export a `getDynamicVariables(context)` function. During template rendering, the `PluginManager` SHALL call each module's `getDynamicVariables` with a `DynamicVariableContext` object and merge the returned `Record<string, unknown>` into the Vento template context.

The `DynamicVariableContext` SHALL include the following read-only fields, all derived from data already materialized by `buildPromptFromStory()` in `writer/lib/story.ts`:

- `series: string` — the series identifier for the current request.
- `name: string` — the story identifier for the current request.
- `storyDir: string` — the absolute path to the story directory on disk.
- `userInput: string` — the raw user message that triggered this prompt build (the `message` argument of `buildPromptFromStory`); the empty string when the caller is the preview route and no message was supplied.
- `chapterNumber: number` — the 1-based number of the chapter that a subsequent write would target, computed by the shared `resolveTargetChapterNumber()` helper using the "reuse the last empty chapter file, otherwise use max(existing) + 1" rule; `1` when the story directory has no chapter files.
- `previousContent: string` — the unstripped content of the chapter immediately preceding `chapterNumber`; the empty string when no such chapter exists.
- `isFirstRound: boolean` — `true` when every existing chapter on disk is blank (matches the existing `isFirstRound` value already computed in `buildPromptFromStory`).
- `chapterCount: number` — the total number of `NNN.md` chapter files on disk, including any empty trailing file.

The context SHALL be a plain serializable object: it SHALL NOT contain functions, file handles, streams, API keys, or `AppConfig`.

The collision policy is unchanged: variables whose names collide with `#CORE_TEMPLATE_VARS` (`previous_context`, `user_input`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`) are rejected with a warning, and for inter-plugin collisions the first-loaded plugin's value wins.

#### Scenario: Plugin provides dynamic variables with rich context
- **WHEN** a plugin backend module exports `getDynamicVariables`
- **AND** `renderSystemPrompt()` is called for series "fantasy" and story "quest" with user input "enter the cave" during a turn where three chapters already exist (the third being empty)
- **THEN** `PluginManager.getDynamicVariables()` SHALL invoke the module with `{ series: "fantasy", name: "quest", storyDir, userInput: "enter the cave", chapterNumber: 3, previousContent: <content of chapter 2>, isFirstRound: false, chapterCount: 3 }`
- **AND** the returned variables SHALL be merged into the Vento template context

#### Scenario: First-round request with no chapters on disk
- **WHEN** a plugin's `getDynamicVariables` is invoked for a brand-new story whose directory contains no `NNN.md` files
- **THEN** the context SHALL be `{ ..., chapterNumber: 1, previousContent: "", isFirstRound: true, chapterCount: 0 }`

#### Scenario: Request targeting a new chapter after completed ones
- **WHEN** a plugin's `getDynamicVariables` is invoked and the story directory contains `001.md` and `002.md`, both non-empty
- **THEN** the context SHALL include `chapterNumber: 3`, `previousContent` equal to the full content of `002.md`, and `chapterCount: 2`

#### Scenario: Request reusing a trailing empty chapter file
- **WHEN** a plugin's `getDynamicVariables` is invoked and the story directory contains `001.md` (non-empty) and `002.md` (empty)
- **THEN** the context SHALL include `chapterNumber: 2`, `previousContent` equal to the content of `001.md`, and `chapterCount: 2`

#### Scenario: Plugin getDynamicVariables throws
- **WHEN** a plugin's `getDynamicVariables` throws an error
- **THEN** `PluginManager` SHALL log a warning and skip that plugin's variables without aborting the render

#### Scenario: No plugins export getDynamicVariables
- **WHEN** no loaded plugins export `getDynamicVariables`
- **THEN** `PluginManager.getDynamicVariables()` SHALL return an empty object and template rendering SHALL proceed normally

#### Scenario: Multiple plugins provide dynamic variables
- **WHEN** two or more plugins export `getDynamicVariables` returning overlapping variable names
- **THEN** the first-loaded plugin's value SHALL be kept for the conflicting key
- **AND** a warning SHALL be logged for the conflict

#### Scenario: Context excludes infrastructure objects
- **WHEN** a plugin's `getDynamicVariables` is invoked
- **THEN** the context object SHALL contain only the eight documented string/number/boolean fields
- **AND** it SHALL NOT expose `AppConfig`, environment variables, `AbortSignal`, the Hono `Context`, file handles, or any function reference

### Requirement: Core parameter declarations

The `getParameters()` method in `PluginManager` SHALL no longer include `status_data` in the core parameters list. The `status_data` parameter is now declared by the `state` plugin's manifest and appears as a plugin-provided parameter.

#### Scenario: Core parameters exclude status_data
- **WHEN** `pluginManager.getParameters()` is called
- **THEN** the returned array SHALL NOT contain an entry with `{ name: "status_data", source: "core" }`

#### Scenario: status_data appears as plugin parameter
- **WHEN** `pluginManager.getParameters()` is called and the state plugin is loaded
- **THEN** the returned array SHALL contain an entry with `{ name: "status_data", source: "state" }`

### Requirement: Dynamic known-variables for error suggestions (status_data removed from hardcoded list)

The hardcoded known-variables array in `writer/lib/errors.ts` SHALL no longer include `"status_data"`. The variable is now discoverable via the plugin's `parameters` declaration and will be included in Levenshtein suggestions through the `extraKnownVars` mechanism when the state plugin is loaded.

#### Scenario: Hardcoded known vars exclude status_data
- **WHEN** `buildVentoError()` constructs the known-variables list
- **THEN** the hardcoded array SHALL NOT contain `"status_data"`

#### Scenario: status_data still gets suggestions when plugin loaded
- **WHEN** the state plugin is loaded and a template references `{{ staus_data }}` (typo)
- **THEN** the error handler SHALL still suggest `status_data` because it is included via plugin parameters in `extraKnownVars`

### Requirement: StoryEngine interface update

The `StoryEngine` interface in `writer/types.ts` SHALL no longer include the `loadStatus` method. The `BuildPromptResult` interface SHALL no longer include the `statusContent` field NOR the legacy `prompt: string` field; it SHALL instead include a `messages: ChatMessage[]` field. The `RenderOptions` interface SHALL no longer include the `status` field.

#### Scenario: StoryEngine without loadStatus
- **WHEN** `writer/types.ts` is examined
- **THEN** `StoryEngine` SHALL NOT have a `loadStatus` method

#### Scenario: BuildPromptResult uses messages
- **WHEN** `writer/types.ts` is examined
- **THEN** `BuildPromptResult` SHALL include a `messages: ChatMessage[]` field
- **AND** SHALL NOT include `statusContent` or `prompt: string`

#### Scenario: RenderOptions without status
- **WHEN** `writer/types.ts` is examined
- **THEN** `RenderOptions` SHALL NOT have a `status` field

### Requirement: PluginModule interface update

The `PluginModule` interface in `writer/types.ts` SHALL declare `getDynamicVariables` using the widened `DynamicVariableContext`.

#### Scenario: PluginModule with getDynamicVariables uses rich context
- **WHEN** `writer/types.ts` is examined
- **THEN** `PluginModule` SHALL include `getDynamicVariables?: (context: DynamicVariableContext) => Promise<Record<string, unknown>> | Record<string, unknown>`
- **AND** `DynamicVariableContext` SHALL include the fields `series`, `name`, `storyDir`, `userInput`, `chapterNumber`, `previousContent`, `isFirstRound`, and `chapterCount`

### Requirement: Prompt preview endpoint

The writer backend SHALL expose `POST /api/stories/:series/:name/preview-prompt` that returns the fully rendered prompt without sending it to the LLM API. The request body SHALL accept an optional `message` field (the simulated user message; empty string if absent) and an optional `template` field (an unsaved template override from the Prompt Editor; falls back to the file at `PROMPT_FILE` when absent). The endpoint SHALL execute the same prompt construction pipeline (including the `prompt-assembly` hook for plugin prompt fragments and dynamic plugin variables) and return the assembled `messages: ChatMessage[]` array as JSON. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes. The `variables` response field SHALL NOT contain `status_data` as a separate core variable; if the state plugin is loaded, `status_data` will be present in the rendered output via the plugin's dynamic variables. The legacy `prompt: string` response field is REMOVED.

#### Scenario: Preview prompt for a story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with a valid passphrase
- **THEN** the server SHALL construct the full prompt using the same pipeline as the chat endpoint (including plugin prompt assembly) and return `{ messages: ChatMessage[], variables: {...} }` in the response body without calling the LLM API

#### Scenario: Preview prompt includes plugin contributions
- **WHEN** plugins have registered `prompt-assembly` handlers
- **THEN** the preview response's `messages` array SHALL include the plugin-contributed prompt sections in the rendered output

#### Scenario: Preview prompt with no chapters
- **WHEN** the story has no chapters with content
- **THEN** the preview SHALL render with `isFirstRound` as `true` and `previous_context` as an empty array

#### Scenario: Preview response omits status_data from core variables
- **WHEN** a client calls the preview endpoint
- **THEN** the `variables` object in the response SHALL NOT contain a `status_data` field as a core variable

#### Scenario: Preview response uses messages shape
- **WHEN** a client calls the preview endpoint
- **THEN** the response body SHALL include `messages: ChatMessage[]` and SHALL NOT include the legacy `prompt: string` field

### Requirement: Plugin API endpoints

The writer backend SHALL expose `GET /api/plugins` that returns a JSON array of loaded plugins. Each entry SHALL include the plugin `name`, `type` (full-stack, prompt-only, frontend-only, hook-only), `enabled` status, and a list of registered `hooks`. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

#### Scenario: List all loaded plugins
- **WHEN** a client sends `GET /api/plugins` with a valid passphrase
- **THEN** the server SHALL return a JSON array containing an entry for each loaded plugin with its name, type, enabled status, and registered hooks

#### Scenario: No plugins loaded
- **WHEN** no plugins are loaded (empty `plugins/` directory and no `PLUGIN_DIR`)
- **THEN** the server SHALL return an empty JSON array `[]`

### Requirement: Per-story LLM config REST endpoints

The server SHALL expose two authenticated routes for managing per-story LLM overrides:

- `GET /api/:series/:name/config` SHALL return the story's validated overrides as a JSON object, or `{}` when `_config.json` does not exist.
- `PUT /api/:series/:name/config` SHALL accept a JSON object body, validate it against the LLM parameter whitelist (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`), strip unknown keys as well as `null` / `undefined` values, and persist the normalised object to `playground/<series>/<story>/_config.json`. The target story directory MUST already exist before the PUT; if it does not, the server SHALL respond with HTTP 404 Problem Details and SHALL NOT create the directory or the file.

Both routes SHALL sit behind the existing `X-Passphrase` auth middleware, SHALL be subject to the existing global rate limiter, and SHALL resolve `:series` and `:name` through the existing `safePath()` helper. Error responses SHALL use RFC 9457 Problem Details. These routes SHALL NOT collide with the existing public `GET /api/config` endpoint.

#### Scenario: GET returns empty object when file is absent

- **GIVEN** a valid story with no `_config.json`
- **WHEN** an authenticated client issues `GET /api/:series/:name/config`
- **THEN** the response SHALL be HTTP 200 with body `{}`

#### Scenario: PUT persists validated overrides

- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{ "temperature": 0.9, "topK": 5, "unknown": "x" }`
- **THEN** the server SHALL write `{ "temperature": 0.9, "topK": 5 }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: PUT rejects wrong-type value

- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{ "temperature": "hot" }`
- **THEN** the server SHALL respond HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT modify the persisted file

#### Scenario: Unauthenticated request is rejected

- **WHEN** a client issues `GET /api/:series/:name/config` without a valid `X-Passphrase` header
- **THEN** the server SHALL respond HTTP 401 with an RFC 9457 Problem Details body

#### Scenario: Path traversal is rejected

- **WHEN** a client supplies a `:series` or `:name` that would resolve outside the playground directory
- **THEN** the server SHALL respond HTTP 400 and SHALL NOT read or write any file

#### Scenario: PUT for a non-existent story returns 404

- **GIVEN** a `:series`/`:name` pair that passes `safePath()` but whose story directory does not exist under `playground/`
- **WHEN** an authenticated client issues `PUT /api/:series/:name/config`
- **THEN** the server SHALL respond with HTTP 404 and an RFC 9457 Problem Details body and SHALL NOT create the story directory or `_config.json`

#### Scenario: PUT persists reasoning overrides

- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{ "reasoningEnabled": false, "reasoningEffort": "low" }`
- **THEN** the server SHALL write `{ "reasoningEnabled": false, "reasoningEffort": "low" }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: PUT rejects invalid reasoningEffort

- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{ "reasoningEffort": "extreme" }`
- **THEN** the server SHALL respond HTTP 400 with an RFC 9457 Problem Details body identifying `reasoningEffort` as the offending field and SHALL NOT modify the persisted file

### Requirement: Token usage persistence in chat execution

`executeChat()` in `writer/lib/chat-shared.ts` SHALL, on successful completion, append a `TokenUsageRecord` (shape defined in the `token-usage-tracking` capability) to `playground/<series>/<story>/_usage.json` via the helper `appendUsage()` in a new `writer/lib/usage.ts` module, provided the captured `tokenUsage` has non-null `prompt`, `completion`, and `total` values. Aborted or errored generations SHALL NOT append records. Failures during the append SHALL be logged and swallowed so the chat result is still returned to the client. The returned `ChatResult` SHALL gain an optional field `usage: TokenUsageRecord | null` populated from the appended record (or `null` when none was appended).

#### Scenario: Successful generation appends a record and returns it
- **GIVEN** `executeChat()` runs with upstream usage `{ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }`
- **WHEN** generation completes normally
- **THEN** a record with those values, the resolved `model`, the target chapter number, and an ISO 8601 timestamp SHALL be appended to `_usage.json`, and `ChatResult.usage` SHALL equal that record

#### Scenario: Aborted generation leaves `_usage.json` untouched
- **GIVEN** the client aborts the WebSocket generation mid-stream
- **WHEN** `executeChat()` throws `ChatAbortError`
- **THEN** no record SHALL be appended

#### Scenario: Append failure does not fail the chat
- **GIVEN** `appendUsage()` throws an I/O error (e.g. read-only directory)
- **WHEN** `executeChat()` handles the error
- **THEN** `executeChat()` SHALL still return a `ChatResult` with the generated content and SHALL log the append failure at warn level

### Requirement: `GET /api/stories/:series/:name/usage` route registration

The backend SHALL register `GET /api/stories/:series/:name/usage` via a new `registerUsageRoutes(app, deps)` in `writer/routes/usage.ts`, wired from `writer/app.ts` behind the existing auth + rate-limit middleware. The handler SHALL validate `:series`/`:name` via `safePath()` (rejecting underscore-prefixed and traversing paths), read the ledger via `readUsage()`, compute totals via `computeTotals()`, and return `{ records, totals }` as HTTP 200 JSON. Absent ledger SHALL yield an empty-but-valid response; malformed ledger SHALL be treated as empty (the backup behaviour in `appendUsage()` is the single source of truth for recovery).

#### Scenario: Route is mounted behind auth
- **WHEN** a client calls `GET /api/stories/<series>/<name>/usage` without a valid `X-Passphrase`
- **THEN** the server SHALL respond with HTTP 401 via the existing passphrase middleware

#### Scenario: Route rejects reserved series/name
- **WHEN** a client calls `GET /api/stories/_prompts/foo/usage` with a valid passphrase
- **THEN** the server SHALL respond with HTTP 400 via the existing reserved-directory validation

#### Scenario: Route returns empty ledger for fresh story
- **GIVEN** a story with no `_usage.json`
- **WHEN** an authenticated client calls the endpoint
- **THEN** the response SHALL be HTTP 200 with `{ records: [], totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 } }`

### Requirement: LLM defaults exposure endpoint

The server SHALL register an authenticated `GET /api/llm-defaults` route that returns the env-derived `llmDefaults` filtered to exactly the keys allowed in the per-story `_config.json` whitelist. The route SHALL be registered under the same `X-Passphrase`-checking middleware as the per-story config routes; an unauthenticated request SHALL be rejected with HTTP 401 and a Problem Details body, exactly mirroring the existing per-story config route's auth behaviour.

The response body SHALL be a JSON object whose top-level keys are exactly the per-story `_config.json` whitelist: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort` (and `maxCompletionTokens` once that field is added to the whitelist by the `update-llm-defaults-and-completion-tokens` change). Every key SHALL be present and well-typed: `model` SHALL be a non-empty string, `reasoningEnabled` SHALL be a boolean, `reasoningEffort` SHALL be one of the literal `REASONING_EFFORTS` values, every other listed key SHALL be a finite number (positive safe integer for `maxCompletionTokens` once added). The response SHALL NOT include any other key — in particular the route handler SHALL NOT serialize the entire `LlmConfig` object, and SHALL NOT leak `LLM_API_URL`, `LLM_API_KEY`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, or any other non-whitelist field.

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
- **THEN** the response body SHALL NOT contain any of: `apiKey`, `apiUrl`, `LLM_API_KEY`, `LLM_API_URL`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`, AND SHALL NOT contain any key not listed in the per-story `_config.json` whitelist

#### Scenario: Response keys lock-step with the per-story whitelist

- **GIVEN** `writer/lib/story-config.ts` exports a single source-of-truth constant `STORY_LLM_CONFIG_KEYS` listing the whitelisted per-story `_config.json` keys
- **WHEN** the per-story `_config.json` whitelist gains or loses a key (e.g. `maxCompletionTokens` is added by the `update-llm-defaults-and-completion-tokens` change) by editing `STORY_LLM_CONFIG_KEYS`
- **THEN** the `GET /api/llm-defaults` response SHALL gain or lose the same key in the same shape, AND a backend test SHALL compare `Object.keys(response).sort()` against `[...STORY_LLM_CONFIG_KEYS].sort()` and fail loudly if the two sets of keys diverge

#### Scenario: Response is not cached by intermediaries

- **WHEN** an authenticated client receives a `GET /api/llm-defaults` response
- **THEN** the response SHALL include a `Cache-Control: no-store` header so a deployment env change picked up by a manual server restart is reflected on the next fetch without intermediary cache hits
