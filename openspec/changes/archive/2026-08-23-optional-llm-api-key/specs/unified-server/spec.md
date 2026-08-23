## MODIFIED Requirements

### Requirement: Configuration

The server SHALL be configurable via environment variables. The `PORT` variable SHALL set the listening port (default `8080`). The `LLM_API_KEY` variable SHALL be optional: when set to a non-empty value it provides the API key used in the upstream `Authorization` header for LLM authentication; when unset or empty, upstream requests are sent without that header so keyless local or private LLM providers (e.g. Ollama, vLLM, LM Studio) work. The `LLM_MODEL` variable SHALL set the LLM model, defaulting to `deepseek/deepseek-v4-pro` if not specified. The `LLM_API_URL` variable SHALL set the chat completions endpoint URL, defaulting to `https://openrouter.ai/api/v1/chat/completions` if not specified. The `PASSPHRASE` variable SHALL set an optional shared passphrase for access control; when set, all API requests require this passphrase in the `X-Passphrase` header. The `LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, and `LLM_TOP_A` variables SHALL override the corresponding default generation parameters.

#### Scenario: Custom port configuration
- **WHEN** the `PORT` environment variable is set
- **THEN** the server SHALL listen on the specified port

#### Scenario: Default port

- **WHEN** the `PORT` environment variable is not set
- **THEN** the server SHALL listen on port `8080`

#### Scenario: Default model configuration
- **WHEN** `LLM_MODEL` is not set
- **THEN** the server SHALL use `deepseek/deepseek-v4-pro` as the default model

#### Scenario: Missing API key warning
- **WHEN** `LLM_API_KEY` is not set and the server starts
- **THEN** the server SHALL log a warning that the `Authorization` header is omitted for upstream requests, and that `LLM_API_URL` must point to a keyless provider endpoint (e.g. Ollama, vLLM, LM Studio); cloud providers (e.g. OpenRouter) reject unauthenticated requests with 401/403, which pass through to the client

#### Scenario: PASSPHRASE configured
- **WHEN** `PASSPHRASE` is set in the environment or `.env` file
- **THEN** the server SHALL require all `/api/` requests to include a matching `X-Passphrase` header

#### Scenario: PASSPHRASE not configured
- **WHEN** `PASSPHRASE` is not set
- **THEN** the server SHALL allow all requests without passphrase verification (open access)

#### Scenario: Default LLM API URL
- **WHEN** `LLM_API_URL` is not set
- **THEN** the server SHALL send requests to `https://openrouter.ai/api/v1/chat/completions`

#### Scenario: Custom LLM API URL
- **WHEN** `LLM_API_URL` is set to a custom endpoint
- **THEN** the server SHALL send LLM requests to that URL

#### Scenario: LLM sampling parameter defaults
- **WHEN** no `LLM_*` sampling parameter env vars are set
- **THEN** the server SHALL use the built-in defaults: temperature=0.1, frequency_penalty=0.13, presence_penalty=0.52, top_k=10, top_p=0, repetition_penalty=1.2, min_p=0, top_a=1

#### Scenario: HTTP_ONLY / CERT_FILE / KEY_FILE are no longer recognised

- **WHEN** an operator sets `HTTP_ONLY`, `CERT_FILE`, or `KEY_FILE` in the environment
- **THEN** the server SHALL ignore those variables (they are not read anywhere) and SHALL listen on plain HTTP regardless
