## MODIFIED Requirements

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
