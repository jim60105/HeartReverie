## 1. Backend types and config

- [x] 1.1 Extend `LlmConfig` interface in `writer/types.ts` with `readonly maxCompletionTokens: number;`
- [x] 1.2 Extend `AppConfig` interface in `writer/types.ts` with `readonly LLM_MAX_COMPLETION_TOKENS: number;`
- [x] 1.3 Add a `posIntEnv(key, fallback)` helper to `writer/lib/config.ts` that trims the raw env value, requires a full-string match against `/^[1-9]\d*$/` (no leading zeros, no sign, no decimal, no exponent), parses with `Number(...)`, and validates `Number.isSafeInteger(parsed) && parsed > 0`; empty/unset/whitespace-only → fallback (silent); regex/safe-integer failure → fallback AND emit a warning log naming the variable and the offending value (same shape as `boolEnv` / `effortEnv`)
- [x] 1.4 Read `LLM_MAX_COMPLETION_TOKENS` via `posIntEnv` with default `4096` and add it to `llmDefaults` and to the module's named exports
- [x] 1.5 Change the `LLM_MODEL` fallback in `writer/lib/config.ts` from `"deepseek/deepseek-v3.2"` to `"deepseek/deepseek-v4-pro"`
- [x] 1.6 Change the `LLM_REASONING_EFFORT` fallback in `writer/lib/config.ts` from `"high"` to `"xhigh"` (passed to `effortEnv`)

## 2. Per-story config validation and merge

- [x] 2.1 Add `maxCompletionTokens` to the whitelist constant / parsing branches in `writer/lib/story-config.ts`
- [x] 2.2 Validate `maxCompletionTokens` as `typeof value === "number" && Number.isSafeInteger(value) && value > 0`; on failure throw the existing typed validation error (so the route handler emits HTTP 400 RFC 9457 Problem Details). Note: this is stricter than `Number.isInteger` to reject JSON numbers above `2^53−1`.
- [x] 2.3 Treat `null` / `undefined` `maxCompletionTokens` as "drop the override" so it falls through `Object.assign({}, llmDefaults, storyOverrides)` to the env default
- [x] 2.4 Confirm `resolveStoryLlmConfig()` already merges via `Object.assign({}, llmDefaults, storyOverrides)` and therefore picks up `maxCompletionTokens` automatically once the validator returns it

## 3. Upstream request body & logging

- [x] 3.1 In `writer/lib/chat-shared.ts`, add `max_completion_tokens: llmConfig.maxCompletionTokens` to the `requestBody` object (always present, regardless of `LLM_REASONING_OMIT`)
- [x] 3.2 Add `maxCompletionTokens: llmConfig.maxCompletionTokens` to the `LLM request payload` operational debug log payload
- [x] 3.3 Add `maxCompletionTokens: llmConfig.maxCompletionTokens` to the `parameters` object inside the `LLM request` LLM-interaction log entry
- [x] 3.4 Verify no other call sites read or mutate `llmConfig` such that they need to be updated (search `llmConfig.` in `writer/`)

## 4. Frontend wiring

- [x] 4.1 Add `maxCompletionTokens?: number` to the per-story override TypeScript type the frontend uses (mirror backend's `StoryLlmConfigOverrides`); locate the type in `reader-src/src/types/`
- [x] 4.2 In `reader-src/src/views/LlmSettingsPage.vue` (or wherever the page currently lives), extend the `FIELDS` descriptor list, the `enabledMap` ref, and the `valueMap` ref to include a `maxCompletionTokens` field with its own "use default" toggle; the PUT payload builder SHALL include `maxCompletionTokens` only when its toggle is OFF and the trimmed input parses as a positive safe integer (`/^[1-9]\d*$/` + `Number.isSafeInteger`)
- [x] 4.3 Add the row to the page template — `<input type="number" min="1" step="1">` paired with the existing "use default" toggle component; show a Traditional Chinese (zh-TW) label and helper text consistent with surrounding rows
- [x] 4.4 Compute a `maxCompletionTokensInvalid` boolean and disable Save (alongside any existing disabled conditions) and surface a validation hint **only when** the row's "use default" toggle is OFF and the value fails the regex/safe-integer check (including empty/whitespace, fractional, zero, negative, leading-zero, exponent, partial-numeric like `4096abc`); when the toggle is ON the row SHALL NOT contribute to the disabled state regardless of input contents
- [x] 4.5 If a `useStoryLlmConfig` composable exists in `reader-src/src/composables/`, also extend its form schema; if not, do not introduce one for this change

## 5. Documentation

- [x] 5.1 Update `.env.example` to document `LLM_MAX_COMPLETION_TOKENS` (with `4096` as the commented default) and refresh `LLM_MODEL`'s commented default to `deepseek/deepseek-v4-pro`; refresh `LLM_REASONING_EFFORT` default to `xhigh`
- [x] 5.2 Update the env-var table in `AGENTS.md` to add the `LLM_MAX_COMPLETION_TOKENS` row (default `4096`) and refresh the `LLM_MODEL` row (`deepseek/deepseek-v4-pro`) and the `LLM_REASONING_EFFORT` row (`xhigh`)
- [x] 5.3 Update the `Per-Story LLM Settings` section of `AGENTS.md` to list `maxCompletionTokens` in the whitelist enumeration
- [x] 5.4 Refresh any LLM-defaults references under `docs/` (search for `deepseek-v3.2`, `effort.*high`, `max.*tokens`)

## 6. Backend tests

- [x] 6.1 Add tests in `tests/writer/lib/config_test.ts` (or add the file if it does not exist) covering:
  - default `LLM_MODEL = "deepseek/deepseek-v4-pro"`, default `LLM_REASONING_EFFORT = "xhigh"`, default `LLM_MAX_COMPLETION_TOKENS = 4096`
  - valid override (e.g. `"8192"` → `8192`)
  - invalid overrides — `"abc"`, `"0"`, `"-1"`, `"3.14"`, `"4096abc"`, `"1e3"`, `"01024"` (leading zero), `"   "` (whitespace-only), `String(Number.MAX_SAFE_INTEGER + 1)` — all fall back to `4096`; **whitespace-only and unset SHALL be silent**, all other invalid forms SHALL emit a warn log naming the variable and the offending value
- [x] 6.2 Add tests in `tests/writer/lib/story-config_test.ts` covering: write accepts `{ "maxCompletionTokens": 8192 }`; write rejects fractional (`1024.5`), zero, negative, string, boolean, and unsafe-integer (`9007199254740993`) values with HTTP 400; read returns the persisted integer; null/undefined fall through during merge
- [x] 6.3 Add tests in `tests/writer/routes/story-config_test.ts` covering the PUT/GET round-trip for `maxCompletionTokens`
- [x] 6.4 Add tests in `tests/writer/routes/chat_test.ts` (or its WebSocket equivalent) asserting the upstream request body always carries `max_completion_tokens` matching the merged config (env-only, env+override, override resolves to a different integer than env)
- [x] 6.5 Add a log-shape test asserting `maxCompletionTokens` appears in both the operational debug payload and the LLM-interaction log `parameters` object

## 7. Frontend tests

- [x] 7.1 Add Vitest cases for the LLM settings page (`LlmSettingsPage.vue` and any helper composable) covering: load existing `{ "maxCompletionTokens": 8192 }` populates the form correctly; toggle "use default" ON drops the field from the PUT payload AND does not block Save even if the value control is empty; invalid value with toggle OFF (empty, `"4096abc"`, `"1e3"`, fractional, zero, negative) blocks Save and surfaces a zh-TW validation hint
- [x] 7.2 Add a component test for the new row asserting it renders an `<input type="number">` with `min="1"` and `step="1"`, and that its disabled-Save contribution is gated on the row's "use default" toggle

## 8. Verification

- [x] 8.1 Run `deno task test` and ensure the entire backend + frontend suite passes
- [x] 8.2 Run `deno check` on `writer/server.ts` to confirm strict-mode type checking passes after the `LlmConfig` extension
- [x] 8.3 Run `openspec validate update-llm-defaults-and-completion-tokens --strict` to confirm the change validates cleanly before archiving
- [x] 8.4 Manual smoke: start the dev server, hit `/settings/llm`, set `maxCompletionTokens=2048` for a test story, send a chat message, and verify via the LLM interaction log that the upstream request body carries `max_completion_tokens: 2048`
- [x] 8.5 Provider compatibility smoke: with `LLM_MODEL=deepseek/deepseek-v4-pro` and `LLM_REASONING_EFFORT=xhigh`, send at least one chat turn against the configured `LLM_API_URL` and confirm (a) the upstream accepts `max_completion_tokens` without a 4xx error and (b) `finish_reason` for the turn is observable in the LLM interaction log so operators can detect `"length"`-truncated turns at the default `4096` budget
