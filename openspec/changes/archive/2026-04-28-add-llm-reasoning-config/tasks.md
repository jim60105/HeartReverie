## 1. Backend types and config

- [x] 1.1 Add `ReasoningEffort` type alias (`"none" | "minimal" | "low" | "medium" | "high" | "xhigh"`) and a runtime `REASONING_EFFORTS` const tuple in `writer/types.ts`; export both. This is the single source of truth for the enum — the frontend imports the same module.
- [x] 1.2 Extend the `LlmConfig` interface in `writer/types.ts` with `readonly reasoningEnabled: boolean` and `readonly reasoningEffort: ReasoningEffort`.
- [x] 1.3 Update `StoryLlmConfigOverrides` documentation comment to mention the two new optional fields (the `Partial<LlmConfig>` shape automatically picks them up).
- [x] 1.4 Extend `AppConfig` in `writer/types.ts` with `readonly LLM_REASONING_ENABLED: boolean`, `readonly LLM_REASONING_EFFORT: ReasoningEffort`, and `readonly LLM_REASONING_OMIT: boolean`.

## 2. Backend env-var parsing

- [x] 2.1 Add a `boolEnv(key, fallback, log)` helper to `writer/lib/config.ts` implementing the rule: `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`; `"false" | "0" | "no" | "off"` → `false`; empty string or unset → `fallback`; any other non-empty value → `fallback` AND emit a `warn`-level log naming the variable and the unrecognized value. (Existing `numEnv` quietly falls back; the new helper warns explicitly for the boolean case.)
- [x] 2.2 Add an `effortEnv(key, fallback)` helper to `writer/lib/config.ts` that validates against `REASONING_EFFORTS`; on invalid value, emit a `warn`-level log via the existing logger and return `fallback`.
- [x] 2.3 Parse `LLM_REASONING_ENABLED` (default `true`), `LLM_REASONING_EFFORT` (default `"high"`), and `LLM_REASONING_OMIT` (default `false`); export the three constants.
- [x] 2.4 Add `reasoningEnabled` and `reasoningEffort` fields to the `llmDefaults` object literal. (`LLM_REASONING_OMIT` is **not** part of `llmDefaults` — it's a top-level deployment switch only.)

## 3. Backend per-story config validator

- [x] 3.1 In `writer/lib/story-config.ts`, extend `validateStoryLlmConfig` to handle `reasoningEnabled`: drop `null` / `undefined` per the existing nullish-drop rule; reject any non-boolean type by throwing `StoryConfigValidationError("Field 'reasoningEnabled' must be a boolean")`.
- [x] 3.2 Extend `validateStoryLlmConfig` to handle `reasoningEffort`: drop `null` / `undefined` per the existing nullish-drop rule; on any non-string or unknown string value, throw `StoryConfigValidationError("Field 'reasoningEffort' must be one of: none, minimal, low, medium, high, xhigh")`. Validate strictly against `REASONING_EFFORTS` with case-sensitive comparison.
- [x] 3.3 Confirm `Object.assign({}, defaults, overrides)` in `resolveStoryLlmConfig` correctly merges the new fields (no code change expected; covered by tests).

## 4. Backend chat request body and error surfacing

- [x] 4.1 In `writer/lib/chat-shared.ts`, gate emission on `config.LLM_REASONING_OMIT`: when `true`, omit the `reasoning` key from the upstream body entirely.
- [x] 4.2 Otherwise, build the `reasoning` block from the merged `llmConfig`: `enabled === true` → `{ enabled: true, effort: <effort> }`; `enabled === false` → `{ enabled: false }`. Add the field to the `body` JSON of the upstream `fetch()` call.
- [x] 4.3 Include `reasoningEnabled`, `reasoningEffort`, and the resolved `omit` flag in both the operational `reqLog.debug` payload and the `llmLog.info` request log under `parameters` (the `omit` flag goes alongside, not inside `parameters`, since it's deployment-level).
- [x] 4.4 When the upstream provider returns a non-2xx, include the (truncated, e.g., 2000 chars) upstream response body in the `ChatError("llm-api", …)` `detail` field so it propagates into the RFC 9457 Problem Details response, in addition to the existing operational log entry. Truncation MUST be applied only to the surfaced field; the log already captures the full body.

## 5. Backend tests

- [x] 5.1 Update `tests/writer/lib/story-config_test.ts` (or add cases) covering: drop nullish for both new fields; accept-valid-boolean for `reasoningEnabled`; reject string/number/object for `reasoningEnabled`; accept each of the six effort values (`"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`); reject unknown effort, mixed-case `"HIGH"`, and non-string types; strip-unknown-keys still strips foreign keys when reasoning fields are present; partial overrides round-trip.
- [x] 5.2 Add tests in `tests/writer/lib/` (or `tests/writer/routes/chat_test.ts`) that capture the upstream fetch body (via a `fetch` stub) and assert: defaults yield `reasoning: { enabled: true, effort: "high" }`; env-disabled yields `{ enabled: false }` with no `effort`; per-story-override-effort overrides env default; `LLM_REASONING_OMIT=true` yields no `reasoning` key at all; per-story `reasoningEnabled: true` flips an env default of `false`; per-story `reasoningEnabled: false` flips an env default of `true`.
- [x] 5.3 Add tests in `tests/writer/routes/story-config_test.ts` (or equivalent) for `PUT /api/:series/:name/config` accepting the two new fields, rejecting invalid types/values with HTTP 400 Problem Details, and round-tripping booleans through GET.
- [x] 5.4 Add a `config.ts` env-parsing test that exercises `boolEnv` (each falsey/truthy token, mixed case, empty string, unset → default; an unrecognized value falls back AND emits a warn log captured via a logger spy) and `effortEnv` (each of the six valid values, an invalid value falling back to default and emitting a warn log).
- [x] 5.5 Add a chat error-path test: a stubbed upstream returns 400 with body `{"error":"unknown field: reasoning"}`; assert the client-facing response's `detail` contains that body and the response status is 400 (or whatever the upstream returned, mapped through the existing `ChatError`).

## 6. Frontend types and composable

- [x] 6.1 Extend the `StoryLlmConfig` interface in `reader-src/src/types/index.ts` with optional `reasoningEnabled?: boolean` and `reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"`. Re-export `REASONING_EFFORTS` from a frontend-side module that mirrors the backend tuple (the two toolchains can't import directly across the Deno/Vite boundary; instead, define the literal once on each side AND add a vitest assertion that the two tuples are deep-equal — see task 8.3).
- [x] 6.2 Confirm `useStoryLlmConfig.ts` round-trips the two new fields without code changes (the composable serializes the entire object). Adjust only if tests expose a regression.

## 7. Frontend settings UI

- [x] 7.1 In `reader-src/src/components/LlmSettingsPage.vue`, extend the `FieldDef` type union to include `"boolean"` and `"enum"` variants (with an `options: readonly string[]` for `enum`).
- [x] 7.2 Append two entries to the `FIELDS` array: `reasoningEnabled` (type `"boolean"`, e.g. label `推理啟用 (reasoning_enabled)`) and `reasoningEffort` (type `"enum"`, options derived from the imported `REASONING_EFFORTS` constant — DO NOT redeclare the literal array — label e.g. `推理強度 (reasoning_effort)`).
- [x] 7.3 Extend `enabledMap` and `valueMap` with the two new keys. For `valueMap.reasoningEnabled`, use a real `boolean` rather than a stringified one (introduce a parallel `booleanMap` if mixing types in `valueMap` is awkward; whichever shape you pick, keep it locally consistent and covered by tests).
- [x] 7.4 Update `syncFromOverrides` to handle the two new fields: `reasoningEnabled` stored as a `boolean`; `reasoningEffort` stored as the string itself (validated against `REASONING_EFFORTS`).
- [x] 7.5 Update `collectPayload` to serialize the new fields:
  - For `boolean`: emit a real `boolean` in the payload.
  - For `enum`: validate against the option set (defensive — UI already restricts to the options); emit a notification if an invalid value somehow appears.
- [x] 7.6 Update the template to render a checkbox value control when `f.type === "boolean"` and a `<select>` populated from `f.options` when `f.type === "enum"`. Reuse the existing `.field-row` grid.
- [x] 7.7 Add a computed `reasoningEffortMuted` boolean that is `true` only when **both** `enabledMap.reasoningEnabled === true` AND the effective override value of `reasoningEnabled` is `false` (i.e., the user has explicitly turned reasoning off in the form). Bind it to a `:class="{ muted: reasoningEffortMuted }"` on the `<select>` (CSS class only — DO NOT bind the HTML `disabled` attribute). Add a `.muted` selector in the `<style scoped>` block: `opacity: 0.5; border-color: var(--muted-color, #888);`.

## 8. Frontend tests

- [x] 8.1 Update `reader-src/src/components/__tests__/LlmSettingsPage.test.ts` to cover: rendering of the two new rows including the dedicated checkbox/select controls; saving `{ reasoningEnabled: false, reasoningEffort: "low" }` produces the correct PUT payload (real boolean, not string); toggling "use default" ON for both removes them from the payload; the `reasoningEffort` `<select>` receives the `muted` CSS class when `reasoningEnabled` is overridden to `false` AND remains interactive (no HTML `disabled` attribute); the `<select>` is unmuted when `reasoningEnabled`'s "use default" is ON or when the checkbox is checked.
- [x] 8.2 Update `reader-src/src/composables/__tests__/useStoryLlmConfig.test.ts` to assert round-trip of the two new fields (real boolean preserved, enum value preserved) through `loadConfig` and `saveConfig`.
- [x] 8.3 Add a small parity test that asserts the frontend `REASONING_EFFORTS` tuple deep-equals the backend tuple (both files imported into the test, comparing JSON-serialized values), to catch drift.

## 9. Documentation

- [x] 9.1 Add `LLM_REASONING_ENABLED`, `LLM_REASONING_EFFORT`, and `LLM_REASONING_OMIT` rows to the env-variables table in `AGENTS.md`.
- [x] 9.2 Add commented-out `LLM_REASONING_ENABLED=true`, `LLM_REASONING_EFFORT=high`, and `LLM_REASONING_OMIT=false` entries to `.env.example` in a new `## LLM Reasoning` block immediately after the sampling-parameters block. Document `LLM_REASONING_OMIT` as the escape hatch for strict OpenAI-compatible providers that reject unknown fields.
- [x] 9.3 Update the per-story `_config.json` description in `AGENTS.md` (under the "Per-Story LLM Settings" section) to list `reasoningEnabled` and `reasoningEffort` in the whitelist and mention the defaults. Note that `LLM_REASONING_OMIT` is deployment-only and NOT exposed in `_config.json`.
- [x] 9.4 If `docs/` contains an LLM-config or settings document, update it to describe the new fields, the defaults, the omit escape hatch, and the cross-provider semantics caveat.

## 10. Verification

- [x] 10.1 Run `deno task test:backend` and confirm all backend tests pass.
- [x] 10.2 Run `deno task test:frontend` and confirm all frontend tests pass.
- [x] 10.3 Run `deno check` over `writer/server.ts` and `reader-src/src/main.ts` to confirm there are no type errors.
- [ ] 10.4 Manually verify with a real OpenRouter request (where possible) that `reasoning: { enabled: true, effort: "high" }` is sent for a default story, `{ enabled: false }` is sent when a story overrides `reasoningEnabled` to `false`, and that the entire `reasoning` key is absent when `LLM_REASONING_OMIT=true`.
- [x] 10.5 Run `openspec validate add-llm-reasoning-config --strict` and confirm the change validates clean.

