# Design: Expose LLM defaults in the settings form

## Context

`writer/lib/config.ts` already builds an `llmDefaults: LlmConfig` object at startup from the `LLM_*` env vars. `resolveStoryLlmConfig()` merges per-story overrides on top of it via `Object.assign({}, llmDefaults, storyOverrides)`. Today, only the **merged result** is observable from outside the server (it ends up in the upstream chat request body and the LLM interaction log). The frontend has no API surface to ask "what are the env defaults right now?", so `LlmSettingsPage.vue` cannot show them as either pre-fill values or disabled-state placeholders.

### Terminology

The legacy `LlmSettingsPage.vue` uses an inverted toggle name relative to the user-visible label. Throughout this design and the linked specs:

- **`enabledMap[k] === true`** → the per-field "override" is **enabled**. The "use default" toggle is in its OFF position. The input is editable. The PUT payload includes `k`.
- **`enabledMap[k] === false`** → the override is **disabled**, "use default" is ON. The input is disabled (greyed-out). The PUT payload omits `k`. Today this is when the placeholder text appears; after this change, the disabled input shows the env default value instead.

To avoid drift, sentences in this design and the linked spec MUST refer to "override enabled / disabled" or to the explicit `enabledMap[k]` boolean rather than to abstract "toggle ON / OFF" wording.

## Goals

- Expose env-derived `llmDefaults` to the frontend without leaking `LLM_API_URL`, `LLM_API_KEY`, or any non-LLM config.
- Let the form pre-fill its inputs with the live default value, so editing an override starts from a known baseline.
- Show the default value in disabled (use-default) inputs so users see what value the server will use without leaving the page.
- Stay backwards-compatible with the existing PUT contract: the persisted `_config.json` payload shape is unchanged.

## Non-Goals

- Editing the env defaults from the UI. This change is read-only for defaults.
- Per-user / per-session / per-deployment defaults. The defaults are global, env-driven, and the same for every authenticated client.
- Reactive live-update of defaults if the env changes at runtime. The server reads env once at startup; the frontend fetches once on mount and again on Reset. Operators who change env need to restart, then refresh the page.

## Decisions

### Decision 1: New endpoint at `GET /api/llm-defaults`, authenticated

A dedicated route, not an extension of `GET /api/config` (which is intentionally unauthenticated and serves the public `backgroundImage` only). Authentication is required because:

- The defaults reveal the operator's chosen model (`LLM_MODEL`) and sampling profile, which is non-secret but deployment-specific information the project should not leak to anonymous clients.
- The frontend is already authenticated when reaching `/settings/llm`; reusing the existing `X-Passphrase` middleware is free.

The route SHALL be registered under the same authenticated middleware stack as the per-story config routes in `writer/app.ts`.

**Alternative considered:** extend `GET /api/config` with `llmDefaults`. **Rejected**: that endpoint is intentionally public for the bootstrap background image; mixing authenticated and public payload fields invites accidental leakage on future edits.

### Decision 2: Response shape mirrors `Required<StoryLlmConfig>` exactly

The endpoint returns a JSON body with the same keys as the per-story `_config.json` whitelist (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, plus `maxCompletionTokens` once `update-llm-defaults-and-completion-tokens` ships). Every key is guaranteed to be present and well-typed (no optional `?:`), because env defaults always exist after startup config validation.

The frontend reuses the existing `StoryLlmConfig` type with the per-field optional discipline; the response type is named `LlmDefaultsResponse` and structurally `Required<StoryLlmConfig>`. A backend test asserts the response keys and types exactly match the whitelist used by `_config.json` validation, locking the two shapes against drift.

**Alternative considered:** return the entire `LlmConfig` (including `apiKey` / `apiUrl`). **Rejected** explicitly to prevent secret leakage; the route's serializer is a hand-written object literal naming each allowed field, NOT a `JSON.stringify(llmDefaults)`.

### Decision 3: Frontend fetches once on mount + once on Reset; caches in non-reactive ref

`LlmSettingsPage.vue` calls `loadLlmDefaults()` from `onMounted`. The result is stored in a `shallowRef<LlmDefaultsResponse | null>` (the cached payload is a frozen object so reassignment is the only mutation surface) so changing it does not invalidate every input control. The user-visible Reset (還原) button additionally re-fetches defaults so a deployment env change picked up by a manual server restart is reflected without a hard browser refresh.

The page launches `loadConfig()` and `loadLlmDefaults()` from `onMounted` concurrently, but they MUST be sequenced with `Promise.allSettled` (or per-promise `.catch()`), NOT raw `Promise.all`. A failed defaults fetch SHALL NOT prevent `loadConfig()` from completing or `syncFromOverrides()` from running — the page falls back to today's `使用預設值` placeholder behaviour for disabled rows when `defaults.value === null` (graceful degradation). Surface the defaults-fetch failure as a non-blocking inline notice ("無法載入伺服器預設值，已停用預先填入功能") so the user understands why disabled rows revert to placeholder text.

The Reset button SHALL similarly tolerate a defaults-fetch failure: it re-runs `loadConfig()` unconditionally and attempts a best-effort defaults refresh; if the refresh rejects, the Reset still completes by re-syncing from the loaded overrides plus whatever (possibly stale) `defaults.value` is cached.

If defaults fetch resolves later than `loadConfig()`, the form SHALL re-seed value controls for fields where the persisted override is absent (`enabledMap[k] === false`) AND the user has NOT marked the key dirty (see Decision 5). Existing override values and dirty user edits are NEVER overwritten by a late-arriving defaults fetch.

Add runtime validation to `loadLlmDefaults()`: a malformed or partial response (missing keys, wrong types, invalid `reasoningEffort` enum) SHALL be rejected and treated identically to a network failure (`defaults.value === null`).

**Alternative considered:** server-render the defaults into a `<script>` tag at HTML response time. **Rejected**: the project ships a static SPA built by Vite, with no server-side rendering. A JSON fetch is the only consistent pattern.

### Decision 4: Disabled inputs show defaults as `value`, not `placeholder`

When a field's "use default" is active (i.e. `enabledMap[k] === false`, so the override is **disabled** and the input is rendered greyed-out), the existing template sets `:disabled="!enabledMap[f.key]"` and renders `:placeholder="enabledMap[f.key] ? '' : '使用預設值'"` with an empty `v-model`. The new behaviour SHALL drop the placeholder string and instead bind the input's displayed value to the default — but **without** writing that default into `valueMap`, because writing it would corrupt the PUT payload semantics (today, an empty `valueMap[k]` paired with `enabledMap[k] === false` correctly maps to "no override" in `collectPayload`).

**Vue implementation note:** because `v-model` is incompatible with also binding `:value`/`:checked` on the same element (the two compete for ownership of the input's value), the template SHALL render two mutually exclusive branches per row using `v-if="enabledMap[f.key]"` / `v-else`. The `v-if` branch keeps `v-model="valueMap[f.key]"` (or `v-model="booleanMap.reasoningEnabled"` for the boolean) exactly as today; the `v-else` branch is a separate disabled element that uses one-way `:value="displayValueMap[f.key]"`, `:checked="defaults?.reasoningEnabled === true"`, or `:value="defaults?.reasoningEffort"`. The implementation MUST NOT leave `v-model` on a disabled element while also trying to drive it from `displayValueMap` — that produces races between Vue's `:value` patching and the input element's internal value.

Implementation: introduce a `displayValueMap` computed that returns the raw `valueMap[k]` when the override is enabled (`enabledMap[k] === true`), or `String(defaults.value?.[k] ?? "")` when defaults are loaded, or `""` when defaults failed to load. The template branches as above. For boolean fields the disabled checkbox renders `:checked="defaults?.reasoningEnabled === true"` while the editable branch keeps `v-model="booleanMap.reasoningEnabled"`. For enums (the `reasoningEffort` `<select>`) the disabled branch renders `:value="defaults?.reasoningEffort"`.

This separation guarantees that toggling "use default" repeatedly without typing is a no-op for the persisted payload, identical to today.

### Decision 5: Override-enable transition pre-fills `valueMap` from defaults

Today, transitioning a row from "use default" to "override active" (i.e. `enabledMap[k]` flips `false → true`) leaves `valueMap[k]` at whatever it last was (often empty). The new behaviour SHALL, on the **`false → true`** transition (the user enabled an override), write the server default into `valueMap[k]` IF (a) the persisted `_config.json` does NOT carry that key AND (b) the user has NOT touched the field since the last load AND (c) `defaults.value` is non-null. The user starts editing from a known value instead of a blank field.

**Persisted overrides win over the default seed:** transitioning a row that already had an override loaded keeps the persisted value (which is already in `valueMap[k]` from `syncFromOverrides`), not the default.

**User edits win over the default seed:** the page SHALL track a `dirtyKeys: Set<FieldKey>` populated by an `@input` / `@change` listener on each editable control. Once a key is dirty, neither a late-arriving defaults fetch nor any subsequent `enabledMap` transition SHALL overwrite the user's value. `dirtyKeys` SHALL be cleared whenever `syncFromOverrides` runs (initial load, story switch, post-save, reset). This is critical for the long-string `model` field: a user who enables override, selects all, and clears the prefilled identifier MUST keep the empty input until they type or until they explicitly re-toggle "use default".

**Programmatic transitions do not seed defaults.** `syncFromOverrides` itself mutates `enabledMap` during load / reset / save-response sync / story switch. The seeding logic SHALL guard against firing during these programmatic mutations using either an internal `syncingFromServer` flag or by binding the seed action to the toggle input's `@change` event (the user-driven path) rather than to a broad `enabledMap` watcher.

**Alternative considered:** always pre-fill on the override-enable transition, even when an override is persisted (overwriting the loaded value). **Rejected**: that erases the user's saved customisation invisibly. The persisted value is sacred until the user types.

### Decision 6: Reasoning fields keep their special handling

`reasoningEnabled` (boolean, single checkbox) and `reasoningEffort` (enum, `<select>`) already have dedicated controls and a "muted" CSS state when reasoning is explicitly turned off. This change does NOT touch the muted-state logic; it only adds:

- Disabled `reasoningEnabled` checkbox renders `:checked="defaults?.reasoningEnabled"`.
- Disabled `reasoningEffort` `<select>` renders the default option as its `value`.
- The user-driven `false → true` `enabledMap` transition pre-fills from the default if no persisted override and the key is not dirty.

The earlier writer-side note "the page SHALL NOT introspect server-side env defaults to compute the muted state in this iteration" continues to hold: the muted state is a function of `enabledMap.reasoningEnabled` and `booleanMap.reasoningEnabled`, NOT of `defaults?.reasoningEnabled`. Defaults inform the rendered value of the disabled control; they do NOT affect the muted-state computation.

### Decision 7: Internal state machine — `loadedKeys`, `dirtyKeys`, `syncingFromServer`

Three pieces of internal state govern the prefill / overwrite-protection logic. Together they define a small state machine the implementation MUST follow exactly.

| State | Type | Purpose | Lifecycle |
|-------|------|---------|-----------|
| `loadedKeys` | `Set<FieldKey>` | Keys that the just-loaded `_config.json` carried — i.e. fields that have a **persisted override**. Used in the seed-on-enable check (Decision 5). | Cleared and repopulated at the **start** of every `syncFromOverrides()` call (initial load, story switch, post-save sync, Reset). MUST be re-derived from the response object, not accumulated. |
| `dirtyKeys` | `Set<FieldKey>` | Keys the user has typed into / toggled / selected since the last sync. Used to block default seeding and late-defaults re-seeding (Decision 5). | Cleared at the **start** of every `syncFromOverrides()` call. Populated via per-control `@input` / `@change` listeners (NOT a reactive `watch` on `valueMap`, which would fire during programmatic mutations). |
| `syncingFromServer` | `boolean` | True for the duration of `syncFromOverrides()` so the override-enable seeding logic can ignore programmatic `enabledMap` writes. | Set true at function entry, false at function exit. |

The override-enable seed action SHALL be triggered by the toggle checkbox's `@change` event — a user-driven event that does not fire during programmatic `enabledMap` mutations — rather than a `watch(enabledMap, …)` callback. Even so, the `syncingFromServer` guard is defence-in-depth in case future refactors introduce a watcher.

`syncFromOverrides(overrides: StoryLlmConfig)` becomes:

```
syncingFromServer = true
loadedKeys.clear()
dirtyKeys.clear()
for each whitelisted key k:
  if overrides[k] !== undefined: loadedKeys.add(k); enabledMap[k] = true; valueMap[k] = String(overrides[k])
  else:                          enabledMap[k] = false; valueMap[k] = ""  // unchanged from today
  // boolean / enum fields handled with their dedicated maps, same shape
syncingFromServer = false
```

Late-defaults re-seed (when `loadLlmDefaults()` resolves AFTER `loadConfig()`):

```
for each whitelisted key k:
  if !loadedKeys.has(k) AND !dirtyKeys.has(k):
    // displayValueMap will pick up the new defaults automatically; no valueMap mutation needed
    // (valueMap[k] for a disabled row stays "" — display reads from defaults via displayValueMap)
```

So the late-defaults arrival is, in practice, a no-op for `valueMap` — the disabled-input branch already binds `:value` to `displayValueMap`. The only mutation triggered by a late defaults arrival is the cached `defaults.value` ref itself, which Vue picks up automatically.

User-driven `false → true` `enabledMap` toggle (the seed):

```
if !syncingFromServer AND !loadedKeys.has(k) AND !dirtyKeys.has(k) AND defaults.value !== null:
  valueMap[k] = String(defaults.value[k])  // for the boolean/enum fields, write to booleanMap / valueMap accordingly
```

These three guards are the contract the unit tests SHALL assert.

## Risks

- **Risk: Stale defaults if env changes between server restarts and a tab is left open.** **Mitigation:** the Reset (還原) button re-fetches defaults, and a hard browser refresh always reloads them. Operators changing env defaults typically restart the server anyway.
- **Risk: Disabled-input rendering quirks across browsers.** Specifically, `<input type="number" :disabled="true" :value="0">` correctly shows `0`, not an empty box, on Chromium/Firefox/Safari, but the visual treatment of a `0` value vs. an empty placeholder differs. **Mitigation:** the existing `:disabled` opacity rule already greys out the input; we keep that and let the displayed value sit on top of the same greying. A frontend test renders the page with a known defaults payload and asserts each disabled input's rendered `value` attribute.
- **Risk: Defaults fetch failure breaks the page.** **Mitigation:** Decision 3 explicitly defines the degraded fallback (empty inputs, original placeholder string, toast).
- **Risk: Future env-only fields (e.g. `LOG_LEVEL`) are accidentally shipped over the wire.** **Mitigation:** the route handler is a hand-written object literal, NOT a serializer; adding a new field to `llmDefaults` does NOT automatically expose it. A backend test asserts the response keys are exactly the per-story whitelist, with no extras.

## Migration Plan

None. Pre-release project, zero users. The endpoint is additive; the form's saved-payload shape is unchanged.
