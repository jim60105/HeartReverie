## MODIFIED Requirements

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
