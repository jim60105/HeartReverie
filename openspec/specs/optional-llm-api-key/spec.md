# Optional LLM API Key

## Purpose

Makes the `LLM_API_KEY` environment variable optional so the server works against keyless local or private LLM providers (e.g. Ollama, vLLM, LM Studio) without configuration changes, while still attaching `Authorization: Bearer <key>` to every upstream chat-completion request when a key is configured.

## Requirements

### Requirement: LLM_API_KEY is optional for keyless local providers

The `LLM_API_KEY` environment variable SHALL be optional. When it is set to a non-empty value, the server SHALL attach an `Authorization: Bearer <key>` header to every upstream LLM chat-completion request. When `LLM_API_KEY` is unset or empty, the server SHALL proceed with the request without an `Authorization` header, so that keyless local or private LLM providers (e.g. Ollama, vLLM, LM Studio) work without configuration changes. The missing key SHALL NOT cause an HTTP 500 error in the chat flow or in plugin-action preflight.

#### Scenario: Request succeeds without LLM_API_KEY

- **WHEN** `LLM_API_KEY` is unset or empty and a chat completion request is dispatched
- **THEN** the server SHALL send the upstream request without an `Authorization` header, and the chat flow SHALL NOT return HTTP 500 for the missing key

#### Scenario: Authorization header present when key is set

- **GIVEN** `LLM_API_KEY` is set to a non-empty value (e.g. `sk-test`)
- **WHEN** a chat completion request is dispatched upstream
- **THEN** the upstream `fetch` request SHALL carry `Authorization: Bearer sk-test`

#### Scenario: Plugin actions proceed without a key

- **WHEN** a plugin action (`POST /api/plugins/<name>/run-prompt`) is executed while `LLM_API_KEY` is unset or empty
- **THEN** the preflight check SHALL NOT return the "LLM_API_KEY is not configured" 500 outcome, and the action SHALL proceed to the LLM call without an `Authorization` header

#### Scenario: Startup warning is informational

- **WHEN** the server starts without `LLM_API_KEY`
- **THEN** the server SHALL log a warning noting that cloud providers will reject unauthenticated requests while keyless local providers remain usable; startup SHALL NOT fail

### Requirement: Conditional Authorization header construction

The upstream LLM `fetch()` call SHALL build its request headers conditionally: the `Authorization` header SHALL be included only when `LLM_API_KEY` resolves to a non-empty value. When the variable is unset or empty, the request headers SHALL contain `Content-Type: application/json` and the three hard-coded OpenRouter attribution headers, and SHALL NOT contain an `Authorization` key at all. The previous unconditional `Bearer ${Deno.env.get("LLM_API_KEY")}` interpolation (which produced the literal value `Bearer undefined` when the variable was missing) SHALL be removed.

#### Scenario: Header map built without key

- **WHEN** `LLM_API_KEY` is unset or empty
- **THEN** the upstream request SHALL carry `Content-Type: application/json` and the three attribution headers, and SHALL NOT carry any `Authorization` header

#### Scenario: Bearer undefined no longer sent

- **GIVEN** the previous behaviour of unconditionally interpolating the env var into `Bearer ${Deno.env.get("LLM_API_KEY")}`
- **WHEN** `LLM_API_KEY` is unset
- **THEN** the upstream request SHALL NOT contain the literal header value `Bearer undefined`
