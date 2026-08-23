## MODIFIED Requirements

### Requirement: Hard-coded attribution headers attached to LLM requests

The server SHALL attach exactly three OpenRouter app-attribution HTTP headers to every outbound chat completion request issued from the LLM proxy. The headers SHALL be sourced from a single module-level frozen constant and SHALL NOT be configurable at runtime via environment variables, story-level `_config.json`, the HTTP API, prompt template variables, or any frontend UI.

The constant SHALL contain exactly the following three entries, with these exact wire values:

- `HTTP-Referer: https://github.com/jim60105/HeartReverie`
- `X-OpenRouter-Title: HeartReverie` (plain ASCII; OpenRouter's rankings UI does not render non-Latin-1 / percent-encoded titles legibly, so the project name's CJK suffix is intentionally omitted from the wire value)
- `X-OpenRouter-Categories: roleplay,creative-writing`

All three headers SHALL be present on every upstream chat `fetch()` call, alongside `Content-Type` and — when `LLM_API_KEY` is set — the `Authorization` header. The headers SHALL be sent regardless of the configured `LLM_API_URL`; the server SHALL NOT inspect the URL to decide whether to attach them. When `LLM_API_KEY` is unset or empty the `Authorization` header is omitted, but the three attribution headers are still attached.

The constant SHALL be defined as a frozen object (e.g., via `Object.freeze` or `as const` + `Readonly<Record<string, string>>`) so accidental runtime mutation is not possible.

#### Scenario: Default chat request carries all three attribution headers

- **WHEN** the server dispatches a chat completion request to the configured `LLM_API_URL`
- **THEN** the upstream `fetch` request SHALL include `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie`, and `X-OpenRouter-Categories: roleplay,creative-writing`

#### Scenario: Headers attached even when LLM_API_URL is non-OpenRouter

- **WHEN** `LLM_API_URL` is set to a non-OpenRouter endpoint (for example, a self-hosted vLLM URL) and a chat completion request is dispatched
- **THEN** the upstream `fetch` request SHALL still include all three attribution headers with their hard-coded values (the server SHALL NOT inspect the URL)

#### Scenario: Headers attached when LLM_API_KEY is unset

- **WHEN** `LLM_API_KEY` is unset or empty and a chat completion request is dispatched
- **THEN** the upstream `fetch` request SHALL include the three attribution headers and SHALL NOT include an `Authorization` header

#### Scenario: Headers identical across stories and requests

- **WHEN** chat requests are dispatched for two different stories (or the same story twice in a row)
- **THEN** every upstream `fetch` request SHALL carry exactly the same three attribution header values; per-story or per-request divergence SHALL NOT occur

#### Scenario: Per-story config cannot override attribution

- **GIVEN** a story's `_config.json` contains a key such as `appReferer`, `attribution`, `httpReferer`, or any similarly named field
- **WHEN** a chat request targets that story
- **THEN** the field SHALL be ignored by the existing `_config.json` whitelist, and the upstream `fetch` request SHALL still carry the three hard-coded attribution headers unchanged

#### Scenario: No attribution-related env vars exist

- **WHEN** an operator or developer searches the codebase or documentation for env vars matching `LLM_APP_*`
- **THEN** none SHALL exist; the `AGENTS.md` env-vars table SHALL NOT list any attribution-related variable, and `writer/lib/config.ts` SHALL NOT read any such variable

#### Scenario: Attribution headers absent from prompt template variables

- **WHEN** the server collects template variables for prompt rendering
- **THEN** the variable namespace SHALL NOT include any `app_referer`, `app_title`, `app_categories`, or similarly named entries
