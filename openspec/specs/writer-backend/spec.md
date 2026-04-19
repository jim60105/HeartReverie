# Writer Backend

## Purpose

Deno application using Hono framework with TypeScript that serves the reader frontend, exposes REST API endpoints for story management, and proxies chat requests to an LLM API with a faithful prompt construction pipeline.

## Requirements

### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with TypeScript ESM modules. Route handlers SHALL be organized into separate module files under `writer/routes/`. Middleware functions SHALL be extracted into `writer/lib/middleware.ts`. Configuration SHALL be centralized in `writer/lib/config.ts`. Error response construction SHALL use a shared `problemJson()` helper from `writer/lib/errors.ts`. The server SHALL also register the lore CRUD routes from `writer/routes/lore.ts` alongside other core routes during initialization.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started with valid TLS certificates via `deno run`
- **THEN** the server SHALL listen on HTTPS and serve files from the `reader/` directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers, each imported from its respective route module, including the lore CRUD routes

#### Scenario: Modular route structure
- **WHEN** a developer inspects the `writer/routes/` directory
- **THEN** each file contains handlers for a single API domain (auth, stories, chapters, chat, plugins, prompt, lore)

#### Scenario: TypeScript type checking passes
- **WHEN** a developer runs `deno check` on the writer backend entry point
- **THEN** all TypeScript files under `writer/` SHALL pass type checking without errors

### Requirement: Type-safe dependency injection

The dependency bag passed to `createApp()` and route registrars SHALL conform to the `AppDeps` interface defined in `writer/types.ts`. Route registrar functions SHALL receive typed dependency parameters rather than untyped objects.

#### Scenario: createApp receives typed dependencies
- **WHEN** `createApp()` is called with a dependency object
- **THEN** the parameter SHALL be typed as `AppDeps` and the TypeScript compiler SHALL reject any call that does not satisfy the interface

#### Scenario: Route registrar receives typed deps
- **WHEN** a route registrar function (e.g., `registerChatRoutes`) receives the deps parameter
- **THEN** the parameter SHALL be typed as the appropriate subset interface of `AppDeps`, and accessing properties not defined in the interface SHALL produce a compile-time error

### Requirement: Story directory listing

The server SHALL expose `GET /api/stories` to list story series directories under `playground/`. The server SHALL expose `GET /api/stories/:series` to list story name directories under `playground/:series/`. Directory listings SHALL exclude hidden files/directories (those starting with `.`), non-directory entries, and system-reserved directories (those starting with `_`, such as `_lore` and `_prompts`).

#### Scenario: List all story series
- **WHEN** a client sends `GET /api/stories`
- **THEN** the server SHALL return a JSON array of directory names found directly under `playground/`, excluding hidden directories and any underscore-prefixed directories (e.g., `_lore/`, `_prompts/`)

#### Scenario: List stories within a series
- **WHEN** a client sends `GET /api/stories/:series` with a valid series name
- **THEN** the server SHALL return a JSON array of directory names found under `playground/:series/`, excluding hidden directories and any underscore-prefixed directories (e.g., `_lore/`)

#### Scenario: Series not found
- **WHEN** a client sends `GET /api/stories/:series` with a non-existent series name
- **THEN** the server SHALL return HTTP 404

### Requirement: Reserved directory name validation
The server SHALL reject directory names starting with `_` (underscore) as series or story identifiers in all endpoints that accept series or story parameters. This prevents collision between user-created directories and system-reserved directories such as `_lore`.

#### Scenario: Reject underscore-prefixed series name
- **WHEN** a client sends a request with series parameter set to `_lore` or any other underscore-prefixed name
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject underscore-prefixed story name
- **WHEN** a client sends a request with story parameter set to `_lore` or any other underscore-prefixed name in any endpoint
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

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `isFirstRound` (boolean, true when no chapters with content exist), and `plugin_prompts` (array of `{name, content}` objects contributed by plugins via the prompt-assembly hook). Additionally, `renderSystemPrompt()` SHALL call `pluginManager.getDynamicVariables({ series, name, storyDir })` and spread the returned variables into the Vento template context. It SHALL also call the lore retrieval engine in `writer/lib/lore.ts` directly with the active series and story context, and spread the returned lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) into the Vento template render context. See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

Before rendering the template, the server SHALL invoke the `prompt-assembly` hook stage. Each registered plugin handler SHALL return a `{name, content}` object representing the plugin's prompt fragment. The server SHALL collect all returned prompt fragments into the `plugin_prompts` array, ordered by handler priority. The `plugin_prompts` array SHALL be passed to the Vento template alongside the existing variables.

The Vento template rendering call SHALL pass all variables to the `system.md` template, including plugin variables collected from the prompt-assembly hook and lore variables computed directly by the lore retrieval engine.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The messages array SHALL be simplified to exactly two messages: a system message containing the fully rendered template output, followed by a user message containing the raw user input.

Before including chapter content in the `previous_context` array, the server SHALL strip tags declared in each plugin's `promptStripTags` manifest field from the chapter text, rather than using a hardcoded list. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_prompts`, pass `previous_context` as an empty array, `user_input` as the raw user message, `isFirstRound` as `true`, and `plugin_prompts` as the collected array to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_prompts`, pass `previous_context` as an array of stripped chapter contents in numerical order, `user_input` as the raw user message, `isFirstRound` as `false`, and `plugin_prompts` as the collected array to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Plugin-contributed prompt fragments assembled
- **WHEN** the `prompt-assembly` hook is invoked and multiple plugins have registered handlers
- **THEN** each handler SHALL be called in priority order and the returned `{name, content}` objects SHALL be collected into the `plugin_prompts` array passed to the template

#### Scenario: No plugins contribute prompt fragments
- **WHEN** the `prompt-assembly` hook is invoked and no plugins have registered handlers
- **THEN** `plugin_prompts` SHALL be an empty array and the template SHALL render without plugin prompt sections

#### Scenario: Chapter tag stripping uses plugin-declared promptStripTags
- **WHEN** a chapter's content contains tags declared by plugins in their `promptStripTags` manifest field (e.g., `<options>`, `<disclaimer>`, `<user_message>`)
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain any tags declared in any plugin's `promptStripTags`
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `system.md` with variables collected from the prompt-assembly hook and from the lore retrieval engine as the template data

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message

#### Scenario: Lore variables available in template
- **WHEN** the lore system is active and lore passages exist for the current story context
- **THEN** the template rendering SHALL include lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) in the Vento template context alongside other variables

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

The `llmDefaults` object SHALL be built from the following environment variables (applied when the variable is unset or fails numeric parsing, the field SHALL use the stated default): `LLM_MODEL` (default `deepseek/deepseek-v3.2`), `LLM_TEMPERATURE` (default `0.1`), `LLM_FREQUENCY_PENALTY` (default `0.13`), `LLM_PRESENCE_PENALTY` (default `0.52`), `LLM_TOP_K` (default `10`), `LLM_TOP_P` (default `0`), `LLM_REPETITION_PENALTY` (default `1.2`), `LLM_MIN_P` (default `0`), `LLM_TOP_A` (default `1`).

`storyOverrides` SHALL be the validated partial subset of those same fields read from `playground/<series>/<story>/_config.json` (absent file ⇒ empty overrides). Only the whitelisted keys `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA` SHALL be honoured; unknown keys SHALL be ignored. Values whose type does not match the whitelist SHALL cause the request to fail with an RFC 9457 Problem Details error.

The merged configuration SHALL be used to populate the upstream request body (mapping camelCase fields to their OpenAI-compatible snake_case equivalents: `frequencyPenalty` → `frequency_penalty`, `presencePenalty` → `presence_penalty`, `topK` → `top_k`, `topP` → `top_p`, `repetitionPenalty` → `repetition_penalty`, `minP` → `min_p`, `topA` → `top_a`). The server SHALL stream the response using SSE and write content deltas to the chapter file in real time.

Before streaming the AI response, the server SHALL write the user's chat message to the chapter file wrapped in `<user_message>` and `</user_message>` tags, followed by a blank line. The user message block SHALL appear at the beginning of the chapter file, before any AI-generated content. The `<user_message>` block SHALL also be included in the full content returned in the HTTP response.

The server SHALL parse the SSE response by reading `data:` lines from the response body stream. Each line with a JSON payload SHALL have `choices[0].delta.content` extracted and appended to the chapter file immediately. The `data: [DONE]` sentinel SHALL signal end of stream. The server SHALL open the chapter file before streaming begins and write each content delta as it arrives, allowing the frontend auto-reload polling to display partial content during generation. After the stream completes, the server SHALL return the complete chapter content in the HTTP response.

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

The `StoryEngine` interface in `writer/types.ts` SHALL no longer include the `loadStatus` method. The `BuildPromptResult` interface SHALL no longer include the `statusContent` field. The `RenderOptions` interface SHALL no longer include the `status` field.

#### Scenario: StoryEngine without loadStatus
- **WHEN** `writer/types.ts` is examined
- **THEN** `StoryEngine` SHALL NOT have a `loadStatus` method

#### Scenario: BuildPromptResult without statusContent
- **WHEN** `writer/types.ts` is examined
- **THEN** `BuildPromptResult` SHALL NOT have a `statusContent` field

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

The writer backend SHALL expose `GET /api/stories/:series/:name/preview-prompt` that returns the fully rendered system prompt without sending it to the LLM API. The endpoint SHALL execute the same prompt construction pipeline (including the `prompt-assembly` hook for plugin prompt fragments and dynamic plugin variables) and return the rendered prompt as plain text or JSON. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes. The `variables` response field SHALL NOT contain `status_data` as a separate core variable; if the state plugin is loaded, `status_data` will be present in the rendered output via the plugin's dynamic variables.

#### Scenario: Preview prompt for a story
- **WHEN** a client sends `GET /api/stories/:series/:name/preview-prompt` with a valid passphrase
- **THEN** the server SHALL construct the full system prompt using the same pipeline as the chat endpoint (including plugin prompt assembly) and return it in the response body without calling the LLM API

#### Scenario: Preview prompt includes plugin contributions
- **WHEN** plugins have registered `prompt-assembly` handlers
- **THEN** the preview response SHALL include the plugin-contributed prompt sections in the rendered output

#### Scenario: Preview prompt with no chapters
- **WHEN** the story has no chapters with content
- **THEN** the preview SHALL render with `isFirstRound` as `true` and `previous_context` as an empty array

#### Scenario: Preview response omits status_data from core variables
- **WHEN** a client calls the preview endpoint
- **THEN** the `variables` object in the response SHALL NOT contain a `status_data` field as a core variable

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
- `PUT /api/:series/:name/config` SHALL accept a JSON object body, validate it against the LLM parameter whitelist (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`), strip unknown keys as well as `null` / `undefined` values, and persist the normalised object to `playground/<series>/<story>/_config.json`. The target story directory MUST already exist before the PUT; if it does not, the server SHALL respond with HTTP 404 Problem Details and SHALL NOT create the directory or the file.

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
