# Per-Story LLM Config (Delta)

## MODIFIED Requirements

### Requirement: Overridable LLM parameters whitelist

The per-story `_config.json` SHALL accept only the following keys: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`. `model` SHALL be a non-empty string; `reasoningEnabled` SHALL be a boolean; `reasoningEffort` SHALL be one of the literal strings `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` (case-sensitive); every other listed key SHALL be a finite number. Any other key SHALL be stripped on write and ignored on read. Values of incorrect type SHALL cause the write to be rejected and the read to raise a validation error.

#### Scenario: Write rejects wrong-type value

- **WHEN** a client PUTs `{ "temperature": "hot" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying the offending field

#### Scenario: Write strips non-whitelisted keys

- **WHEN** a client PUTs `{ "temperature": 0.7, "tools": [] }` to the per-story config endpoint
- **THEN** the persisted file SHALL contain only `{ "temperature": 0.7 }`

#### Scenario: Model must be a non-empty string

- **WHEN** a client PUTs `{ "model": "" }`
- **THEN** the server SHALL respond with HTTP 400 and SHALL NOT modify the persisted file

#### Scenario: Write accepts reasoningEnabled boolean

- **WHEN** an authenticated client PUTs `{ "reasoningEnabled": false }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "reasoningEnabled": false }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write rejects non-boolean reasoningEnabled

- **WHEN** an authenticated client PUTs `{ "reasoningEnabled": "yes" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `reasoningEnabled` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write accepts a valid reasoningEffort

- **WHEN** an authenticated client PUTs `{ "reasoningEffort": "low" }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "reasoningEffort": "low" }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write rejects unknown reasoningEffort

- **WHEN** an authenticated client PUTs `{ "reasoningEffort": "extreme" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `reasoningEffort` as the offending field, and SHALL NOT modify the persisted file

### Requirement: Frontend LLM settings panel per story

The Vue frontend SHALL provide a new lazy-loaded `LlmSettingsPage.vue` mounted at the `/settings/llm` route under the existing `SettingsLayout.vue`. The page SHALL let the user pick an existing story (reusing the existing story selector) and edit that story's LLM overrides. Each overridable field SHALL render a "use default" toggle; when toggled on, the field is absent from the PUT payload and the env default applies. Saving SHALL call `PUT /api/:series/:name/config` through the existing `useStoryLlmConfig` composable. The page SHALL surface API errors through the existing toast notification mechanism. UI text SHALL be in Traditional Chinese (zh-TW) consistent with the rest of the frontend.

The page SHALL render dedicated controls for `reasoningEnabled` (a single checkbox value control) and `reasoningEffort` (a `<select>` whose options are derived from a single shared `REASONING_EFFORTS` runtime tuple — `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` — and SHALL NOT redeclare the literal array). When the user has explicitly overridden `reasoningEnabled` to `false` in the form (its "use default" toggle is OFF and the checkbox is unchecked), the `reasoningEffort` value control SHALL receive a "muted" CSS class (reduced opacity, secondary border) but SHALL remain interactive. The user MAY still toggle its "use default" toggle and edit its value; the value SHALL still be persisted on save, so that toggling `reasoningEnabled` back on at any later time restores the configured effort. The page SHALL NOT introspect server-side env defaults to compute the muted state in this iteration; the muted state is driven only by the explicit override state visible in the form.

#### Scenario: Navigating to the settings panel loads current overrides

- **WHEN** the user navigates to `/settings/llm` and selects a story whose `_config.json` contains `{ "temperature": 0.7 }`
- **THEN** the temperature field SHALL display `0.7` with its "use default" toggle in the OFF position, and every other field SHALL show its "use default" toggle in the ON position

#### Scenario: Saving only specified fields

- **GIVEN** the user has toggled "use default" OFF for temperature only and set it to `0.3`
- **WHEN** the user clicks Save
- **THEN** the frontend SHALL send `PUT /api/:series/:name/config` with body `{ "temperature": 0.3 }` and SHALL NOT include any other LLM field

#### Scenario: Toggling "use default" removes the field on next save

- **GIVEN** a story's config currently has `{ "temperature": 0.9 }` loaded into the form
- **WHEN** the user toggles the temperature "use default" toggle ON and clicks Save
- **THEN** the frontend SHALL send `PUT /api/:series/:name/config` with body `{}`

#### Scenario: Reasoning fields render dedicated controls

- **WHEN** the user navigates to `/settings/llm` and selects any story
- **THEN** the form SHALL render a `reasoningEnabled` row whose value control is a single checkbox, and a `reasoningEffort` row whose value control is a `<select>` containing exactly the options `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` derived from the shared `REASONING_EFFORTS` constant

#### Scenario: Saving reasoning overrides

- **GIVEN** the user has toggled "use default" OFF for both `reasoningEnabled` (set to `false`) and `reasoningEffort` (set to `"low"`)
- **WHEN** the user clicks Save
- **THEN** the frontend SHALL send `PUT /api/:series/:name/config` with body `{ "reasoningEnabled": false, "reasoningEffort": "low" }`

#### Scenario: ReasoningEffort control muted when reasoning is explicitly off

- **GIVEN** the user has toggled `reasoningEnabled`'s "use default" OFF and unchecked the checkbox
- **WHEN** the form is rendered
- **THEN** the `reasoningEffort` value control SHALL receive a "muted" CSS class (reduced opacity), but SHALL remain interactive (NOT have the HTML `disabled` attribute) so the user can still adjust it

#### Scenario: ReasoningEffort control unmuted when reasoning is on or default

- **GIVEN** `reasoningEnabled`'s "use default" toggle is ON, OR it is OFF but the checkbox is checked
- **WHEN** the form is rendered
- **THEN** the `reasoningEffort` value control SHALL render in its normal (un-muted) state
