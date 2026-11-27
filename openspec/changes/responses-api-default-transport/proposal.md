# Proposal

## Why

The engine only speaks the OpenAI-compatible Chat Completions API (`writer/lib/chat-llm-fetch.ts` builds a `messages` body and POSTs it to `LLM_API_URL`; `writer/lib/chat-stream.ts` parses `choices[0].delta`). OpenRouter, OpenAI, vLLM, Ollama and LM Studio now expose the Responses API (`/responses`). That API carries reasoning as its own stream events (reasoning text or reasoning summary), separate from the output text. We want Responses to be the default transport. Upstreams that do not offer it must keep working through automatic fallback to Chat Completions, and reasoning must still land in the chapter's `<think>` block in both modes.

## What Changes

- New deployment-level env var `LLM_API_MODE` with the values `auto` (default), `responses` and `chat-completions`. It is not per-story and is not exposed by `GET /api/llm-defaults`.
- The Responses and Chat Completions URLs are both derived from the existing `LLM_API_URL`. When its path ends in `/chat/completions`, that suffix is swapped for `/responses`, and the other way round. Any other URL is used verbatim, and `auto` then means Chat Completions only. The default value of `LLM_API_URL` does not change.
- In `auto` mode the engine tries Responses first. If the upstream answers HTTP 404, 405 or 501 before streaming starts, the engine retries the same generation once over Chat Completions. Each successful fallback is cached in process memory, keyed by Responses URL and model, so later requests for that pair go straight to Chat Completions. Forced modes never fall back. Network errors, aborts and every other status never trigger a fallback.
- New Responses request body: `input` (the same messages), `stream: true`, `store: false`, `max_output_tokens`, and the samplers the OpenRouter Responses schema accepts. Reasoning is sent as `reasoning: { effort, summary: "auto" }`, or `{ effort: "none" }` when reasoning is disabled. `LLM_REASONING_OMIT` still drops the field.
- New Responses SSE parsing. `response.output_text.delta` is content. `response.reasoning_text.delta` and `response.reasoning_summary_text.delta` are reasoning, written into the existing `<think>` block. Only the first reasoning kind seen in a stream is used, so the same reasoning is never written twice. Usage comes from `response.completed` / `response.incomplete`, mapped to the existing `TokenUsageRecord`, including `cost`. `error` and `response.failed` events become the existing `llm-stream` 502 path.
- In `auto` mode, `continue-last-chapter` generations always use Chat Completions, because the trailing-assistant prefill is a Chat Completions behaviour.
- Chat Completions reasoning extraction also accepts `delta.reasoning_content` (DeepSeek and vLLM style), between `delta.reasoning` and `reasoning_details`.
- The `pre-llm-fetch` payload gains a `transport` field. Its `requestMetadata` mirrors the first attempt's body minus `messages`/`input`. The hook is still dispatched exactly once, with no re-dispatch on fallback. The `endpoint` field of `post-response` is the URL that actually served the response.
- **BREAKING (pre-release, no migration):** with the default `auto` mode, OpenRouter users are moved to `/responses`. The Responses body omits `repetition_penalty`, `min_p`, `top_a`, `usage` and `stream_options`. Operators who rely on those samplers set `LLM_API_MODE=chat-completions`.

## Capabilities

### New Capabilities
- `llm-api-transport`: choosing between the Responses and Chat Completions APIs (mode configuration, URL derivation, auto fallback and its cache), plus the Responses request body, stream parsing, reasoning, usage and error handling.

### Modified Capabilities
- `writer-backend`: the `LLM API proxy` requirement now names the selected transport instead of a single fixed chat-completions URL, and adds `delta.reasoning_content` to the chat reasoning fields.
- `unified-server`: `Configuration` documents `LLM_API_MODE` and the default-URL behaviour under Responses-first.
- `reasoning-think-block`: the chat extraction priority adds `delta.reasoning_content`, and Responses reasoning events feed the same `<think>` framing.
- `hook-observability`: the `pre-llm-fetch` payload shape adds `transport` and defines `requestMetadata` per transport.
- `env-example`: `.env.example` lists `LLM_API_MODE`.
- `token-usage-tracking`: the usage opt-in (`usage`, `stream_options`) applies to Chat Completions only, and on Responses the upstream cost comes from `response.usage.cost`.
- `plugin-hooks`: the `pre-llm-fetch` stage bullet and scenarios cover one dispatch per generation, the first attempt's body, and `transport`. The `post-response` endpoint scenario names the URL that served the response.
- `per-story-llm-config`: the token-cap scenarios cover both `max_completion_tokens` (Chat Completions) and `max_output_tokens` (Responses).

## Impact

- Code: `writer/lib/config.ts`, `writer/types/app.ts`, `writer/types/llm.ts`, `writer/types/hooks.ts`, `writer/lib/chat-types.ts`, `writer/lib/chat-llm-fetch.ts`, `writer/lib/chat-stream.ts`, `writer/lib/chat-stream-and-persist.ts`, new `writer/lib/llm-transport.ts` and `writer/lib/llm-stream-frames.ts`.
- Tests: new unit and integration tests under `tests/writer/lib/`. Existing chat test config literals that stub `chat/completions` gain `LLM_API_MODE: "chat-completions"`. `tests/writer/lib/config_coverage_test.ts` covers parsing of the new variable.
- Docs: `.env.example`, `AGENTS.md` (env table), `docs/self-host/external-llm.md`, `docs/reference/configuration.md`, `helm/heart-reverie/values.yaml` (commented key).
- Cross-repo, report only: the `HeartReverie_Plugins/prompt-debugger` dev-only replay route re-POSTs `requestMetadata` + `messages` to `config.LLM_API_URL`. After this change that metadata may be Responses-shaped (`store`, `max_output_tokens`, `reasoning.summary`). No plugin edit is required for this change to work. A follow-up in that repo can branch on the new `transport` field. `cost-tracker` keys on the endpoint host, which does not change.
- Human-reviewed: none. Every requirement can be established by automated tests.
