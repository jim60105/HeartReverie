## 1. Backend route

- [x] 1.1 Export a single source-of-truth constant `STORY_LLM_CONFIG_KEYS` from `writer/lib/story-config.ts` listing the per-story whitelist field names as a `readonly` tuple. Replace any internal duplicate lists in that file (e.g. inside `validateStoryLlmConfig`) so the constant is THE whitelist. Re-export it from a stable path so tests can import it.
- [x] 1.2 Add a `LlmDefaultsResponse` type alias in `writer/types.ts` defined as `Required<Pick<LlmConfig, typeof STORY_LLM_CONFIG_KEYS[number]>>`. Do NOT use `Required<LlmConfig>` (which would leak `apiUrl` / `apiKey`).
- [x] 1.3 Create `writer/routes/llm-defaults.ts` exporting `registerLlmDefaultsRoutes(app, deps)` that registers `GET /api/llm-defaults`. The handler SHALL build the response by iterating `STORY_LLM_CONFIG_KEYS` and copying each value from `deps.config.llmDefaults`, NOT by spreading the whole object. Set `Cache-Control: no-store` on the response.
- [x] 1.4 Wire the new route in `writer/app.ts` under the same authenticated middleware stack that protects per-story config routes (NOT under the public `/api/config` middleware).
- [x] 1.5 Confirm the global rate limit applies; no per-route rate limit is required.

## 2. Frontend type & data layer

- [x] 2.1 Add a `LlmDefaultsResponse` type in `reader-src/src/types/index.ts` mirroring the backend whitelist (every per-story whitelist key as required).
- [x] 2.2 Add a `loadLlmDefaults()` helper in the existing `useStoryLlmConfig` composable as an additional named export (returns `Promise<LlmDefaultsResponse>`, throws on non-2xx). Justification: this keeps the LLM-config-related fetches co-located in one composable, matching the existing pattern.
- [x] 2.3 The helper SHALL include the `X-Passphrase` header (reusing the existing fetch wrapper).
- [x] 2.4 The helper SHALL runtime-validate the parsed response: every key from the frontend whitelist must be present, types must match (`model` non-empty string; `reasoningEnabled` boolean; `reasoningEffort` ∈ `REASONING_EFFORTS`; numeric keys are finite numbers). On validation failure, throw a typed `LlmDefaultsValidationError` so the caller can treat it identically to a network failure.

## 3. Frontend page wiring

- [x] 3.1 In `LlmSettingsPage.vue`, declare:
  - `const defaults = shallowRef<LlmDefaultsResponse | null>(null);`
  - `const defaultsError = ref<boolean>(false);`
  - `const loadedKeys = reactive(new Set<FieldKey>());`
  - `const dirtyKeys = reactive(new Set<FieldKey>());`
  - `let syncingFromServer = false;` (a plain `let`; it does NOT need to be reactive)
- [x] 3.2 In `onMounted`, after `fetchSeries()`, when both `selectedSeries` and `selectedStory` resolve, launch `loadConfig()` and `loadLlmDefaults()` concurrently using `Promise.allSettled` (NOT `Promise.all`). The `loadConfig()` outcome SHALL be applied via `syncFromOverrides()` regardless of the defaults outcome. On a defaults success, populate `defaults.value` with `Object.freeze(parsed)`. On a defaults failure (network, non-2xx, or `LlmDefaultsValidationError`), set `defaultsError.value = true`, leave `defaults.value` as `null`, AND emit an inline notice / toast with zh-TW wording ("無法載入伺服器預設值，已停用預先填入功能").
- [x] 3.3 Rewrite `syncFromOverrides(source: StoryLlmConfig)` so it:
  1. Sets `syncingFromServer = true` at entry (and false at exit, in a try/finally).
  2. Clears `loadedKeys` and `dirtyKeys` and rebuilds `loadedKeys` from `source` keys present.
  3. Sets `enabledMap[k] = true` and `valueMap[k] = String(source[k])` (or appropriate map for boolean / enum) for each present key.
  4. Sets `enabledMap[k] = false` and `valueMap[k] = ""` (today's behaviour) for each absent key. Boolean / enum maps left untouched for absent keys (their disabled-state display reads from `defaults`).
- [x] 3.4 Add a `displayValueMap` computed: for each non-boolean field key, return `valueMap[k]` when `enabledMap[k] === true` (override enabled); otherwise return `String(defaults.value?.[k] ?? "")` when `defaults.value` is non-null, or `""` when `defaults.value` is `null`.
- [x] 3.5 Update the template to use mutually exclusive `v-if="enabledMap[f.key]"` / `v-else` branches per field row (do NOT keep `v-model` on a disabled element while binding `:value`):
  - Text / number inputs: `v-if` branch is the existing editable input with `v-model="valueMap[f.key]"` and an `@input` listener that calls `dirtyKeys.add(f.key)`. `v-else` branch is a separate disabled `<input :disabled :value="displayValueMap[f.key]" :placeholder="defaults ? '' : '使用預設值'" />`.
  - `reasoningEnabled` checkbox: `v-if` branch has `v-model="booleanMap.reasoningEnabled"` with `@change="dirtyKeys.add('reasoningEnabled')"`. `v-else` branch is a separate `<input type="checkbox" disabled :checked="defaults?.reasoningEnabled === true" />`.
  - `reasoningEffort` `<select>`: `v-if` branch has `v-model="valueMap.reasoningEffort"` with `@change="dirtyKeys.add('reasoningEffort')"`. `v-else` branch is `<select disabled :value="defaults?.reasoningEffort ?? ''">` rendering the same `REASONING_EFFORTS` options.
- [x] 3.6 Add a `handleEnableToggle(key)` invoked by the "use default" checkbox's `@change` event (NOT a `watch(enabledMap, ...)`). It SHALL run only when the user-driven `enabledMap[k]` transition is `false → true` (the user is **enabling** the override). When triggered, it SHALL seed `valueMap[k]` (or `booleanMap[k]` / `valueMap[k]` for boolean / enum) from `defaults.value[k]` if and only if all four conditions hold: `!syncingFromServer`, `!loadedKeys.has(k)`, `!dirtyKeys.has(k)`, AND `defaults.value !== null`. Otherwise it SHALL leave the existing `valueMap[k]` untouched. (For boolean fields, "seed" means `booleanMap.reasoningEnabled = defaults.value.reasoningEnabled`.)
- [x] 3.7 Re-fetch defaults on Reset: extend `handleReset()` to await `Promise.allSettled([loadConfig(), loadLlmDefaults()])` rather than re-running them sequentially. Defaults-fetch failure SHALL NOT abort the reset: cached `defaults.value` is left at its previous value (NOT cleared to `null` on a transient failure), `loadConfig()` still resolves and `syncFromOverrides()` still runs. Surface a non-blocking notice when defaults refresh fails.
- [x] 3.8 Confirm the muted-state CSS class on `reasoningEffort` continues to be driven only by `enabledMap.reasoningEnabled === true && booleanMap.reasoningEnabled === false`; no change should reference `defaults?.reasoningEnabled`.

## 4. Tests — backend

- [x] 4.1 Add `tests/writer/routes/llm-defaults_test.ts` covering: authenticated GET returns 200 + body matching the env defaults; unauthenticated GET returns 401; response sets `Cache-Control: no-store`; types match the schema (`model: string`, `temperature: number`, `reasoningEnabled: boolean`, `reasoningEffort: REASONING_EFFORTS[number]`).
- [x] 4.2 Add a key-set lock test that imports `STORY_LLM_CONFIG_KEYS` from `writer/lib/story-config.ts` and asserts `Object.keys(responseBody).sort()` equals `[...STORY_LLM_CONFIG_KEYS].sort()`. A diverging field will fail this test loudly.
- [x] 4.3 Add a secret-leakage test asserting the response body does NOT contain any of: `apiKey`, `apiUrl`, `LLM_API_KEY`, `LLM_API_URL`, `PASSPHRASE`, `BACKGROUND_IMAGE`, `PROMPT_FILE`, `LOG_LEVEL`, `LOG_FILE`, `LLM_LOG_FILE`, `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`, `PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `PLUGIN_DIR`.

## 5. Tests — frontend

- [x] 5.1 Add Vitest cases for `useStoryLlmConfig.loadLlmDefaults()` covering: success returns parsed body; non-2xx throws; missing passphrase throws; **malformed body** scenarios — missing required key, wrong type for `temperature`, invalid `reasoningEffort` enum value — each throw `LlmDefaultsValidationError`.
- [x] 5.2 Add component tests for `LlmSettingsPage.vue` covering:
  - On mount with empty `_config.json` and successful defaults fetch: every disabled input renders the correct default value (model, temperature, reasoningEnabled checkbox, reasoningEffort select).
  - Enabling the override (unticking "use default") on a field with no persisted override pre-fills `valueMap` from defaults.
  - Enabling the override on a field with a persisted override keeps the persisted value.
  - **Late-defaults arrival**: simulate `loadConfig()` resolving before `loadLlmDefaults()`. Before defaults arrive, the user enables override on `model` (no seed), types `my/custom`, then defaults resolve — `valueMap.model` SHALL still be `"my/custom"` (dirty key wins).
  - **Model clearing**: enable override on `model` (seeded to default), select-all + clear so the input is empty (`dirtyKeys.has("model")`), then trigger a re-render / late defaults — input stays empty.
  - **Story switching**: load story A with `{ "temperature": 0.5 }`, mark some other key dirty, switch to story B with `{}` — `loadedKeys` and `dirtyKeys` are cleared, every disabled input shows env defaults, enabling override on temperature seeds with default `0.1` (NOT story A's `0.5`).
  - Defaults fetch failure surfaces an inline notice AND falls back to legacy `使用預設值` placeholder behaviour AND leaves override-enable transitions empty.
  - Save with every "use default" ticked sends `PUT` body `{}`.
  - Reset re-fetches defaults on success; on Reset's defaults-fetch failure, the page still completes the reset using the previously cached `defaults.value`.

## 6. Documentation

- [x] 6.1 Update the `Per-Story LLM Settings` section of `AGENTS.md` to mention the new `GET /api/llm-defaults` endpoint and the new pre-fill / disabled-display behaviour of the settings form.
- [x] 6.2 If `docs/per-story-llm-config.md` (or equivalent) exists, refresh it to describe the new endpoint and form behaviour.

## 7. Verification

- [x] 7.1 Run `deno task test` and confirm the backend + frontend suites pass.
- [x] 7.2 Run `deno check` on `writer/server.ts` to confirm strict-mode type checking passes.
- [x] 7.3 Run `openspec validate expose-llm-defaults-in-settings-form --strict` to confirm the change validates cleanly.
- [x] 7.4 Manual smoke: start the dev server, hit `/settings/llm`, verify (a) every disabled input shows the env default value (not the placeholder text), (b) unticking "use default" on temperature for a story with no override pre-fills the input with the env default, (c) clicking Save with no changes sends `PUT` body `{}`, (d) intercepting the network call and forcing a 500 surfaces an inline notice and falls back to placeholder behaviour, (e) typing into the model field, clearing it, then switching stories and back leaves the destination story's disabled inputs displaying env defaults rather than the cleared empty state.
