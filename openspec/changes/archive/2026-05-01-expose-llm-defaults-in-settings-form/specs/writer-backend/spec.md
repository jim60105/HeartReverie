## ADDED Requirements

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
- **THEN** the response body SHALL NOT contain any of: `apiKey`, `apiUrl`, `LLM_API_KEY`, `LLM_API_URL`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`, `PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`, AND SHALL NOT contain any key not listed in the per-story `_config.json` whitelist

#### Scenario: Response keys lock-step with the per-story whitelist

- **GIVEN** `writer/lib/story-config.ts` exports a single source-of-truth constant `STORY_LLM_CONFIG_KEYS` listing the whitelisted per-story `_config.json` keys
- **WHEN** the per-story `_config.json` whitelist gains or loses a key (e.g. `maxCompletionTokens` is added by the `update-llm-defaults-and-completion-tokens` change) by editing `STORY_LLM_CONFIG_KEYS`
- **THEN** the `GET /api/llm-defaults` response SHALL gain or lose the same key in the same shape, AND a backend test SHALL compare `Object.keys(response).sort()` against `[...STORY_LLM_CONFIG_KEYS].sort()` and fail loudly if the two sets of keys diverge

#### Scenario: Response is not cached by intermediaries

- **WHEN** an authenticated client receives a `GET /api/llm-defaults` response
- **THEN** the response SHALL include a `Cache-Control: no-store` header so a deployment env change picked up by a manual server restart is reflected on the next fetch without intermediary cache hits
