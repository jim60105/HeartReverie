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

The per-story `_config.json` SHALL accept only the following keys: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens`. `model` SHALL be a non-empty string; `reasoningEnabled` SHALL be a boolean; `reasoningEffort` SHALL be one of the literal strings `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` (case-sensitive); `maxCompletionTokens` SHALL be either a positive finite safe integer (`Number.isSafeInteger(value) && value > 0`) **or the JSON literal `null`**, where `null` carries the explicit semantics "no application-level token limit; let the upstream provider decide" and is treated specially by the merge step (see `Merge semantics at chat time`). Every other listed key SHALL be a finite number. Any other key SHALL be stripped on write and ignored on read. Values of incorrect type SHALL cause the write to be rejected and the read to raise a validation error.

For all whitelisted keys **except** `maxCompletionTokens`, the validator SHALL accept `null` and `undefined` as "no override" markers and SHALL strip them from the parsed object (so they never appear in `storyOverrides` and trivially fall through to the env default at merge time). Only `maxCompletionTokens: null` SHALL be preserved verbatim through both the validator and the on-disk JSON file, so the merge step can distinguish "key absent / null-stripped → fall through to env default" from "`maxCompletionTokens` explicitly `null` → override env default to `null`".

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

#### Scenario: Write accepts null maxCompletionTokens as explicit "no limit"

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": null }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "maxCompletionTokens": null }` to `_config.json` verbatim (the field SHALL NOT be stripped) and respond HTTP 200 with the persisted object

#### Scenario: Write rejects non-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 1024.5 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-positive maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 0 }` or `{ "maxCompletionTokens": -1 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects unsafe-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 9007199254740993 }` (a JSON number above `Number.MAX_SAFE_INTEGER`) to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-number, non-null maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": "4096" }` (string) or `{ "maxCompletionTokens": true }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

### Requirement: Merge semantics at chat time

The backend SHALL compute the effective LLM configuration for each chat request as `Object.assign({}, llmDefaults, storyOverrides)`, where `llmDefaults` is the env-derived `LlmConfig` object (including the `maxCompletionTokens` field, whose env default is `null` when `LLM_MAX_COMPLETION_TOKENS` is unset/empty/invalid) and `storyOverrides` is the validated partial object read from `_config.json`. Merging SHALL happen per chat request so that changes to `_config.json` take effect on the next request without a server restart.

For all fields **except** `maxCompletionTokens`, fields present in `storyOverrides` with non-`undefined`, non-`null` values SHALL replace the default; otherwise they SHALL keep the env default (i.e. a `null` override falls through).

For `maxCompletionTokens` specifically, the merge SHALL diverge from the default `Object.assign(...)` semantics: a key explicitly present in `_config.json` with the value `null` SHALL be treated as an explicit "no limit" override that replaces the env default with `null` (rather than falling through). The whitelist validator SHALL preserve `null` literals during read so the merge step can distinguish "key absent" (fall through to env default) from "key explicitly `null`" (override to `null`). When the merged `maxCompletionTokens` is `null`, the upstream chat/completions request body SHALL omit the `max_completion_tokens` key entirely.

#### Scenario: Merge resolves at each request
- **GIVEN** env default `temperature=0.1` and a story with `_config.json` containing `{ "temperature": 0.7 }`
- **WHEN** two chat requests arrive, and between them the file is updated to `{ "temperature": 0.3 }`
- **THEN** the first request SHALL use `temperature=0.7` and the second request SHALL use `temperature=0.3` without restarting the server

#### Scenario: Null and missing fields both fall through to default (non-maxCompletionTokens)
- **GIVEN** env default `topK=10` and a story with `_config.json` containing `{ "topK": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL use `top_k=10`

#### Scenario: maxCompletionTokens override resolves at each request
- **GIVEN** env default `maxCompletionTokens=null` and a story with `_config.json` containing `{ "maxCompletionTokens": 8192 }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 8192`

#### Scenario: Missing maxCompletionTokens falls through to env default
- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` that does NOT include the `maxCompletionTokens` key at all
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 4096`

#### Scenario: Explicit null maxCompletionTokens overrides a non-null env default
- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` (the explicit per-story `null` overrides the env default rather than falling through), AND the upstream chat/completions request body SHALL NOT contain a `max_completion_tokens` key at all

#### Scenario: Both null collapses to no upstream key
- **GIVEN** env default `maxCompletionTokens=null` (from `LLM_MAX_COMPLETION_TOKENS` unset) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` AND the upstream request body SHALL NOT contain a `max_completion_tokens` key

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

The Vue frontend SHALL provide a lazy-loaded `LlmSettingsPage.vue` mounted at the `/settings/llm` route under the existing `SettingsLayout.vue`. The page SHALL let the user pick an existing story (reusing the existing story selector) and edit that story's LLM overrides. Each overridable field SHALL render a per-field "覆寫此欄位" (override this field) checkbox that drives an internal boolean `enabledMap[k]`; when `enabledMap[k] === true` the override is **enabled** (the checkbox is ticked, the input is editable, the field IS included in the PUT payload), when `enabledMap[k] === false` the override is **disabled** (the checkbox is unticked, the input is greyed out, the field is omitted from the PUT payload and the env default applies). Saving SHALL call `PUT /api/:series/:name/config` through the existing `useStoryLlmConfig` composable. The page SHALL surface API errors through the existing toast notification mechanism. UI text SHALL be in Traditional Chinese (zh-TW) consistent with the rest of the frontend.

> **Terminology note:** the rendered checkbox is the *direct* surface of `enabledMap[k]` — the box is ticked when the override is **enabled** (`enabledMap[k] === true`), unticked when the override is **disabled** (`enabledMap[k] === false`). The hint text next to the label MAY display "（已覆寫）" while ticked and "（使用預設）" while unticked. All scenarios below state both the user-visible checkbox state ("override ticked" / "override unticked") AND the `enabledMap[k]` boolean explicitly to avoid ambiguity.

The page SHALL render dedicated controls for `reasoningEnabled` (a single checkbox value control) and `reasoningEffort` (a `<select>` whose options are derived from a single shared `REASONING_EFFORTS` runtime tuple — `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` — and SHALL NOT redeclare the literal array). When the user has explicitly overridden `reasoningEnabled` to `false` in the form (`enabledMap.reasoningEnabled === true` AND the value checkbox is unchecked), the `reasoningEffort` value control SHALL receive a "muted" CSS class (reduced opacity, secondary border) but SHALL remain interactive. The user MAY still toggle its `enabledMap.reasoningEffort` and edit its value; the value SHALL still be persisted on save. The muted state for `reasoningEffort` SHALL be driven only by `enabledMap.reasoningEnabled` and `booleanMap.reasoningEnabled` (the explicit override state visible in the form), and SHALL NOT depend on the fetched env defaults.

The page SHALL fetch the env-derived LLM defaults from `GET /api/llm-defaults` on mount, concurrently with the per-story `loadConfig()` call, sequenced via `Promise.allSettled` (or per-promise `.catch()`) so a defaults fetch failure does NOT block `loadConfig()`. The page SHALL again refetch defaults whenever the user clicks the Reset (還原) button. The fetched defaults SHALL be cached in a `shallowRef<LlmDefaultsResponse | null>` named `defaults`, populated on a validated success response and left at `null` on network failure, non-2xx response, or a malformed body (missing keys, wrong types, invalid `reasoningEffort` enum value).

The page SHALL maintain three pieces of internal state to govern overwrite-protection: `loadedKeys: Set<FieldKey>` (keys present in the most recently loaded `_config.json`), `dirtyKeys: Set<FieldKey>` (keys the user has edited since the last load), and `syncingFromServer: boolean` (true while `syncFromOverrides()` is mutating maps). Both sets SHALL be cleared and repopulated at the start of every `syncFromOverrides()` call (initial load, story switch, post-save sync, Reset). `dirtyKeys` SHALL be populated via per-control `@input` / `@change` listeners (NOT a reactive `watch` on `valueMap`).

For every field, the rendering and editing semantics SHALL be:

- **`enabledMap[k] === true` (override ticked / override enabled)** — the input is editable. The displayed value is whatever is currently in `valueMap[k]` / `booleanMap[k]` — initially the value loaded from `_config.json` (when present in `loadedKeys`), or the env default that was seeded by the user-driven `enabledMap[k]` toggle transition (see below), or whatever the user has typed since.
- **`enabledMap[k] === false` (override unticked / override disabled)** — the input is disabled and rendered greyed-out. The displayed value comes through a `displayValueMap` getter (or `:checked` binding for booleans, `:value` binding for the enum `<select>`) reading from `defaults.value?.[k]`. The control SHALL NOT mutate `valueMap` / `booleanMap`, preserving today's "field omitted from PUT" semantics. When `defaults.value === null` (fetch failed or pending), the disabled input SHALL fall back to the legacy `使用預設值` placeholder text.

The template SHALL use a `v-if="enabledMap[f.key]"` / `v-else` pair to render two mutually exclusive controls per row: the `v-if` branch keeps the existing `v-model="valueMap[f.key]"` (or `v-model="booleanMap.reasoningEnabled"`) two-way binding; the `v-else` branch is a separate disabled element using one-way `:value` / `:checked` bound to `displayValueMap[f.key]` / `defaults?.reasoningEnabled` / `defaults?.reasoningEffort`. The implementation MUST NOT leave `v-model` on a disabled element while also driving its value from `displayValueMap`.

When the user transitions a field by ticking the override checkbox (i.e. `enabledMap[k]` goes from `false → true`, the override is being **enabled**), the page SHALL pre-fill `valueMap[k]` / `booleanMap[k]` with the value from `defaults` if and only if all three hold: (a) `loadedKeys` does NOT contain `k` (no persisted override in `_config.json`), (b) `dirtyKeys` does NOT contain `k` (the user has not edited the field since the last load), AND (c) `defaults.value !== null`. Otherwise the existing `valueMap[k]` value (loaded persisted override, or prior user edit, or empty) is preserved. The seed action SHALL be triggered by the override checkbox's `@change` event so it never fires during programmatic `enabledMap` mutations; the `syncingFromServer` flag SHALL be defence-in-depth.

When the `GET /api/llm-defaults` fetch fails (network error, 401, malformed body), the page SHALL surface an inline non-blocking notice ("無法載入伺服器預設值，已停用預先填入功能" or equivalent zh-TW wording) AND fall back to the legacy empty-input behaviour: disabled inputs render the existing `使用預設值` placeholder, override-enable transitions leave `valueMap` empty. The page SHALL remain fully interactive in the degraded mode.

#### Scenario: Defaults fetched on mount populate disabled inputs

- **GIVEN** the server-side env-derived defaults are `{ "model": "deepseek/deepseek-v4-pro", "temperature": 0.1, "reasoningEnabled": true, "reasoningEffort": "high", ... }` AND the user opens `/settings/llm` and selects a story whose `_config.json` is empty `{}`
- **WHEN** the page renders after `loadConfig()` and `loadLlmDefaults()` both resolve successfully
- **THEN** every override checkbox SHALL be unticked (`enabledMap[k] === false`), every input SHALL be disabled and visibly greyed-out, AND each disabled input SHALL display its corresponding value from the defaults payload — for example the temperature input SHALL render `0.1` (not empty, not the placeholder text), the model input SHALL render `deepseek/deepseek-v4-pro`, the `reasoningEffort` `<select>` SHALL show `high` selected, the `reasoningEnabled` checkbox SHALL be checked

#### Scenario: Enabling override on a field with no persisted override pre-fills the default

- **GIVEN** defaults include `temperature: 0.1`, AND the loaded `_config.json` has no `temperature` key (so `loadedKeys` does NOT contain `temperature`), AND `dirtyKeys` does NOT contain `temperature`, AND the temperature row is currently in `enabledMap.temperature === false` state with the override unticked and the input disabled showing `0.1`
- **WHEN** the user ticks the temperature override checkbox (transitioning `enabledMap.temperature` from `false` to `true`, enabling the override)
- **THEN** the temperature input SHALL become editable AND `valueMap.temperature` SHALL be pre-filled with `"0.1"`, AND the user MAY edit from there

#### Scenario: Enabling override on a field with a persisted override keeps the persisted value

- **GIVEN** defaults include `temperature: 0.1`, AND the loaded `_config.json` is `{ "temperature": 0.7 }` (so `loadedKeys` contains `temperature`), AND the temperature row was rendered in the `enabledMap.temperature === true` state (override ticked) showing `0.7` (override enabled, value loaded from `_config.json`)
- **WHEN** the user unticks the temperature override checkbox (`true → false`) and then re-ticks it (`false → true`) without typing
- **THEN** `valueMap.temperature` SHALL still be `"0.7"`, NOT `"0.1"` — the persisted override is sacred and SHALL NOT be overwritten by the default seed because `loadedKeys` contains the key

#### Scenario: User edits beat late-arriving defaults

- **GIVEN** the user opens `/settings/llm`, AND `loadConfig()` resolves immediately with an empty `_config.json` while `loadLlmDefaults()` is still pending, AND the user ticks the `model` override checkbox (no seed yet because `defaults.value === null`), AND the user types `my/custom-model` into the now-editable input (so `dirtyKeys` contains `model`)
- **WHEN** `loadLlmDefaults()` resolves with a default `model` of `deepseek/deepseek-v4-pro`
- **THEN** `valueMap.model` SHALL still be `"my/custom-model"` — `dirtyKeys` blocks the late seed; the disabled `:value` rendering for OTHER rows still in `enabledMap[k] === false` state SHALL pick up the new defaults via `displayValueMap`

#### Scenario: User clears the prefilled model and the empty value persists

- **GIVEN** `defaults.model === "deepseek/deepseek-v4-pro"`, AND the user has just ticked the `model` override checkbox so `valueMap.model` was seeded with `"deepseek/deepseek-v4-pro"` and the input is editable
- **WHEN** the user selects all and presses Delete, leaving `valueMap.model === ""` and `dirtyKeys` containing `model`
- **THEN** the input SHALL stay empty — neither a re-render, a late `loadLlmDefaults()` resolution, nor any other reactive effect SHALL re-seed `"deepseek/deepseek-v4-pro"` back into `valueMap.model`. The user MUST either type a value or untick the override checkbox to restore the disabled-input default display.

#### Scenario: Switching stories resets dirty + loaded state and re-seeds correctly

- **GIVEN** the user is editing story A whose `_config.json` is `{ "temperature": 0.5 }` (so `loadedKeys` contains `temperature`), AND has ticked the `model` override box and typed `my/model` (`dirtyKeys` contains `model`)
- **WHEN** the user switches to story B whose `_config.json` is `{}`, triggering a fresh `syncFromOverrides()`
- **THEN** `loadedKeys` SHALL be cleared and rebuilt (now empty), `dirtyKeys` SHALL be cleared, every `enabledMap[k]` SHALL be `false` (every override checkbox unticked), every disabled input SHALL render the env default value (e.g. temperature shows `0.1`, model shows `deepseek/deepseek-v4-pro`), AND when the user subsequently ticks the temperature override box `valueMap.temperature` SHALL be seeded with `"0.1"` from defaults — NOT `"0.5"` from story A's stale state

#### Scenario: Defaults fetch failure degrades gracefully

- **GIVEN** the user opens `/settings/llm` AND `GET /api/llm-defaults` rejects with a network error, returns a 5xx body, OR returns a malformed body (missing key, wrong type, invalid `reasoningEffort` enum value)
- **WHEN** the page finishes loading
- **THEN** `defaults.value` SHALL be `null`, `loadConfig()` SHALL still complete and `syncFromOverrides()` SHALL still run, the page SHALL surface an inline notice informing the user that defaults could not be loaded, every disabled input SHALL render the legacy `使用預設值` placeholder text (NOT a value), ticking any override checkbox SHALL leave its input empty (legacy behaviour), AND the page SHALL remain fully interactive — the user MAY still type values and click Save

#### Scenario: Reset (還原) survives a defaults-fetch failure

- **GIVEN** the user has been editing the form and clicks the Reset (還原) button, AND the subsequent best-effort `loadLlmDefaults()` rejects
- **WHEN** Reset processing completes
- **THEN** `loadConfig()` SHALL still re-resolve and `syncFromOverrides()` SHALL still run, `dirtyKeys` and `loadedKeys` SHALL still be cleared and repopulated, the cached `defaults.value` SHALL be left at its previous value (NOT cleared to `null` on a transient failure), AND the user SHALL see a non-blocking notice explaining the defaults refresh failed

#### Scenario: Reset (還原) re-fetches defaults on success

- **GIVEN** the user has been on the page and the server has been restarted with a different `LLM_TEMPERATURE`
- **WHEN** the user clicks the Reset (還原) button AND both `loadConfig()` and `loadLlmDefaults()` succeed
- **THEN** the page SHALL reissue `GET /api/llm-defaults`, AND re-apply the new defaults to disabled-input displays AND to subsequent override-enable seed transitions on fields not present in `loadedKeys`

#### Scenario: Saving with every override disabled sends an empty body

- **GIVEN** every override checkbox is unticked (`enabledMap[k] === false` for every key), so the page is showing defaults in disabled inputs
- **WHEN** the user clicks Save without making any changes
- **THEN** the frontend SHALL send `PUT /api/:series/:name/config` with body `{}` — disabled inputs displaying default values SHALL NOT contribute to the payload

#### Scenario: Defaults exclude secrets

- **WHEN** the page receives a `GET /api/llm-defaults` response
- **THEN** the response body SHALL NOT contain `apiKey`, `apiUrl`, or any other non-whitelist key — the page treats unknown keys as a developer error and SHALL ignore them silently

