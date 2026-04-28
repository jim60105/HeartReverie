## Context

Today, `writer/lib/chat-shared.ts` builds the upstream `chat/completions` request body from the merged `LlmConfig` (env defaults + per-story `_config.json`). The whitelist in `writer/lib/story-config.ts` is exactly: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`. There is no provision for the `reasoning` parameter.

OpenRouter accepts `reasoning` as an object on the chat/completions request body. The relevant fields are:
- `reasoning.enabled: boolean` — whether to include any reasoning at all.
- `reasoning.effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"` — discrete budget tier (mirrors the OpenAI `reasoning.effort` field with OpenRouter provider extensions). `"none"` and `"xhigh"` are OpenRouter-specific values; `"none"` requests that the provider decide whether to reason, `"xhigh"` requests an extra-high budget on providers that support it. Providers that do not recognise `"none"` or `"xhigh"` may reject the request — operators on such providers should set `LLM_REASONING_OMIT=true` to suppress emission entirely.
- `reasoning.max_tokens: number`, `reasoning.exclude: boolean`, `reasoning.summary` — additional knobs we are intentionally **not** modeling in this change.

OpenAI's native reasoning API also exposes `reasoning.effort` with the same enum (plus `"minimal"` introduced for GPT-5). Non-reasoning OpenAI-compatible providers typically ignore unknown fields, but **strict** OpenAI-compatible servers (some self-hosted vLLM or LiteLLM proxies) MAY reject unknown fields with HTTP 400. Because HeartReverie supports custom `LLM_API_URL`, we provide an opt-out env var (`LLM_REASONING_OMIT=true`) that suppresses the `reasoning` block entirely.

The user explicitly stated: defaults are `reasoningEnabled = true`, `reasoningEffort = "high"`, and no migrations or backwards-compatibility shims are needed.

## Goals / Non-Goals

**Goals:**
- Add `reasoningEnabled` (boolean) and `reasoningEffort` (enum) to `LlmConfig`, env defaults, the per-story `_config.json` whitelist, the REST validation layer, and the `/settings/llm` UI.
- Send a `reasoning` object on every upstream chat/completions request reflecting the merged values.
- Provide a single, internally consistent enum `ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"` shared between backend and frontend.
- Keep the merge contract identical to existing fields: `Object.assign({}, llmDefaults, overrides)` per request.

**Non-Goals:**
- No `reasoning.max_tokens`, `reasoning.exclude`, or `reasoning.summary` support. (Future change can extend.)
- No model-capability detection — we always send `reasoning`; non-reasoning models ignore it.
- No backward-compatibility, migration, or feature-flag gating (project is pre-release with zero users).
- No changes to how the model's reasoning *output* (e.g., `<thinking>` blocks) is rendered — the existing `thinking` plugin already handles that.

## Decisions

### Decision 1: Two scalar fields, not a nested object, in `LlmConfig`

We extend `LlmConfig` with two flat fields (`reasoningEnabled: boolean`, `reasoningEffort: ReasoningEffort`) rather than a nested `reasoning: { enabled, effort }` shape.

**Rationale:**
- The existing `LlmConfig` is a flat record of scalar fields; preserving that shape lets `Object.assign({}, llmDefaults, overrides)` continue to work without special-cased deep-merge logic.
- The whitelist parser in `validateStoryLlmConfig` already iterates over a flat key list — adding two scalar branches is mechanical.
- The frontend "use default" toggle pattern operates per-key; nested merge would force a custom toggle path.
- The flat → nested mapping happens **once**, exactly where every other camelCase → snake_case mapping happens today: when assembling the upstream fetch body.

**Alternative considered:** Storing a nested `reasoning` object in `LlmConfig`. Rejected for the reasons above.

### Decision 2: Enum validated by an exhaustive set, with case-sensitive match

`ReasoningEffort` is the union `"none" | "minimal" | "low" | "medium" | "high" | "xhigh"`. Validation in `validateStoryLlmConfig` and the env-var parser uses an exhaustive `Set<string>` lookup. Unknown strings are rejected by the validator (PUT endpoint returns 400) and downgraded to default by the env-var parser (with a warn log), matching the existing behaviour for non-numeric env values like `LLM_TEMPERATURE=abc`.

**Rationale:** Mirrors the existing "fall back to default on bad env, reject on bad client input" split.

### Decision 3: Always emit a `reasoning` object on the upstream request, with an env opt-out

Even when `reasoningEnabled = false`, we send `reasoning: { enabled: false }` (no `effort`) rather than omitting the block entirely. We additionally provide an env opt-out `LLM_REASONING_OMIT` (default `false`) — when `true`, the backend omits the `reasoning` block entirely.

**Rationale:**
- OpenRouter docs are explicit that `enabled: false` is the way to suppress reasoning on models that default to it on (e.g., `o1`, `claude-3.7-sonnet:thinking`). Omitting the block can leave reasoning **on** by provider default, which is the opposite of the user's intent.
- When `enabled: true`, the body becomes `reasoning: { enabled: true, effort: "<effort>" }` — `effort` is meaningful only when reasoning is on.
- Strict OpenAI-compatible servers (custom `LLM_API_URL` pointing at a self-hosted vLLM, certain LiteLLM proxies) MAY reject unknown fields. The `LLM_REASONING_OMIT` escape hatch lets such deployments suppress emission without losing the rest of the per-story config feature.

To make a `reasoning` rejection diagnosable, the chat error path SHALL include the upstream provider's response body in both the operational log (already done) and the `ChatError`'s `detail` field returned to the client.

**Alternative considered:** Omit the field when `enabled: false`. Rejected because it produces inconsistent behaviour across reasoning-on-by-default providers.

### Decision 4: Boolean env parsing for `LLM_REASONING_ENABLED`

We parse the env var with the rule: `"false" | "0" | "no" | "off"` (case-insensitive, trimmed) → `false`; the empty string → `fallback`; `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`; **any other non-empty string** → `fallback` AND emit a warning to the operational log naming the variable and the unrecognized value. Unset → `fallback`.

**Rationale:** Generic boolean parsing avoids surprises like `LLM_REASONING_ENABLED=False` being interpreted as truthy, AND a typo like `LLM_REASONING_ENABLED=falsey` is loudly visible in the startup log instead of silently keeping high-cost reasoning on.

The same parser is used for `LLM_REASONING_OMIT` with default `false`.

### Decision 5: UI — checkbox + select, with muted (not disabled) effort control

The `/settings/llm` page renders:
- One row for `reasoningEnabled`: the existing "use default" toggle, plus a single checkbox as the value control (instead of a numeric input).
- One row for `reasoningEffort`: the existing "use default" toggle, plus a `<select>` with the six enum options.

When the user has explicitly overridden `reasoningEnabled` to `false` in the form (i.e., its "use default" toggle is OFF and its checkbox is unchecked), the `reasoningEffort` value control SHALL be visually **muted** via a CSS class (reduced opacity, secondary border) but SHALL remain interactive. The user can still toggle "use default" or change the value; saving still persists `reasoningEffort` if its toggle is on, so toggling `reasoningEnabled` back on later restores the chosen effort without re-entry.

**Rationale:**
- We avoid using the HTML `disabled` attribute because the spec wants the user to still be able to change the effort while reasoning is off (anticipating a re-enable).
- We deliberately do **not** introspect env defaults from the backend in this change — doing so would add a new "GET /api/llm/defaults" endpoint and increase scope. The muted state therefore reflects only the **explicit override** state. If env-default-aware UI is desired later, it can be added as a follow-up change without breaking compatibility.

**Alternative considered:** Fetch env defaults from the backend so the muted state reflects the truly resolved value. Deferred to a follow-up change.

### Decision 6: Reuse existing log fields

The debug log in `executeChat()` and the LLM interaction log already enumerate sampler params. We add `reasoningEnabled` and `reasoningEffort` to that list. No new log structure is introduced.

### Decision 7: Single source of truth for the effort enum

To avoid drift between backend and frontend, `REASONING_EFFORTS` (the runtime tuple `["none", "minimal", "low", "medium", "high", "xhigh"]`) and the corresponding `ReasoningEffort` type SHALL be defined exactly once, in `writer/types.ts`, and re-exported / imported from a single shared module on each side. The frontend `LlmSettingsPage.vue` SHALL derive its `<select>` options from this constant rather than hardcoding the array a second time. (Backend and frontend live in different toolchains — Deno vs Vite — so a literal shared import is not always practical; the policy is "import the runtime tuple from the type module on each side, never re-declare the literal".)

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| Strict OpenAI-compatible provider (custom `LLM_API_URL`) rejects the unknown `reasoning` field with HTTP 400. | Provide `LLM_REASONING_OMIT=true` env opt-out that suppresses emission entirely. The chat-error path SHALL include the upstream response body in the `ChatError.detail` returned to the client so the failure is diagnosable. Document both in `.env.example` and `AGENTS.md`. |
| `reasoning.effort = "high"` on a reasoning model can substantially raise latency and token cost. | The default is documented; users can lower it per-story via `_config.json` or the UI. Token usage is already persisted via `appendUsage()`, giving authors visibility. |
| Cross-provider semantics drift (e.g., Anthropic uses `max_tokens`, OpenAI uses `effort`; OpenRouter exposes provider-specific `xhigh`, `none`). | We expose only `effort` with the four canonical values in this change. OpenRouter normalizes `effort` across providers per its own docs; users targeting a specific provider with non-effort-based budgets can extend the schema in a follow-up change. |
| `LLM_REASONING_ENABLED` typo (e.g., `falsey`) silently keeps reasoning on. | Boolean parser warns on unrecognized non-empty values and falls back to default. Same applies to `LLM_REASONING_OMIT`. |
| Frontend muted-state may mislead users when env default is `false`. | Documented as known limitation; follow-up change can add a `GET /api/llm/defaults` endpoint to drive truly resolved UI state. |
| Per-story toggling could surprise authors when a model doesn't support reasoning. | We don't filter by model capability. The provider will silently ignore an unsupported `reasoning` block. Behaviour is unchanged from today. |
| Logged sampler params show *intent*, not whether reasoning was actually applied. | When the upstream response includes `usage.completion_tokens_details.reasoning_tokens` (OpenAI style) or OpenRouter's reasoning evidence, future work can record it in the LLM interaction log. Out of scope for this change. |

## Open Questions

None. The user has confirmed defaults (enabled=true, effort=high) and the no-migration policy.
