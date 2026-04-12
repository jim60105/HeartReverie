# Passphrase Gate — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

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

## ADDED Requirements

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
