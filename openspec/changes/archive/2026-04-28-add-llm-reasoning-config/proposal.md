## Why

Modern reasoning-capable models (OpenAI o-series, Anthropic Claude with extended thinking, DeepSeek-R1, Gemini thinking models, etc.) accept a dedicated `reasoning` request parameter that controls whether the model performs internal chain-of-thought and how much budget it spends doing so. HeartReverie currently has no way to enable, disable, or tune this knob — every chat request omits the `reasoning` block, leaving the provider to apply its own defaults (often "off" or a low effort tier). For an interactive-fiction engine that depends on the LLM holding consistent character voice, plotting many chapters ahead, and respecting elaborate lore, high-effort reasoning measurably improves output quality. We need first-class support for the `reasoning` parameter so authors can opt every story (or a specific story) into deeper deliberation.

## What Changes

- Add two new LLM parameters to the resolved per-request `LlmConfig`:
  - `reasoningEnabled` — boolean, default `true`.
  - `reasoningEffort` — string enum `"none" | "minimal" | "low" | "medium" | "high" | "xhigh"`, default `"high"`.
- Add matching env-var defaults:
  - `LLM_REASONING_ENABLED` (parsed as boolean; default `true`; unrecognized non-empty values emit a warning and fall back to default).
  - `LLM_REASONING_EFFORT` (validated against the enum; default `"high"`; invalid values fall back to default and emit a warning log).
  - `LLM_REASONING_OMIT` (parsed as boolean; default `false`). When `true`, the backend SHALL omit the `reasoning` block from the upstream request body entirely. This is the escape hatch for OpenAI-compatible providers (custom `LLM_API_URL`) that reject unknown fields.
- Extend the per-story `_config.json` whitelist (`writer/lib/story-config.ts`) to accept `reasoningEnabled` and `reasoningEffort`, with the same validation rules and merge semantics as existing fields.
- Extend `GET/PUT /api/:series/:name/config` validation to accept the two new keys.
- Build the upstream chat/completions body with a `reasoning` object in `writer/lib/chat-shared.ts`, **unless** `LLM_REASONING_OMIT` is `true`:
  - When `reasoningEnabled` is `true`: include `reasoning: { enabled: true, effort: <reasoningEffort> }`.
  - When `reasoningEnabled` is `false`: include `reasoning: { enabled: false }` (no `effort`) — the explicit suppression form is required by providers (e.g., Anthropic extended thinking, certain OpenRouter-routed reasoning models) where reasoning is on by model default.
  - The block is OpenRouter's documented schema and is also accepted by OpenAI-compatible providers (OpenAI translates `reasoning.effort` directly; non-reasoning models ignore the field). Providers known to reject unknown fields can set `LLM_REASONING_OMIT=true` to suppress emission entirely.
- Surface upstream provider errors with their response body in the operational log AND in the `ChatError("llm-api", …)` `detail` field returned to the client, so that a strict provider rejecting `reasoning` is diagnosable end-to-end.
- Surface the two new fields in the `/settings/llm` Vue page (`LlmSettingsPage.vue`) with the existing "use default" toggle pattern: a checkbox for `reasoningEnabled` and a `<select>` for `reasoningEffort`. When the user has explicitly overridden `reasoningEnabled` to `false`, the `reasoningEffort` value control is **visually muted** (CSS class) but still editable, so toggling reasoning back on later restores the chosen effort without re-entry.
- Log the resolved reasoning settings in both the operational logger and the LLM interaction log, alongside the existing sampler parameters.
- Update `.env.example`, `AGENTS.md` env-var table, and `docs/` references.

**No backward-compatibility shims, migrations, or feature flags** are required — the project is pre-release with zero external users; old `_config.json` files without the new fields just fall through to defaults via the existing merge logic.

## Capabilities

### New Capabilities

(none — this change extends existing capabilities only)

### Modified Capabilities

- `per-story-llm-config`: extends the per-story override whitelist to include `reasoningEnabled` and `reasoningEffort`; updates merge semantics, REST API validation, and the `/settings/llm` UI to expose them.
- `writer-backend`: adds `LLM_REASONING_ENABLED` / `LLM_REASONING_EFFORT` env vars to `AppConfig` and `llmDefaults`, and adds the `reasoning` object to the upstream chat/completions request body assembled in `executeChat()`.

## Impact

- **Code**:
  - `writer/types.ts` — extend `LlmConfig`, `AppConfig`, add `ReasoningEffort` union type.
  - `writer/lib/config.ts` — parse and export the two new env vars; include them in `llmDefaults`.
  - `writer/lib/story-config.ts` — extend the whitelist, add boolean/enum validation branches.
  - `writer/lib/chat-shared.ts` — assemble the `reasoning` block when building the upstream request body; include the new fields in debug + LLM interaction logs.
  - `writer/routes/story-config.ts` — no code change needed beyond what `validateStoryLlmConfig` returns, but tests must cover the new fields.
  - `reader-src/src/types/index.ts` — extend `StoryLlmConfig` interface.
  - `reader-src/src/composables/useStoryLlmConfig.ts` — no logic change (it already round-trips arbitrary whitelisted fields).
  - `reader-src/src/components/LlmSettingsPage.vue` — add the two field rows with custom controls.
- **Tests**: backend story-config unit tests, chat-shared payload assembly tests, frontend `LlmSettingsPage.test.ts` and `useStoryLlmConfig.test.ts` updates.
- **Docs**: `.env.example`, `AGENTS.md` (env table + per-story config description), `docs/` if any LLM-config doc exists.
- **External APIs**: now sends `reasoning.{enabled,effort}` to OpenRouter / OpenAI-compatible providers; safe for providers that ignore unknown fields.
- **No breaking API changes**: REST and WebSocket contracts gain optional fields only.
