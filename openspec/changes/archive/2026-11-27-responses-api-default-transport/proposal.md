# Proposal

## Why

The engine only speaks the OpenAI-compatible Chat Completions API. `writer/lib/chat-llm-fetch.ts` POSTs a `messages` body to the full endpoint URL in `LLM_API_URL`, and `writer/lib/chat-stream.ts` parses `choices[0].delta`. OpenRouter, OpenAI, vLLM, Ollama and LM Studio now expose the Responses API (`/responses`), which carries reasoning as its own stream events (reasoning text or reasoning summary), separate from the output text.

We want Responses as the default transport, with automatic fallback to Chat Completions for upstreams that lack it. Reasoning must still reach the chapter's `<think>` block on both transports. A single full-endpoint URL cannot name two endpoints cleanly. So configuration moves to the conventional OpenAI-SDK base URL, and the engine appends the path for each transport.

## What Changes

- **BREAKING:** `LLM_API_URL`, the full chat-completions endpoint, is removed and replaced by `LLM_API_BASE_URL`, an OpenAI-SDK-style base URL that defaults to `https://openrouter.ai/api/v1`. The engine builds `<base>/responses` and `<base>/chat/completions` from it, ignoring trailing slashes.
  - Startup fails with an explicit error when `LLM_API_URL` is still set, even to a valid value. The value is never read or converted.
  - Startup also fails when `LLM_API_BASE_URL` is not an absolute http(s) URL, has a query string or fragment, or ends with `/responses` or `/chat/completions`.
  - The engine never guesses or strips suffixes.
- New deployment-level env var `LLM_API_MODE`, with the values `auto` (default), `responses` and `chat-completions`. It is not per-story and is not exposed by `GET /api/llm-defaults`.
- Fallback in `auto` mode:
  - The engine tries Responses first. If it answers HTTP 404, 405 or 501 before streaming starts, the same generation is retried once over Chat Completions.
  - A successful fallback is cached in process memory per (Responses URL, model).
  - `continue-last-chapter` always uses Chat Completions in `auto` mode, because its trailing-assistant prefill is a Chat Completions behaviour.
  - Forced modes never fall back. Network errors, aborts and every other status never trigger a fallback either.
- New Responses request body. It contains `input` (the same messages), `stream: true`, `store: false`, `max_output_tokens`, and the samplers the OpenRouter Responses schema accepts. Reasoning is sent as `reasoning: { effort, summary: "auto" }`, or as `{ effort: "none" }` when reasoning is disabled. `LLM_REASONING_OMIT` still drops the field.
- New Responses SSE parsing:
  - `response.output_text.delta` is content.
  - `response.reasoning_text.delta` and `response.reasoning_summary_text.delta` are reasoning and go into the existing `<think>` block. Only the first reasoning kind seen in a stream is used, so reasoning is never duplicated.
  - Usage comes from `response.completed` / `response.incomplete` and is mapped to `TokenUsageRecord`, including `cost`.
  - `error` and `response.failed` events take the existing `llm-stream` 502 path.
- Chat Completions reasoning extraction also accepts `delta.reasoning_content` (DeepSeek and vLLM style).
- Hooks:
  - The `pre-llm-fetch` payload gains `transport`, and its `requestMetadata` mirrors the first attempt's body minus `messages`/`input`. The hook is still dispatched exactly once per generation.
  - The `endpoint` field of `post-response` is the full URL that served the response.
- **BREAKING:** the Responses body omits `repetition_penalty`, `min_p`, `top_a`, `usage` and `stream_options`. Operators who rely on those samplers set `LLM_API_MODE=chat-completions`.

### Migration notes (no migration code, pre-release)

- `.env` and Helm values: replace `LLM_API_URL=https://host/v1/chat/completions` with `LLM_API_BASE_URL=https://host/v1`. Leaving the old variable set is a startup error that names the replacement.
- `.env.example`, `AGENTS.md`, `README.md`, `docs/self-host/external-llm.md`, `docs/reference/configuration.md`, `docs/plugin-dev/hooks.md`, `helm/heart-reverie/values.yaml` and `helm/heart-reverie/README.md` are all updated in this change.
- Per-story `_config.json` is unaffected. The URL was never per-story configurable, and `STORY_LLM_CONFIG_KEYS` does not change.
- Plugins in this repo: no plugin under `plugins/` reads `config.LLM_API_URL`.
- Cross-repo, report only, not edited here:
  - `HeartReverie_Plugins/prompt-debugger/routes.ts:326` reads `deps.config?.LLM_API_URL` for its dev-only replay. That value becomes `undefined`, so replay returns its existing `no-upstream-configured` 500. A follow-up in that repo should read `config.LLM_API_BASE_URL` and choose the path from the recorded `transport`.
  - `cost-tracker` keys on the host of the `post-response` `endpoint`. The host does not change, so it is unaffected.

## Capabilities

### New Capabilities
- `llm-api-transport`: base-URL configuration and rejection of the removed variable, transport mode, the attempt plan with auto fallback and its cache, shared headers, the Responses request body and reasoning parameter, and parsing of Responses streams (content, reasoning, usage, errors).

### Modified Capabilities
- `writer-backend`: `LLM API proxy` targets the selected transport under `LLM_API_BASE_URL` and adds `delta.reasoning_content`. `LLM defaults exposure endpoint` excludes `LLM_API_BASE_URL` and `LLM_API_MODE`.
- `unified-server`: `Configuration` documents `LLM_API_BASE_URL`, `LLM_API_MODE` and the removed `LLM_API_URL`.
- `env-example`: `.env.example` lists `LLM_API_BASE_URL` and `LLM_API_MODE` and no longer documents `LLM_API_URL`.
- `reasoning-think-block`: the chat extraction priority adds `delta.reasoning_content`, and Responses reasoning uses the same `<think>` framing.
- `hook-observability`: the `pre-llm-fetch` dispatch site, payload shape (`transport`, per-transport `requestMetadata`) and observe-only wording drop `config.LLM_API_URL`.
- `plugin-hooks`: the `pre-llm-fetch` stage bullet and scenarios, and the `post-response` endpoint definition.
- `token-usage-tracking`: the usage opt-in applies to Chat Completions only, and on Responses the cost comes from `response.usage.cost`.
- `per-story-llm-config`: the token-cap scenarios cover `max_completion_tokens` and `max_output_tokens`.
- `streaming-cancellation`: the abort signal is forwarded to every transport attempt.
- `openrouter-app-attribution`: headers are sent regardless of `LLM_API_BASE_URL` and of the transport.
- `continue-last-chapter`: wording now refers to `LLM_API_BASE_URL` (the prefill limitation note).

## Impact

- Code:
  - `writer/lib/config.ts`, `writer/server.ts`, `writer/types/app.ts`, `writer/types/llm.ts`, `writer/types/hooks.ts`
  - `writer/lib/chat-types.ts`, `writer/lib/chat-llm-fetch.ts`, `writer/lib/chat-stream.ts`, `writer/lib/chat-stream-and-persist.ts`
  - `writer/routes/llm-defaults.ts` (comment only)
  - new `writer/lib/llm-transport.ts` and `writer/lib/llm-stream-frames.ts`
- Tests:
  - new unit and integration tests under `tests/writer/lib/`
  - every test `AppConfig` literal: `LLM_API_URL: "<x>/chat/completions"` becomes `LLM_API_BASE_URL: "<x>"` plus `LLM_API_MODE: "chat-completions"`
  - `config_coverage_test.ts` covers the new variables and the startup errors
- Docs: listed in the migration notes above.
- Human-reviewed: none. Every requirement can be established by automated tests.
