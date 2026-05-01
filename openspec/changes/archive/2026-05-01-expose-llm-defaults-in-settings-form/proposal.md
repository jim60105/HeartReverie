# Expose LLM defaults in the per-story settings form

## Why

The `/settings/llm` page currently lets operators override the server-wide LLM sampling parameters per story, but the form has **no idea what those server-wide defaults actually are**. When a user toggles "use default" OFF the input box becomes empty, and when toggled ON the disabled placeholder simply reads `使用預設值` ("uses default value") with no value rendered. This is a usability problem on two axes:

1. **Discoverability** — to pick a sensible override (e.g. nudging `temperature` from `0.1` to `0.2`) the user must first know the current default. Today they have to leave the page, dig through `.env` / `AGENTS.md` / source code, then come back. Many users will never realise the defaults are tunable at all.
2. **Friction** — even when the user knows what they want, the empty-input pattern forces them to retype the entire value, including parts they did not want to change. A typo on a numeric field (e.g. `0.1` → `0`) silently passes the existing finite-number check and ships to the LLM provider as a destructive override.

The fix is straightforward: surface the live env-derived defaults on the page so every input control already shows the value it would inherit, and let the user edit from that starting point.

## What Changes

1. **New backend endpoint** — `GET /api/llm-defaults` (authenticated, `X-Passphrase` required) returns a JSON object whose keys are exactly the per-story `_config.json` whitelist. Unlike `_config.json` payloads (which are sparse / optional), this response has every whitelisted key required and well-typed because env defaults are fully resolved at startup. The endpoint SHALL NOT leak `LLM_API_URL`, `LLM_API_KEY`, `PASSPHRASE`, or any non-LLM config. The response type is `LlmDefaultsResponse`, structurally `Required<Pick<LlmConfig, ...whitelist...>>`.

2. **Frontend pre-fill behavior** — `LlmSettingsPage.vue` SHALL fetch `/api/llm-defaults` once on mount (and when the user explicitly clicks 還原 / Reset), keep the result in a non-reactive map, and seed every value control with that default whenever the user does not have an override loaded for the field. Concretely:
   - When a field's "use default" toggle is **OFF** AND the loaded `_config.json` already carries an override for that field → the value control shows the persisted override (current behaviour, unchanged).
   - When a field's "use default" toggle is **OFF** AND no override is persisted (e.g. the user just toggled it off, or the override was previously cleared) → the value control SHALL pre-fill with the server default value as a starting point. The user edits from there; saving persists whatever they leave in the box.
   - When a field's "use default" toggle is **ON** → the value control SHALL be disabled and visibly greyed-out (existing `:disabled` opacity styling) AND SHALL display the server default value as its rendered content (instead of the existing `使用預設值` placeholder). The user reads the default but cannot edit it; the PUT payload still omits the field, matching today's "use default" semantics.

3. **Defensive fallback** — if `/api/llm-defaults` fails to load (network error, 401), the page SHALL fall back to today's behaviour (empty inputs, `使用預設值` placeholder when disabled) AND surface a toast notification informing the user that defaults could not be loaded. The page MUST remain usable in this degraded mode so that authenticated users with a transient network glitch can still edit overrides; they just lose the discoverability win.

## Capabilities affected

- **`writer-backend`** (modified) — register one new authenticated route `GET /api/llm-defaults`.
- **`per-story-llm-config`** (modified) — extend the existing "Frontend LLM settings panel per story" requirement with the pre-fill / disabled-display behaviour. This explicitly supersedes the earlier `"page SHALL NOT introspect server-side env defaults"` clause from the muted-control requirement (that clause was scoped to the muted state for `reasoningEffort`; with this change the page DOES fetch env defaults, but the muted-state computation still does not depend on them — it remains driven only by the form state).

No new capability spec is required; the change is a pure extension of two existing capabilities.

## Impact

- **Affected code:**
  - `writer/routes/llm-defaults.ts` (new) — handler registration
  - `writer/app.ts` — wire the new route under the authenticated middleware stack
  - `writer/types.ts` — add `LlmDefaultsResponse` type (alias for `Required<StoryLlmConfig>`)
  - `reader-src/src/composables/useStoryLlmConfig.ts` (or new `useLlmDefaults.ts`) — `loadLlmDefaults()` helper
  - `reader-src/src/components/LlmSettingsPage.vue` — pre-fill logic, disabled-display logic
  - `reader-src/src/types/index.ts` — `LlmDefaultsResponse` type mirror

- **Breaking changes:** none. The endpoint is additive; the form's persisted output (PUT payload shape) is unchanged.

- **Migration:** none. Pre-release project, zero users in the wild.

- **Coordination with `update-llm-defaults-and-completion-tokens`:** that change introduces `maxCompletionTokens` and a new default model; once both changes ship, the new endpoint SHALL include `maxCompletionTokens` in its response and the form SHALL pre-fill it like every other numeric field. Implementation order is not strictly required, but if `update-llm-defaults-and-completion-tokens` lands first, this change inherits the field automatically; if this lands first, the other change adds one more entry to the `LlmDefaultsResponse` shape and the page's `FIELDS` list.
