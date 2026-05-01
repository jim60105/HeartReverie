## Why

The DeepSeek V4 Pro reasoning model is now the most capable upstream default for HeartReverie's roleplay/creative-writing workload, and operators consistently want maximum-effort reasoning out of the box. At the same time, the backend has no way to cap the per-turn completion length, so a runaway model can drain the operator's quota in a single chapter and there is no per-story budget knob. This change refreshes the model/reasoning defaults and introduces a dedicated `max_completion_tokens` knob that flows through env defaults, per-story overrides, and the upstream OpenRouter-compatible request body.

The project is pre-release with zero deployed users, so we deliberately do **not** preserve backward compatibility for the old defaults — operators upgrading their checkout will simply pick up the new values on next start.

## What Changes

- **BREAKING** Change the default upstream model from `deepseek/deepseek-v3.2` to `deepseek/deepseek-v4-pro` (env var `LLM_MODEL`, the `llmDefaults.model` field, and every spec/doc referencing the old value).
- **BREAKING** Change the default `LLM_REASONING_EFFORT` from `"high"` to `"xhigh"`. `LLM_REASONING_ENABLED` remains `true` by default (its existing default already satisfies the request to "enable reasoning").
- Add a new env var `LLM_MAX_COMPLETION_TOKENS` (positive integer, default `4096`) parsed by the same `numEnv`-style helper as the other `LLM_*` numeric vars but constrained to positive finite integers; non-positive / non-finite values fall back to the default with a warning log.
- Add a new field `maxCompletionTokens: number` to the `LlmConfig` interface and to the `llmDefaults` object derived from env vars.
- Add `maxCompletionTokens` to the per-story `_config.json` whitelist with the same validation contract as the other numeric fields, plus the additional constraint that the value must be a positive finite integer (i.e. `Number.isInteger(value) && value > 0`).
- Map the merged `maxCompletionTokens` to the upstream OpenAI/OpenRouter-compatible request body field `max_completion_tokens` on every chat request (HTTP and WebSocket paths via the shared `chat-shared.ts` body builder). The field SHALL always be present (no opt-out / omit switch in this iteration).
- Add a new control to the `/settings/llm` Vue page so operators can per-story override `maxCompletionTokens` with a "use default" toggle, mirroring the existing numeric overrides.
- Update `.env.example` and `AGENTS.md` to document the new env var, the new defaults, and the new per-story key.
- Update the `LLM request payload` debug log and the `LLM request` interaction log to include `maxCompletionTokens` alongside the other sampler parameters so the value is observable per turn.

## Capabilities

### New Capabilities

_None._ The change extends three existing capabilities below; introducing a new capability for a single config field would fragment behaviour that already lives in `writer-backend` and `per-story-llm-config`.

### Modified Capabilities

- `writer-backend`: refresh the documented defaults for `LLM_MODEL` and `LLM_REASONING_EFFORT`; introduce `LLM_MAX_COMPLETION_TOKENS` env var with parsing/validation rules; extend `llmDefaults` with `maxCompletionTokens`; require the upstream chat/completions request body to carry `max_completion_tokens`; extend the operational and LLM interaction log fields to include `maxCompletionTokens`.
- `per-story-llm-config`: extend the per-story `_config.json` whitelist with `maxCompletionTokens` (positive integer), extend the merge contract so it falls through to the env default when absent, extend the REST API validation rules, and add a corresponding override control to the Settings UI.
- `env-example`: document the new `LLM_MAX_COMPLETION_TOKENS` variable and refresh the documented default for `LLM_MODEL`.

## Impact

- **Code (backend)**:
  - `writer/types.ts` — extend `LlmConfig`, `StoryLlmConfigOverrides`, and `AppConfig` with the new field/env var.
  - `writer/lib/config.ts` — add `LLM_MAX_COMPLETION_TOKENS` parsing (positive-integer numeric env helper), update default model/reasoning effort, extend `llmDefaults`.
  - `writer/lib/story-config.ts` — extend the whitelist, validator, and resolver to handle `maxCompletionTokens`.
  - `writer/lib/chat-shared.ts` — add `max_completion_tokens` to the upstream request body and to both log entries.
- **Code (frontend)**:
  - `reader-src/src/composables/useStoryLlmConfig.ts` — add `maxCompletionTokens` to the local form schema and the PUT payload builder.
  - `reader-src/src/components/settings/LlmSettingsPage.vue` (or its current path) — add a number-input row with a "use default" toggle for `maxCompletionTokens`.
- **Tests**: extend `tests/writer/lib/config_test.ts`, `tests/writer/lib/story-config_test.ts`, `tests/writer/routes/story-config_test.ts`, `tests/writer/routes/chat_test.ts` (or equivalents) to assert the new env parsing rules, whitelist behaviour, merge semantics, request-body field, and log fields. Extend the frontend Vitest suite covering the LLM settings page.
- **Docs**: `.env.example`, `AGENTS.md` (env var table + per-story config section), and the relevant docs under `docs/` if they enumerate LLM defaults.
- **Operational**: existing deployments will see a model swap and a reasoning-effort bump on next restart; both are intentional. The default `max_completion_tokens=4096` is large enough for typical chapter-length completions and SHALL NOT regress current behaviour for models that already self-cap below this value.
- **Out of scope**: introducing a `LLM_REASONING_OMIT`-style suppress switch for `max_completion_tokens`; per-story switch for the upstream API URL or API key; runtime UI to change `LLM_MODEL` (still env-only — the per-story `model` override predates this change).
