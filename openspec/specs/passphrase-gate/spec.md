# Passphrase Gate

## Purpose

Optional passphrase-based access control module that protects the application behind a shared secret, with server-side middleware enforcement and a frontend unlock overlay.

## Requirements

### Requirement: Passphrase verification middleware

The server SHALL implement a `verifyPassphrase` Express middleware that runs before all `/api/` route handlers. The middleware SHALL read the expected passphrase from `process.env.PASSPHRASE`. If `PASSPHRASE` is not set or is empty, the middleware SHALL skip verification and allow all requests. If `PASSPHRASE` is set, the middleware SHALL extract the passphrase from the `X-Passphrase` request header and compare it using `crypto.timingSafeEqual`. If the header is missing or the value does not match, the middleware SHALL return HTTP 401 with a JSON error body and SHALL NOT pass control to downstream handlers.

#### Scenario: PASSPHRASE not configured
- **WHEN** `process.env.PASSPHRASE` is not set or is empty
- **THEN** the middleware SHALL call `next()` and allow the request to proceed without any passphrase check

#### Scenario: Valid passphrase provided
- **WHEN** `PASSPHRASE` is set and the request includes an `X-Passphrase` header with a value matching the configured passphrase
- **THEN** the middleware SHALL call `next()` and allow the request to proceed

#### Scenario: Missing passphrase header
- **WHEN** `PASSPHRASE` is set and the request does not include an `X-Passphrase` header
- **THEN** the middleware SHALL return HTTP 401 with `{ "type": "about:blank", "title": "Unauthorized", "status": 401, "detail": "Passphrase required" }`

#### Scenario: Incorrect passphrase
- **WHEN** `PASSPHRASE` is set and the `X-Passphrase` header value does not match the configured passphrase
- **THEN** the middleware SHALL return HTTP 401 with `{ "type": "about:blank", "title": "Unauthorized", "status": 401, "detail": "Invalid passphrase" }`

#### Scenario: Timing-safe comparison
- **WHEN** the middleware compares the provided passphrase against the configured value
- **THEN** the comparison SHALL use `crypto.timingSafeEqual` with both values converted to Buffers of equal length to prevent timing side-channel attacks

### Requirement: Passphrase verify endpoint

The server SHALL expose `GET /api/auth/verify` as a lightweight endpoint for the frontend to test whether a passphrase is valid. This endpoint SHALL be subject to the same `verifyPassphrase` middleware as all other `/api/` routes. If the passphrase check passes (or is skipped because `PASSPHRASE` is not configured), the endpoint SHALL return HTTP 200 with `{ "ok": true }`.

#### Scenario: Verify with valid passphrase
- **WHEN** a client sends `GET /api/auth/verify` with a valid `X-Passphrase` header
- **THEN** the server SHALL return HTTP 200 with `{ "ok": true }`

#### Scenario: Verify without passphrase when not configured
- **WHEN** `PASSPHRASE` is not configured and a client sends `GET /api/auth/verify`
- **THEN** the server SHALL return HTTP 200 with `{ "ok": true }`

#### Scenario: Verify with invalid passphrase
- **WHEN** `PASSPHRASE` is configured and a client sends `GET /api/auth/verify` with an incorrect `X-Passphrase` header
- **THEN** the server SHALL return HTTP 401 (handled by the middleware before reaching the endpoint)

### Requirement: Frontend passphrase overlay

The frontend SHALL display a fullscreen passphrase overlay that blocks all interaction with the application until a valid passphrase is provided. The overlay SHALL contain a text input for the passphrase and a submit button. When the user submits, the frontend SHALL send `GET /api/auth/verify` with the entered passphrase in the `X-Passphrase` header. On success (HTTP 200), the overlay SHALL be hidden and the main UI SHALL be revealed and initialized. On failure (HTTP 401), the overlay SHALL display an error message and remain visible.

#### Scenario: Page load with passphrase required
- **WHEN** the page loads and `GET /api/auth/verify` (without a passphrase header) returns HTTP 401
- **THEN** the passphrase overlay SHALL be displayed and all other UI elements SHALL be hidden or non-interactive

#### Scenario: Page load without passphrase required
- **WHEN** the page loads and `GET /api/auth/verify` (without a passphrase header) returns HTTP 200
- **THEN** the passphrase overlay SHALL NOT be displayed and the main UI SHALL initialize normally

#### Scenario: Successful passphrase entry
- **WHEN** the user enters a correct passphrase and submits
- **THEN** the overlay SHALL be hidden, the passphrase SHALL be stored in `sessionStorage`, and the main application SHALL initialize

#### Scenario: Failed passphrase entry
- **WHEN** the user enters an incorrect passphrase and submits
- **THEN** the overlay SHALL display an error message such as "密碼錯誤" and remain visible for retry

#### Scenario: Enter key submits passphrase
- **WHEN** the user presses Enter while the passphrase input is focused
- **THEN** the passphrase SHALL be submitted (same behavior as clicking the submit button)

### Requirement: Passphrase input form

The passphrase `<input>` and submit button SHALL be wrapped in a `<form>` element. The form SHALL use `event.preventDefault()` on submit to prevent page navigation. The existing submit logic SHALL be triggered by the form's `submit` event.

#### Scenario: Password field in form
- **WHEN** the passphrase overlay is rendered
- **THEN** the password input SHALL be contained within a `<form>` element, eliminating the browser DOM warning

#### Scenario: Form submission
- **WHEN** the user presses Enter in the password field or clicks the submit button
- **THEN** the form's submit event SHALL fire, `preventDefault()` SHALL be called, and the passphrase verification logic SHALL execute

### Requirement: Passphrase header injection

All frontend modules that make API requests SHALL include the stored passphrase in the `X-Passphrase` request header. The passphrase SHALL be retrieved from a shared `getAuthHeaders()` function exported by the `passphrase-gate.js` module. If no passphrase is stored, the function SHALL return an empty object so that requests proceed without the header (for the case where `PASSPHRASE` is not configured on the server).

#### Scenario: Fetch with stored passphrase
- **WHEN** a frontend module makes a fetch request and a passphrase is stored in sessionStorage
- **THEN** the request SHALL include the `X-Passphrase` header with the stored passphrase value

#### Scenario: Fetch without stored passphrase
- **WHEN** a frontend module makes a fetch request and no passphrase is stored
- **THEN** the request SHALL NOT include the `X-Passphrase` header

### Requirement: Passphrase not logged

The server SHALL NOT log the passphrase value in any console output, error messages, or debug logs. The passphrase environment variable SHALL be read but never echoed or included in error detail strings returned to clients.

#### Scenario: Server startup
- **WHEN** the server starts with `PASSPHRASE` configured
- **THEN** the server SHALL NOT log the passphrase value to the console

#### Scenario: Authentication failure response
- **WHEN** a request fails passphrase verification
- **THEN** the error response detail SHALL NOT include the expected or provided passphrase value
