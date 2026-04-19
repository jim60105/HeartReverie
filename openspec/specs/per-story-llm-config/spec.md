# Per-Story LLM Config

## Purpose

Per-story LLM parameter overrides stored alongside story content as `playground/<series>/<story>/_config.json`. Each request merges validated story-level overrides over env-derived defaults so individual stories can tune model and sampling parameters without restarting the server or affecting other stories. A REST API and a Settings UI expose read/write access to these overrides.

## Requirements

### Requirement: Per-story LLM config file format and location

Each story SHALL be allowed to declare per-story LLM parameter overrides in a file at `playground/<series>/<story>/_config.json`. The file SHALL be a JSON object whose keys are a subset of the allowed LLM parameter names. The file's presence SHALL be optional; its absence SHALL be semantically equivalent to an empty object. The leading underscore SHALL mark the file as system-reserved so that existing story/series listing logic in `writer/lib/story.ts` continues to exclude it from user-visible chapter and story listings.

#### Scenario: Story without `_config.json` uses env defaults
- **WHEN** a chat request targets a story directory that contains no `_config.json`
- **THEN** the backend SHALL use the env-derived `llmDefaults` object for every LLM parameter in the upstream request body

#### Scenario: Story with `_config.json` partial overrides are applied
- **GIVEN** a story directory contains `_config.json` with content `{ "temperature": 0.9, "topK": 5 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream LLM request body SHALL use `temperature=0.9` and `top_k=5` while every other LLM parameter falls through to the env default

#### Scenario: Unknown keys in `_config.json` are ignored
- **GIVEN** a story's `_config.json` contains `{ "temperature": 0.5, "unknown": "x" }`
- **WHEN** the backend loads and merges the config
- **THEN** the `unknown` key SHALL be ignored and SHALL NOT appear in the upstream LLM request body

#### Scenario: Malformed `_config.json` surfaces as a chat error
- **GIVEN** a story's `_config.json` contains invalid JSON
- **WHEN** a chat request targets that story
- **THEN** the backend SHALL respond with an RFC 9457 Problem Details error (HTTP 500) describing the invalid story config and SHALL NOT send a request upstream

### Requirement: Overridable LLM parameters whitelist

The per-story `_config.json` SHALL accept only the following keys: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`. `model` SHALL be a non-empty string; every other listed key SHALL be a finite number. Any other key SHALL be stripped on write and ignored on read. Values of incorrect type SHALL cause the write to be rejected and the read to raise a validation error.

#### Scenario: Write rejects wrong-type value
- **WHEN** a client PUTs `{ "temperature": "hot" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying the offending field

#### Scenario: Write strips non-whitelisted keys
- **WHEN** a client PUTs `{ "temperature": 0.7, "tools": [] }` to the per-story config endpoint
- **THEN** the persisted file SHALL contain only `{ "temperature": 0.7 }`

#### Scenario: Model must be a non-empty string
- **WHEN** a client PUTs `{ "model": "" }`
- **THEN** the server SHALL respond with HTTP 400 and SHALL NOT modify the persisted file

### Requirement: Merge semantics at chat time

The backend SHALL compute the effective LLM configuration for each chat request as `Object.assign({}, llmDefaults, storyOverrides)`, where `llmDefaults` is the env-derived `LlmConfig` object and `storyOverrides` is the validated partial object read from `_config.json`. Merging SHALL happen per chat request so that changes to `_config.json` take effect on the next request without a server restart. Fields present in `storyOverrides` with non-`undefined`, non-`null` values SHALL replace the default; all other fields SHALL keep the env default.

#### Scenario: Merge resolves at each request
- **GIVEN** env default `temperature=0.1` and a story with `_config.json` containing `{ "temperature": 0.7 }`
- **WHEN** two chat requests arrive, and between them the file is updated to `{ "temperature": 0.3 }`
- **THEN** the first request SHALL use `temperature=0.7` and the second request SHALL use `temperature=0.3` without restarting the server

#### Scenario: Null and missing fields both fall through to default
- **GIVEN** env default `topK=10` and a story with `_config.json` containing `{ "topK": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL use `top_k=10`

### Requirement: Authenticated REST API for per-story config

The backend SHALL expose two routes for managing per-story LLM config:
- `GET /api/:series/:name/config` SHALL return the story's current overrides as a JSON object (empty object if `_config.json` does not exist).
- `PUT /api/:series/:name/config` SHALL accept a JSON body, validate it against the whitelist, and persist the normalised result to `_config.json`. The target story directory (`playground/<series>/<story>/`) MUST already exist before this call; if it does not, the server SHALL respond with HTTP 404 Problem Details and SHALL NOT create any file or directory. Writing an empty object SHALL be allowed (when the directory exists) and SHALL result in an empty JSON object on disk.

Both routes SHALL require the `X-Passphrase` header validated by the existing auth middleware, SHALL be subject to the existing global rate limiter, and SHALL resolve `:series` / `:name` through the existing `safePath()` helper to prevent path traversal. Error responses SHALL follow RFC 9457 Problem Details format. These routes SHALL NOT interfere with the existing public `GET /api/config` endpoint that serves `backgroundImage`.

#### Scenario: GET returns empty object for a story with no config file
- **GIVEN** an existing story with no `_config.json`
- **WHEN** an authenticated client issues `GET /api/:series/:name/config`
- **THEN** the response SHALL be HTTP 200 with body `{}`

#### Scenario: GET returns stored overrides
- **GIVEN** a story's `_config.json` contains `{ "temperature": 0.7 }`
- **WHEN** an authenticated client issues `GET /api/:series/:name/config`
- **THEN** the response SHALL be HTTP 200 with body `{ "temperature": 0.7 }`

#### Scenario: PUT persists validated overrides
- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{ "temperature": 0.9, "topK": 5 }`
- **THEN** the server SHALL write `{ "temperature": 0.9, "topK": 5 }` to `playground/<series>/<story>/_config.json` and respond HTTP 200 with the persisted object

#### Scenario: PUT with empty object clears overrides
- **GIVEN** a story's `_config.json` currently contains `{ "temperature": 0.9 }`
- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with body `{}`
- **THEN** the persisted file SHALL contain `{}` and subsequent chat requests SHALL use env defaults for every parameter

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client issues `GET /api/:series/:name/config` without a valid `X-Passphrase` header
- **THEN** the server SHALL respond HTTP 401 with an RFC 9457 Problem Details body

#### Scenario: Path traversal is rejected
- **WHEN** a client issues `PUT /api/../../etc/config` (or any param that resolves outside the playground directory)
- **THEN** the server SHALL respond HTTP 400 and SHALL NOT write any file

#### Scenario: PUT for a non-existent story returns 404
- **GIVEN** no directory exists at `playground/<series>/<story>/` (the `:series`/`:name` combination passes `safePath()` but the story has never been created)
- **WHEN** an authenticated client issues `PUT /api/:series/:name/config` with any body
- **THEN** the server SHALL respond with HTTP 404 and an RFC 9457 Problem Details body and SHALL NOT create the story directory or any `_config.json` file

### Requirement: Story listings exclude the config file

Existing series and story listing behaviour implemented in `writer/lib/story.ts` SHALL continue to skip entries whose names begin with `_`, so that `_config.json` inside a story directory does not appear as a chapter and does not disrupt series/story enumeration.

#### Scenario: Chapter listing ignores `_config.json`
- **GIVEN** a story directory containing `001.md`, `002.md`, and `_config.json`
- **WHEN** the backend returns the story's chapter listing
- **THEN** the listing SHALL contain only `001.md` and `002.md`

### Requirement: Frontend LLM settings panel per story

The Vue frontend SHALL provide a new lazy-loaded `LlmSettingsPage.vue` mounted at the `/settings/llm` route under the existing `SettingsLayout.vue`. The page SHALL let the user pick an existing story (reusing the existing story selector) and edit that story's LLM overrides. Each overridable field SHALL render a "use default" toggle; when toggled on, the field is absent from the PUT payload and the env default applies. Saving SHALL call `PUT /api/:series/:name/config` through a new `useStoryLlmConfig` composable. The page SHALL surface API errors through the existing toast notification mechanism. UI text SHALL be in Traditional Chinese (zh-TW) consistent with the rest of the frontend.

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
