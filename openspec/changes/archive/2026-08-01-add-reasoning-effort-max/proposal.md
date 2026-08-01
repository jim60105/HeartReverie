## Why

OpenRouter and OpenAI-compatible reasoning models are shipping a fourth, above-`xhigh` effort tier (e.g. `o3`-class "extended-thinking" modes exposed via `reasoning: { effort: "max" }`). HeartReverie's `ReasoningEffort` enum currently stops at `xhigh`, so authors cannot select the highest reasoning budget even when their provider supports it — the value is rejected at every boundary (env parsing, `_config.json` validation, and the frontend `<select>`).

## What Changes

- Add `"max"` as a new literal in the shared `REASONING_EFFORTS` tuple, placed **after** `xhigh`, in both the backend source of truth (`writer/types/llm.ts`) and the frontend mirror (`reader-src/src/types/index.ts`). The existing parity test locks the two tuples together and automatically passes through.
- The derived `ReasoningEffort` type then includes `"max"` everywhere the type is used (env default parsing, per-story config validation, `GET /api/llm-defaults` payload, upstream request-body mapping in `chat-llm-fetch.ts`, and the frontend settings form) with **no** additional per-site code edits because every site already derives from the shared tuple or the shared type.
- Update the single hard-coded human-readable validation message in `writer/lib/story-config.ts` to include `max` (deriving it from the tuple so the message cannot drift again).
- Update documentation and example surfaces that enumerate the accepted values: `AGENTS.md`, `docs/reference/configuration.md`, `.env.example`, `helm/heart-reverie/values.yaml`, and the `CHANGELOG.md` entry for the reasoning feature.
- Update backend tests that iterate the enum (`tests/writer/lib/config_test.ts`, `tests/writer/lib/config_coverage_test.ts`, `tests/writer/lib/story-config_test.ts`) and frontend tests/comments that assume exactly six options to cover the seven-value enum.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `per-story-llm-config`: `reasoningEffort` SHALL also accept the literal `"max"`; the frontend settings panel `<select>` SHALL derive its options from the shared `REASONING_EFFORTS` tuple (which now includes `"max"`).
- `writer-backend`: the `LLM_REASONING_EFFORT` env var SHALL be validated against the exact set `{"none", "minimal", "low", "medium", "high", "xhigh", "max"}`.
- `env-example`: the `.env.example` entry SHALL list `max` among the accepted values.

## Impact

- **Backend types**: `writer/types/llm.ts` (`REASONING_EFFORTS` tuple + derived `ReasoningEffort`).
- **Backend validation**: `writer/lib/story-config.ts` (validation error message string).
- **Backend env parsing**: `writer/lib/config.ts` (`effortEnv` — no code change, validates against the tuple automatically).
- **Upstream mapping**: `writer/lib/chat-llm-fetch.ts` — no code change; `reasoningEffort` flows through the typed `LlmConfig` verbatim.
- **Frontend**: `reader-src/src/types/index.ts` (mirror tuple); `LlmSettingsPage.vue` / `useStoryLlmConfig.ts` — no code change, options derive from the tuple.
- **Docs & config**: `AGENTS.md`, `docs/reference/configuration.md`, `.env.example`, `helm/heart-reverie/values.yaml`, `CHANGELOG.md`.
- **Tests**: `tests/writer/lib/config_test.ts`, `tests/writer/lib/config_coverage_test.ts`, `tests/writer/lib/story-config_test.ts`, `reader-src/src/components/__tests__/LlmSettingsPage.test.ts` (comment), and the existing `REASONING_EFFORTS` parity test (passes through unchanged).
- **No breaking changes**: adding a new enum member is purely additive; existing values, defaults (`xhigh`), and wire behaviour are untouched.
