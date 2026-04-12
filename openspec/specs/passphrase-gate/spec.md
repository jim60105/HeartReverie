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

The frontend SHALL display a `PassphraseGate.vue` component that wraps the main application content and blocks all interaction until a valid passphrase is provided. The component SHALL use Vue's conditional rendering (`v-if`) to show the passphrase overlay or the main app content based on authentication state from the `useAuth()` composable. The overlay SHALL contain a text input for the passphrase and a submit button wrapped in a `<form>` element. When the user submits, the frontend SHALL send `GET /api/auth/verify` with the entered passphrase in the `X-Passphrase` header. On success (HTTP 200), the overlay SHALL be hidden via reactive state and the main UI SHALL be revealed and initialized. On failure (HTTP 401), the overlay SHALL display an error message and remain visible. sessionStorage persistence SHALL be preserved.

#### Scenario: Page load with passphrase required
- **WHEN** the page loads and `GET /api/auth/verify` (without a passphrase header) returns HTTP 401
- **THEN** the `PassphraseGate.vue` component SHALL render the passphrase overlay via `v-if` and the main application slot content SHALL NOT be rendered

#### Scenario: Page load without passphrase required
- **WHEN** the page loads and `GET /api/auth/verify` (without a passphrase header) returns HTTP 200
- **THEN** the `PassphraseGate.vue` component SHALL NOT render the overlay and the main application content SHALL be rendered immediately

#### Scenario: Successful passphrase entry
- **WHEN** the user enters a correct passphrase and submits
- **THEN** the `useAuth()` composable SHALL update its reactive `isAuthenticated` computed to `true`, the overlay SHALL be hidden via `v-if`, the passphrase SHALL be stored in `sessionStorage`, and the main application content SHALL render

#### Scenario: Failed passphrase entry
- **WHEN** the user enters an incorrect passphrase and submits
- **THEN** the overlay SHALL display an error message such as "密碼錯誤" and remain visible for retry

#### Scenario: Enter key submits passphrase
- **WHEN** the user presses Enter while the passphrase input is focused
- **THEN** the form's `@submit.prevent` handler SHALL trigger passphrase verification (same behavior as clicking the submit button)

### Requirement: Passphrase input form

The passphrase `<input>` and submit button SHALL be contained within a `<form>` element inside the `PassphraseGate.vue` component template. The form SHALL use Vue's `@submit.prevent` directive to prevent page navigation and trigger the verification logic. The existing submit behavior SHALL be preserved.

#### Scenario: Password field in form
- **WHEN** the `PassphraseGate.vue` component renders the overlay
- **THEN** the password input SHALL be contained within a `<form>` element with `@submit.prevent`, eliminating the browser DOM warning

#### Scenario: Form submission
- **WHEN** the user presses Enter in the password field or clicks the submit button
- **THEN** the form's `@submit.prevent` handler SHALL fire and the passphrase verification logic SHALL execute via the `useAuth()` composable

### Requirement: Passphrase header injection

All frontend modules that make API requests SHALL include the stored passphrase in the `X-Passphrase` request header. The passphrase SHALL be retrieved from a `getAuthHeaders()` function exported by the `useAuth()` composable. The `getAuthHeaders()` function SHALL return reactive headers derived from the composable's `passphrase` ref. If no passphrase is stored, the function SHALL return an empty object so that requests proceed without the header (for the case where `PASSPHRASE` is not configured on the server).

#### Scenario: Fetch with stored passphrase
- **WHEN** a frontend component or composable makes a fetch request and a passphrase is stored in the `useAuth()` composable's reactive `passphrase` ref
- **THEN** the request SHALL include the `X-Passphrase` header with the stored passphrase value obtained from `getAuthHeaders()`

#### Scenario: Fetch without stored passphrase
- **WHEN** a frontend component or composable makes a fetch request and no passphrase is stored
- **THEN** `getAuthHeaders()` SHALL return an empty object and the request SHALL NOT include the `X-Passphrase` header

### Requirement: Passphrase not logged

The server SHALL NOT log the passphrase value in any console output, error messages, or debug logs. The passphrase environment variable SHALL be read but never echoed or included in error detail strings returned to clients.

#### Scenario: Server startup
- **WHEN** the server starts with `PASSPHRASE` configured
- **THEN** the server SHALL NOT log the passphrase value to the console

#### Scenario: Authentication failure response
- **WHEN** a request fails passphrase verification
- **THEN** the error response detail SHALL NOT include the expected or provided passphrase value

### Requirement: useAuth composable

The `useAuth()` composable SHALL manage authentication state using Vue's Composition API. It SHALL expose: a reactive `passphrase` ref (string) synchronized with `sessionStorage`, an `isAuthenticated` computed property that is `true` when the passphrase has been verified, a `getAuthHeaders()` function returning `{ 'X-Passphrase': passphrase }` when a passphrase is set or an empty object otherwise, and a `verify(passphrase: string): Promise<boolean>` method that calls `GET /api/auth/verify` and updates internal state. The composable SHALL use a shared singleton pattern so all components access the same reactive auth state.

#### Scenario: Composable provides reactive passphrase
- **WHEN** `useAuth()` is called from multiple components
- **THEN** all components SHALL share the same reactive `passphrase` ref and `isAuthenticated` computed, ensuring consistent auth state across the application

#### Scenario: sessionStorage restoration on page load
- **WHEN** the page loads and `sessionStorage` contains a previously stored passphrase
- **THEN** the `useAuth()` composable SHALL initialize its `passphrase` ref from `sessionStorage` and attempt verification automatically

#### Scenario: getAuthHeaders returns reactive headers
- **WHEN** the `passphrase` ref changes from empty to a valid value
- **THEN** subsequent calls to `getAuthHeaders()` SHALL return `{ 'X-Passphrase': '<the passphrase>' }`
