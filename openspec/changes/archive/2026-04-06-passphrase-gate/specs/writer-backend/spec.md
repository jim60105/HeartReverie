## ADDED Requirements

### Requirement: Passphrase verification middleware

The writer backend SHALL mount a `verifyPassphrase` middleware on all `/api/` routes that checks the `X-Passphrase` header against `process.env.PASSPHRASE` using `crypto.timingSafeEqual`. If `PASSPHRASE` is not set, the middleware SHALL skip verification. If set but missing or incorrect, the middleware SHALL return HTTP 401.

#### Scenario: Middleware mounted before all API routes
- **WHEN** the server starts
- **THEN** the `verifyPassphrase` middleware SHALL be mounted via `app.use('/api', verifyPassphrase)` before any API route handlers

### Requirement: Auth verify endpoint

The writer backend SHALL expose `GET /api/auth/verify` that returns `{ "ok": true }` with HTTP 200 when the passphrase is valid or not configured. The endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

#### Scenario: Verify endpoint success
- **WHEN** a client sends `GET /api/auth/verify` with a valid passphrase (or no passphrase required)
- **THEN** the server SHALL return HTTP 200 with `{ "ok": true }`
