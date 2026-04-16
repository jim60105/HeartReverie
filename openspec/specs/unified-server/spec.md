# Unified Server

## Purpose

Root serve script that generates TLS certificates and starts the unified writer backend serving both the frontend and API.

## Requirements

### Requirement: Certificate generation

The root `serve.sh` script SHALL generate self-signed TLS certificates for HTTPS if they do not already exist. The certificate generation logic SHALL be reused from the existing `reader/serve.sh` script. Generated certificates SHALL be stored in a consistent location accessible to the writer backend.

#### Scenario: First-time certificate generation
- **WHEN** `serve.sh` is run and no certificates exist
- **THEN** self-signed TLS certificates SHALL be generated and stored for the server to use

#### Scenario: Certificates already exist
- **WHEN** `serve.sh` is run and valid certificates already exist
- **THEN** certificate generation SHALL be skipped and the existing certificates SHALL be used

### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with ESM modules. The server SHALL serve the `reader/` directory (or `reader-dist/` for built output) as static files at the root path `/` via Hono's `serveStatic()` middleware. The server SHALL listen on HTTPS using Deno's native TLS support (`Deno.serve()` with `cert` and `key` options). The server SHALL read the port from the `PORT` environment variable via `Deno.env.get()` or default to 8443. The server SHALL include an SPA fallback route that serves `index.html` for any GET request not matched by API routes, plugin routes, asset routes, the legacy `/js/` route, or existing static files. This enables Vue Router's HTML5 history mode to work correctly on page refresh and direct URL access.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started with valid TLS certificates via `deno run`
- **THEN** the server SHALL listen on HTTPS via Deno's native TLS and serve files from the reader directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers alongside the static file serving

#### Scenario: Dotfiles are denied
- **WHEN** a client requests a path that resolves to a dotfile (e.g., `/.env`, `/.gitignore`)
- **THEN** the server SHALL return HTTP 403 and SHALL NOT serve the file contents

#### Scenario: SPA fallback serves index.html for frontend routes
- **WHEN** a client sends a GET request to a path like `/my-series/my-story/chapter/3` that does not match any API route, plugin route, asset file, or static file
- **THEN** the server SHALL respond with the contents of `index.html` and `Content-Type: text/html` so Vue Router can handle the route client-side

#### Scenario: SPA fallback does not affect API routes
- **WHEN** a client sends a GET request to `/api/stories`
- **THEN** the request SHALL be handled by the API route handler, NOT the SPA fallback

#### Scenario: SPA fallback does not affect plugin routes
- **WHEN** a client sends a GET request to `/plugins/status/frontend.js`
- **THEN** the request SHALL be handled by the plugin route handler, NOT the SPA fallback

#### Scenario: SPA fallback does not affect existing static files
- **WHEN** a client sends a GET request to `/favicon.ico` and the file exists in the reader directory
- **THEN** the `serveStatic` middleware SHALL serve the file directly, NOT the SPA fallback

### Requirement: Process management

The `serve.sh` script SHALL start the writer backend via `deno run` with explicit permission flags (`--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`). The script SHALL check for the `deno` command instead of `node`. No `node_modules` directory or `package.json` SHALL be required.

#### Scenario: Start the unified server
- **WHEN** `serve.sh` is executed
- **THEN** the script SHALL invoke `deno run` with appropriate permission flags, and the server SHALL serve both the static frontend at `/` and the API at `/api/`

#### Scenario: Server shutdown
- **WHEN** the `serve.sh` process is terminated (e.g., Ctrl+C)
- **THEN** the Deno process SHALL be cleanly stopped

### Requirement: Configuration

The server SHALL be configurable via environment variables. The `PORT` variable SHALL set the listening port. The `LLM_API_KEY` variable SHALL provide the API key for LLM authentication. The `LLM_MODEL` variable SHALL set the LLM model, defaulting to `deepseek/deepseek-v3.2` if not specified. The `LLM_API_URL` variable SHALL set the chat completions endpoint URL, defaulting to `https://openrouter.ai/api/v1/chat/completions` if not specified. The `PASSPHRASE` variable SHALL set an optional shared passphrase for access control; when set, all API requests require this passphrase in the `X-Passphrase` header. The `LLM_TEMPERATURE`, `LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY`, `LLM_TOP_K`, `LLM_TOP_P`, `LLM_REPETITION_PENALTY`, `LLM_MIN_P`, and `LLM_TOP_A` variables SHALL override the corresponding default generation parameters.

#### Scenario: Custom port configuration
- **WHEN** the `PORT` environment variable is set
- **THEN** the server SHALL listen on the specified port

#### Scenario: Default model configuration
- **WHEN** `LLM_MODEL` is not set
- **THEN** the server SHALL use `deepseek/deepseek-v3.2` as the default model

#### Scenario: Missing API key warning
- **WHEN** `LLM_API_KEY` is not set and the server starts
- **THEN** the server SHALL log a warning that chat functionality will not work without the API key

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
