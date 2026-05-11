## ADDED Requirements

### Requirement: x-actions schema extension recognized by PluginSettingsPage

The core `PluginSettingsPage.vue` SHALL recognize an `x-actions` array at the root level of a plugin's `settingsSchema` and render corresponding action buttons.

#### Scenario: Actions rendered as buttons

- **WHEN** a plugin's settingsSchema contains an `x-actions` array with entries
- **THEN** each entry is rendered as a clickable button with the entry's `label` text

#### Scenario: No x-actions defined

- **WHEN** a plugin's settingsSchema does not contain `x-actions`
- **THEN** no action buttons section is displayed

### Requirement: Action button sends form data to backend

When an action button is clicked, the core SHALL send a request to the action's `url` with the HTTP method specified (default: `POST`), including only the form fields listed in `bodyFields` sourced from the current (unsaved) form values.

#### Scenario: POST with bodyFields

- **GIVEN** an action with `url: "/api/plugins/foo/test"`, `method: "POST"`, `bodyFields: ["host", "token"]`
- **WHEN** user clicks the action button with form values `{ host: "http://x", token: "abc" }`
- **THEN** a POST request is sent to `/api/plugins/foo/test` with body `{ "host": "http://x", "token": "abc" }`

#### Scenario: Default method is POST

- **WHEN** an action does not specify `method`
- **THEN** the request uses POST

#### Scenario: No bodyFields

- **WHEN** an action does not specify `bodyFields`
- **THEN** the request body is empty `{}`

### Requirement: Action response contract

Action endpoints SHOULD return JSON matching:

```ts
{ ok: boolean; error?: string; message?: string }
```

The core UI interprets:
- `ok: true` → success display
- `ok: false` → error display using `error` field text

#### Scenario: Successful response

- **WHEN** backend returns `{ ok: true }` with HTTP 2xx
- **THEN** a green success indicator is shown

#### Scenario: Error response with message

- **WHEN** backend returns `{ ok: false, error: "some error" }` with any HTTP status
- **THEN** a red error indicator is shown with "✗ some error"

#### Scenario: Network failure

- **WHEN** the fetch request fails (network error, timeout)
- **THEN** a red error indicator shows a generic "網路錯誤，無法執行操作"

#### Scenario: Non-JSON response

- **WHEN** backend returns a non-JSON response
- **THEN** behavior is same as network failure (generic error shown)

### Requirement: reloadOptionsOnSuccess triggers dynamic option refresh

When `reloadOptionsOnSuccess` is `true` on an action and the action succeeds, the core SHALL re-invoke `loadDynamicOptionsForSchema()` to refresh all `x-options-url` dropdowns.

**Note:** Dynamic options reload uses saved (persisted) settings, not draft form values. This means a successful draft-aware action test does not populate dropdowns from the tested endpoint until settings are saved.

#### Scenario: Successful action with reload

- **WHEN** action succeeds and `reloadOptionsOnSuccess` is `true`
- **THEN** all `x-options-url` fields are re-fetched using saved settings

#### Scenario: Failed action does not reload

- **WHEN** action fails
- **THEN** dynamic options are NOT reloaded regardless of `reloadOptionsOnSuccess`

### Requirement: Loading state during action execution

While an action request is in-flight, the corresponding button SHALL be disabled and display loading text.

**Known limitation:** The current loading text is hardcoded to "測試中…" (connection-test-oriented). Future improvement should support a `loadingLabel` field in the action schema for truly generic usage.

#### Scenario: Button disabled during request

- **WHEN** an action request is in-flight
- **THEN** the button is disabled and shows "測試中…"

### Requirement: Success display text

**Known limitation:** The current success text is hardcoded to "✓ 連線成功". Future improvement should support `message` from backend response or a `successLabel` in the action schema for generic usage.

#### Scenario: Success message

- **WHEN** action response is `{ ok: true }`
- **THEN** display shows "✓ 連線成功"
