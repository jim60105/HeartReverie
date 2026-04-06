# Unified Server

## Purpose

Root serve script that generates TLS certificates and starts the unified writer backend serving both the frontend and API.

## Requirements

### Requirement: Certificate generation

The root `serve.zsh` script SHALL generate self-signed TLS certificates for HTTPS if they do not already exist. The certificate generation logic SHALL be reused from the existing `reader/serve.zsh` script. Generated certificates SHALL be stored in a consistent location accessible to the writer backend.

#### Scenario: First-time certificate generation
- **WHEN** `serve.zsh` is run and no certificates exist
- **THEN** self-signed TLS certificates SHALL be generated and stored for the server to use

#### Scenario: Certificates already exist
- **WHEN** `serve.zsh` is run and valid certificates already exist
- **THEN** certificate generation SHALL be skipped and the existing certificates SHALL be used

### Requirement: Process management

The `serve.zsh` script SHALL start the writer backend as a single process that serves both the reader frontend (static files) and the API endpoints. No separate frontend server process SHALL be required.

#### Scenario: Start the unified server
- **WHEN** `serve.zsh` is executed
- **THEN** the writer backend process SHALL start and serve both the static frontend at `/` and the API at `/api/`

#### Scenario: Server shutdown
- **WHEN** the `serve.zsh` process is terminated (e.g., Ctrl+C)
- **THEN** the writer backend process SHALL be cleanly stopped

### Requirement: Configuration

The server SHALL be configurable via environment variables. The `PORT` variable SHALL set the listening port. The `OPENROUTER_API_KEY` variable SHALL provide the API key for OpenRouter authentication. The `OPENROUTER_MODEL` variable SHALL set the LLM model, defaulting to `deepseek/deepseek-v3.2` if not specified.

#### Scenario: Custom port configuration
- **WHEN** the `PORT` environment variable is set
- **THEN** the server SHALL listen on the specified port

#### Scenario: Default model configuration
- **WHEN** `OPENROUTER_MODEL` is not set
- **THEN** the server SHALL use `deepseek/deepseek-v3.2` as the default model

#### Scenario: Missing API key warning
- **WHEN** `OPENROUTER_API_KEY` is not set and the server starts
- **THEN** the server SHALL log a warning that chat functionality will not work without the API key
