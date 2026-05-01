## MODIFIED Requirements

### Requirement: Overridable LLM parameters whitelist

The per-story `_config.json` SHALL accept only the following keys: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens`. `model` SHALL be a non-empty string; `reasoningEnabled` SHALL be a boolean; `reasoningEffort` SHALL be one of the literal strings `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` (case-sensitive); `maxCompletionTokens` SHALL be a positive finite integer (`Number.isInteger(value) && value > 0`); every other listed key SHALL be a finite number. Any other key SHALL be stripped on write and ignored on read. Values of incorrect type SHALL cause the write to be rejected and the read to raise a validation error.

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

#### Scenario: Write accepts a valid maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 8192 }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "maxCompletionTokens": 8192 }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write rejects non-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 1024.5 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-positive maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 0 }` or `{ "maxCompletionTokens": -1 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects unsafe-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 9007199254740993 }` (a JSON number above `Number.MAX_SAFE_INTEGER`) to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-number maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": "4096" }` (string) or `{ "maxCompletionTokens": true }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

### Requirement: Merge semantics at chat time

The backend SHALL compute the effective LLM configuration for each chat request as `Object.assign({}, llmDefaults, storyOverrides)`, where `llmDefaults` is the env-derived `LlmConfig` object (including the `maxCompletionTokens` field) and `storyOverrides` is the validated partial object read from `_config.json`. Merging SHALL happen per chat request so that changes to `_config.json` take effect on the next request without a server restart. Fields present in `storyOverrides` with non-`undefined`, non-`null` values SHALL replace the default; all other fields SHALL keep the env default.

#### Scenario: Merge resolves at each request
- **GIVEN** env default `temperature=0.1` and a story with `_config.json` containing `{ "temperature": 0.7 }`
- **WHEN** two chat requests arrive, and between them the file is updated to `{ "temperature": 0.3 }`
- **THEN** the first request SHALL use `temperature=0.7` and the second request SHALL use `temperature=0.3` without restarting the server

#### Scenario: Null and missing fields both fall through to default
- **GIVEN** env default `topK=10` and a story with `_config.json` containing `{ "topK": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL use `top_k=10`

#### Scenario: maxCompletionTokens override resolves at each request
- **GIVEN** env default `maxCompletionTokens=4096` and a story with `_config.json` containing `{ "maxCompletionTokens": 8192 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 8192`

#### Scenario: Null maxCompletionTokens falls through to env default
- **GIVEN** env default `maxCompletionTokens=4096` and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 4096`

### Requirement: Frontend LLM settings panel per story

The Vue frontend SHALL provide a new lazy-loaded `LlmSettingsPage.vue` mounted at the `/settings/llm` route under the existing `SettingsLayout.vue`. The page SHALL let the user pick an existing story (reusing the existing story selector) and edit that story's LLM overrides. Each overridable field SHALL render a "use default" toggle; when toggled on, the field is absent from the PUT payload and the env default applies. Saving SHALL call `PUT /api/:series/:name/config` through the existing `useStoryLlmConfig` composable. The page SHALL surface API errors through the existing toast notification mechanism. UI text SHALL be in Traditional Chinese (zh-TW) consistent with the rest of the frontend.

The page SHALL render dedicated controls for `reasoningEnabled` (a single checkbox value control), `reasoningEffort` (a `<select>` whose options are derived from a single shared `REASONING_EFFORTS` runtime tuple — `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` — and SHALL NOT redeclare the literal array), and `maxCompletionTokens` (an `<input type="number" min="1" step="1">` value control). When the `maxCompletionTokens` row's "use default" toggle is OFF, the form SHALL surface an inline validation hint and disable the page's Save action whenever the trimmed input is empty or does not parse as a positive safe integer (i.e. fails `/^[1-9]\d*$/` or `Number.isSafeInteger(...) && value > 0`); the row's hint text SHALL identify `maxCompletionTokens` as the offending field. When that row's "use default" toggle is ON, the value control SHALL NOT block Save regardless of its rendered content. When the user has explicitly overridden `reasoningEnabled` to `false` in the form (its "use default" toggle is OFF and the checkbox is unchecked), the `reasoningEffort` value control SHALL receive a "muted" CSS class (reduced opacity, secondary border) but SHALL remain interactive. The user MAY still toggle its "use default" toggle and edit its value; the value SHALL still be persisted on save, so that toggling `reasoningEnabled` back on at any later time restores the configured effort. The page SHALL NOT introspect server-side env defaults to compute the muted state in this iteration; the muted state is driven only by the explicit override state visible in the form.

#### Scenario: Navigating to the settings panel loads current overrides

- **WHEN** the user navigates to `/settings/llm` and selects a story whose `_config.json` contains `{ "temperature": 0.7 }`
- **THEN** the temperature field SHALL display `0.7` with its "use default" toggle in the OFF position, and every other field (including `maxCompletionTokens`) SHALL show its "use default" toggle in the ON position

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

#### Scenario: maxCompletionTokens control renders a positive-integer number input

- **WHEN** the user navigates to `/settings/llm` and selects any story
- **THEN** the form SHALL render a `maxCompletionTokens` row whose value control is an `<input type="number" min="1" step="1">` paired with the shared "use default" toggle

#### Scenario: Loading existing maxCompletionTokens override

- **GIVEN** a story's `_config.json` contains `{ "maxCompletionTokens": 8192 }`
- **WHEN** the user navigates to `/settings/llm` and selects that story
- **THEN** the `maxCompletionTokens` value control SHALL display `8192` with its "use default" toggle in the OFF position

#### Scenario: Saving maxCompletionTokens override

- **GIVEN** the user has toggled "use default" OFF for `maxCompletionTokens` and set it to `2048`
- **WHEN** the user clicks Save
- **THEN** the frontend SHALL send `PUT /api/:series/:name/config` with a body that contains `"maxCompletionTokens": 2048` (and SHALL NOT include any field whose "use default" toggle is ON)

#### Scenario: Invalid maxCompletionTokens form value blocks save

- **GIVEN** the user has toggled "use default" OFF for `maxCompletionTokens` and entered a value that is empty/whitespace-only, non-integer (e.g. `1024.5`), zero, negative, fails the `/^[1-9]\d*$/` regex, or is not a safe integer
- **WHEN** the form is rendered
- **THEN** the Save action SHALL be disabled and the row SHALL surface a validation hint identifying `maxCompletionTokens` as the offending field, AND no PUT request SHALL be dispatched

#### Scenario: Empty maxCompletionTokens with default toggle ON does not block save

- **GIVEN** the `maxCompletionTokens` "use default" toggle is ON and the value control is empty
- **WHEN** the form is rendered
- **THEN** the Save action SHALL NOT be blocked by the `maxCompletionTokens` row, AND on Save the resulting `_config.json` SHALL omit the `maxCompletionTokens` key
