## MODIFIED Requirements

### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with ESM modules. The server SHALL serve the `reader/` directory as static files at the root path `/` via Hono's `serveStatic()` middleware. The server SHALL listen on HTTPS using Deno's native TLS support (`Deno.serve()` with `cert` and `key` options). The server SHALL read the port from the `PORT` environment variable via `Deno.env.get()` or default to 8443.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started with valid TLS certificates via `deno run`
- **THEN** the server SHALL listen on HTTPS via Deno's native TLS and serve files from the `reader/` directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers alongside the static file serving

#### Scenario: Dotfiles are denied
- **WHEN** a client requests a path that resolves to a dotfile (e.g., `/.env`, `/.gitignore`)
- **THEN** the server SHALL return HTTP 403 and SHALL NOT serve the file contents

### Requirement: Process management

The `serve.zsh` script SHALL start the writer backend via `deno run` with explicit permission flags (`--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`). The script SHALL check for the `deno` command instead of `node`. No `node_modules` directory or `package.json` SHALL be required.

#### Scenario: Start the unified server
- **WHEN** `serve.zsh` is executed
- **THEN** the script SHALL invoke `deno run` with appropriate permission flags, and the server SHALL serve both the static frontend at `/` and the API at `/api/`

#### Scenario: Server shutdown
- **WHEN** the `serve.zsh` process is terminated (e.g., Ctrl+C)
- **THEN** the Deno process SHALL be cleanly stopped
