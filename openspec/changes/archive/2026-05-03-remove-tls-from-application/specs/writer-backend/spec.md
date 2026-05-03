## MODIFIED Requirements

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

- **WHEN** `writer/server.ts` is examined
- **THEN** it SHALL NOT contain references to `CERT_FILE`, `KEY_FILE`, `HTTP_ONLY`, `cert:`, or `key:` and SHALL pass `Deno.serve()` only `port` and `hostname` options

### Requirement: GET /api/llm-defaults response excludes secrets

The `GET /api/llm-defaults` route SHALL return a JSON body whose top-level keys are exactly the keys in `STORY_LLM_CONFIG_KEYS`. The response SHALL NOT include any secret, transport, deployment, or filesystem-path environment variable; specifically the response SHALL NOT contain any of the keys `apiKey`, `apiUrl`, `LLM_API_KEY`, `LLM_API_URL`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `PORT`, `PLAYGROUND_DIR`, `READER_DIR`, or `PLUGIN_DIR`. The response SHALL include a `Cache-Control: no-store` header.

#### Scenario: Authenticated request returns the per-story whitelist

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
- **WHEN** the per-story `_config.json` whitelist gains or loses a key by editing `STORY_LLM_CONFIG_KEYS`
- **THEN** the `GET /api/llm-defaults` response SHALL gain or lose the same key in the same shape, AND a backend test SHALL compare `Object.keys(response).sort()` against `[...STORY_LLM_CONFIG_KEYS].sort()` and fail loudly if the two sets of keys diverge

#### Scenario: Response is not cached by intermediaries

- **WHEN** an authenticated client receives a `GET /api/llm-defaults` response
- **THEN** the response SHALL include a `Cache-Control: no-store` header so a deployment env change picked up by a manual server restart is reflected on the next fetch without intermediary cache hits
