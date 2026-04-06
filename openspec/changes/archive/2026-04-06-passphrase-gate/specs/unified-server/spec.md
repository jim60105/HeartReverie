## MODIFIED Requirements

### Requirement: Configuration

The server SHALL be configurable via environment variables. The `PORT` variable SHALL set the listening port. The `OPENROUTER_API_KEY` variable SHALL provide the API key for OpenRouter authentication. The `OPENROUTER_MODEL` variable SHALL set the LLM model, defaulting to `deepseek/deepseek-v3.2` if not specified. The `PASSPHRASE` variable SHALL set an optional shared passphrase for access control; when set, all API requests require this passphrase in the `X-Passphrase` header.

#### Scenario: Custom port configuration
- **WHEN** the `PORT` environment variable is set
- **THEN** the server SHALL listen on the specified port

#### Scenario: Default model configuration
- **WHEN** `OPENROUTER_MODEL` is not set
- **THEN** the server SHALL use `deepseek/deepseek-v3.2` as the default model

#### Scenario: Missing API key warning
- **WHEN** `OPENROUTER_API_KEY` is not set and the server starts
- **THEN** the server SHALL log a warning that chat functionality will not work without the API key

#### Scenario: PASSPHRASE configured
- **WHEN** `PASSPHRASE` is set in the environment or `.env` file
- **THEN** the server SHALL require all `/api/` requests to include a matching `X-Passphrase` header

#### Scenario: PASSPHRASE not configured
- **WHEN** `PASSPHRASE` is not set
- **THEN** the server SHALL allow all requests without passphrase verification (open access)
