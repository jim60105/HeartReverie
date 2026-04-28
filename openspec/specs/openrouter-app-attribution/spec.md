# openrouter-app-attribution Specification

## Purpose

Define how the HeartReverie server attributes itself to OpenRouter (and any other upstream LLM provider that honours the same headers) by attaching three hard-coded HTTP headers — `HTTP-Referer`, `X-OpenRouter-Title`, and `X-OpenRouter-Categories` — to every outbound chat completion request. The capability also pins these values to a single source-of-truth constant so that forks can re-attribute by editing one file rather than chasing multiple configuration surfaces.

## Requirements

### Requirement: Hard-coded attribution headers attached to LLM requests

The server SHALL attach exactly three OpenRouter app-attribution HTTP headers to every outbound chat completion request issued from the LLM proxy. The headers SHALL be sourced from a single module-level frozen constant and SHALL NOT be configurable at runtime via environment variables, story-level `_config.json`, the HTTP API, prompt template variables, or any frontend UI.

The constant SHALL contain exactly the following three entries, with these exact wire values:

- `HTTP-Referer: https://github.com/jim60105/HeartReverie`
- `X-OpenRouter-Title: HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2` (the UTF-8 percent-encoded form of `HeartReverie 浮心夜夢`; raw non-Latin-1 bytes are not valid in HTTP header values per the WHATWG fetch / HTTP spec and would be rejected by `fetch()`)
- `X-OpenRouter-Categories: roleplay,creative-writing`

All three headers SHALL be present on every upstream chat `fetch()` call, alongside `Content-Type` and `Authorization`. The headers SHALL be sent regardless of the configured `LLM_API_URL`; the server SHALL NOT inspect the URL to decide whether to attach them.

The constant SHALL be defined as a frozen object (e.g., via `Object.freeze` or `as const` + `Readonly<Record<string, string>>`) so accidental runtime mutation is not possible.

#### Scenario: Default chat request carries all three attribution headers

- **WHEN** the server dispatches a chat completion request to the configured `LLM_API_URL`
- **THEN** the upstream `fetch` request SHALL include `HTTP-Referer: https://github.com/jim60105/HeartReverie`, `X-OpenRouter-Title: HeartReverie%20%E6%B5%AE%E5%BF%83%E5%A4%9C%E5%A4%A2` (UTF-8 percent-encoded form of `HeartReverie 浮心夜夢`), and `X-OpenRouter-Categories: roleplay,creative-writing`

#### Scenario: Headers attached even when LLM_API_URL is non-OpenRouter

- **WHEN** `LLM_API_URL` is set to a non-OpenRouter endpoint (for example, a self-hosted vLLM URL) and a chat completion request is dispatched
- **THEN** the upstream `fetch` request SHALL still include all three attribution headers with their hard-coded values (the server SHALL NOT inspect the URL)

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

### Requirement: Attribution headers documented for forks

`AGENTS.md` SHALL document that the three OpenRouter app-attribution headers are sent on every chat request and SHALL identify the source-code constant (its name and file path) where the values live. The documentation SHALL state that forks intending to attribute their usage separately from the canonical HeartReverie deployment MUST edit that constant in source.

#### Scenario: AGENTS.md identifies the attribution constant

- **WHEN** a contributor reads `AGENTS.md`
- **THEN** the document SHALL contain a section (or paragraph) that names the constant (`LLM_APP_ATTRIBUTION_HEADERS`) and its file location (`writer/lib/chat-shared.ts`), lists the three headers and their default values, and instructs forks to edit the constant if they want different attribution
