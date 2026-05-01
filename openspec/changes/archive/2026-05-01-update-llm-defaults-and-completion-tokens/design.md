## Context

HeartReverie's LLM configuration today is split between flat `LLM_*` env vars (assembled into `llmDefaults: LlmConfig` in `writer/lib/config.ts`) and per-story overrides under `playground/<series>/<story>/_config.json` (validated and merged in `writer/lib/story-config.ts`). The merged config is consumed once per chat request in `writer/lib/chat-shared.ts`, where it is mapped into the upstream OpenRouter-compatible request body. The same merged config flows into both the operational debug log and the LLM interaction log, and is exposed to the frontend via the `/settings/llm` page (composable `useStoryLlmConfig.ts`).

This change refreshes two existing defaults (model + reasoning effort tier) and threads a new `maxCompletionTokens` knob through every layer that already carries the existing knobs. The path is well-trodden: the codebase has done this before for `reasoningEnabled` / `reasoningEffort` (see commit history of `per-story-llm-config`), so the design here is mostly about staying consistent with that template rather than inventing new structure.

## Goals / Non-Goals

**Goals:**
- Pick up the latest DeepSeek reasoning model and the strongest reasoning tier without operator action, so a fresh checkout produces the intended creative-writing behaviour by default.
- Add a per-turn completion-length cap that operators and authors can tune at the env layer (deployment-wide) and at the per-story layer (creative-control), reusing the existing `_config.json` mechanism.
- Keep the new field's contract identical in shape to existing numeric fields: env parsing → `llmDefaults` → optional override → merged config → snake_case upstream body field → log entries → frontend form control.
- Preserve the documented invariant that `LLM_API_URL` / `LLM_API_KEY` are *not* per-story configurable; only sampling/budget knobs are.

**Non-Goals:**
- Backward compatibility with the old defaults. The project is pre-release with zero deployed users; a hard cutover is acceptable.
- A `LLM_MAX_COMPLETION_TOKENS_OMIT` escape hatch analogous to `LLM_REASONING_OMIT`. `max_completion_tokens` is a long-standing OpenAI-compatible field that strict providers accept; we will not pre-emptively add an opt-out.
- Reading the upstream `usage.completion_tokens` to enforce the cap on our side. The cap is provider-enforced; we only forward the value.
- Streaming-budget UX (e.g., warning when a chapter is approaching the cap). Possible follow-up.
- Per-story override of `LLM_MODEL`'s default beyond the existing `model` override field (which already exists).

## Decisions

### Decision 1: Field name `maxCompletionTokens` (camelCase) ↔ `max_completion_tokens` (snake_case)

We use the modern OpenAI Chat Completions field name `max_completion_tokens` rather than the legacy `max_tokens`. Rationale:
- Forward-compatible: OpenAI deprecated `max_tokens` for chat/completions in favour of `max_completion_tokens`; OpenRouter forwards both but documents the new name.
- Reasoning-aware: for reasoning models, `max_completion_tokens` includes both reasoning tokens and visible content tokens, which is the budget operators actually want to cap. The legacy `max_tokens` is ambiguous on some providers.
- Naming consistency in TypeScript: camelCased to `maxCompletionTokens` matches `frequencyPenalty`, `presencePenalty`, etc.

**Alternative considered:** ship `max_tokens` for broader provider compatibility. **Rejected**: the project is OpenRouter-first by default (see the hard-coded OpenRouter attribution headers); operators pointing at non-conforming providers can fork.

### Decision 2: Validation as a safe positive integer with full-string parsing

The env parser and the `_config.json` validator both require the value to satisfy `Number.isSafeInteger(value) && value > 0`. The env parser SHALL **not** rely on `parseFloat` (which silently accepts trailing garbage like `"4096abc"` and scientific notation like `"1e3"`). Instead, `posIntEnv(key, fallback)` SHALL trim the raw string, require a full-string decimal-integer match against the regular expression `^[1-9]\d*$` (i.e. no leading zeros, no sign, no decimal, no exponent), then parse the matched string with `Number(...)` and validate `Number.isSafeInteger(parsed) && parsed > 0`. Whitespace-only / empty / unset → fallback (no warning, matching `numEnv` behaviour). Anything that fails the regex or the safe-integer check → fallback **with a warning log** naming the variable and the offending value.

The `_config.json` validator SHALL apply the same predicate to JSON values: a value passes only when `typeof value === "number" && Number.isSafeInteger(value) && value > 0`. JSON cannot express trailing-garbage strings, but the safe-integer guard still excludes JSON numbers above `2^53−1` from acceptance.

Rationale:
- Negative or zero values are nonsensical for a token budget.
- Fractional values (e.g. `4096.5`) silently round on most providers and produce confusing telemetry.
- `parseFloat`-based env parsing would let `"4096abc"`, `"1e3"`, and similar partial-numeric strings through; we explicitly reject those.
- This is stricter than the existing `numEnv` helper (which uses `parseFloat`), so we introduce a dedicated `posIntEnv(key, fallback)` helper rather than overloading `numEnv`. Existing fields keep their current parser unchanged.

**Provider-side bounds (out of scope for local validation):** providers may enforce their own minimum (e.g. OpenRouter has historically required ≥16 on some models) and maximum (model context window). HeartReverie SHALL NOT replicate provider-specific bounds locally; upstream rejection is surfaced through the existing RFC 9457 path that already includes the upstream response body in the `detail` field.

**Alternative considered:** allow `0` as a sentinel meaning "no cap". **Rejected**: providers reject `0`, and the simpler rule "either set a positive integer or fall back to the default" matches existing behaviour for the other numeric env vars. Operators who want a very high effective cap can set the env var to a large number (subject to the provider-side cap).

### Decision 3: `max_completion_tokens` is always present in the upstream body

Unlike the `reasoning` block (which has the `LLM_REASONING_OMIT` escape hatch), `max_completion_tokens` SHALL appear in every upstream chat request, populated from the merged `maxCompletionTokens`. Rationale:
- The default `4096` is large enough not to truncate typical chapters but small enough to bound a runaway response.
- A missing `max_completion_tokens` lets the upstream provider apply its own (often unbounded) default, which is exactly the failure mode this change exists to prevent.
- We keep the field unconditionally to make telemetry comparisons across turns/stories meaningful.

**Compatibility note:** OpenRouter's general request schema accepts `max_completion_tokens`; DeepSeek's native API and some strict OpenAI-compatible providers (legacy vLLM, certain self-hosted backends) accept only the legacy `max_tokens`. HeartReverie is OpenRouter-first by default (see the hard-coded OpenRouter attribution headers), so we ship the modern field. Operators pointing `LLM_API_URL` at a strict provider that rejects `max_completion_tokens` SHALL receive a clear upstream error surfaced through the existing RFC 9457 path; the project may add a `LLM_MAX_TOKENS_FIELD=max_completion_tokens|max_tokens` switch in a follow-up change if real users hit this.

**Alternative considered:** add `LLM_MAX_COMPLETION_TOKENS_OMIT` for parity with `LLM_REASONING_OMIT`. **Rejected** as YAGNI; if a strict provider rejects the field in the future, an env-level escape hatch can be added without breaking the per-story contract.

**Alternative considered:** ship `max_tokens` instead of `max_completion_tokens`. **Rejected**: for reasoning-enabled models the legacy field is ambiguous (some providers count only visible content, others count reasoning + content). The modern field's semantics — total reasoning + content — match the operator's mental model of "per-turn budget" exactly, which is the primary reason we are introducing this knob.

### Decision 4: Reuse the existing `Object.assign({}, llmDefaults, storyOverrides)` merge

The new field uses the existing per-request merge in `resolveStoryLlmConfig()` with no structural change. Story-level `null` / `undefined` continue to fall through to env defaults via the same path; this is already covered by an existing scenario in `per-story-llm-config` and we will add a directly analogous scenario for `maxCompletionTokens`.

### Decision 5: Frontend control

The `/settings/llm` page renders a single `<input type="number" min="1" step="1">` row with a "use default" toggle for `maxCompletionTokens`, identical in mechanics to the other numeric controls. The composable's PUT payload builder includes `maxCompletionTokens` only when its "use default" toggle is OFF. We deliberately do **not** introduce a server-side "fetch the current default" endpoint — the form continues to render the literal placeholder "default" rather than the resolved env value, matching existing UX.

### Decision 6: Documentation surface

We update three documentation surfaces in lock-step with code: `.env.example`, the env-var table in `AGENTS.md`, and the `Per-Story LLM Settings` section of `AGENTS.md`. The existing `env-example` capability already requires the `.env.example` to enumerate every recognised variable; that requirement's listing must be extended.

## Risks / Trade-offs

- **Risk:** A `4096`-token cap might truncate unusually long chapters that previously ran without a cap. **Mitigation:** the default is operator-tunable at env level and per-story level; release notes call out the new cap; downstream chapter editing already supports manual continuation. Operators wanting the previous unbounded behaviour can set `LLM_MAX_COMPLETION_TOKENS` to a very large value (e.g. `131072`).

- **Risk:** Combined with `xhigh` reasoning effort, `4096` is sometimes too low for reasoning-heavy turns because `max_completion_tokens` includes both reasoning *and* visible content tokens; a turn may exhaust the budget mid-reasoning and leave the chapter visibly empty. **Mitigation:** include a verification task that exercises the default against `deepseek/deepseek-v4-pro` with `xhigh` reasoning to confirm the budget is adequate for typical chapter-length completions; operators can raise the per-story budget through `_config.json` without touching the env. We deliberately retain `4096` as the default per the user's explicit request and treat truncation as observable (the upstream `finish_reason: "length"` is logged in the LLM interaction log even today).

- **Risk:** Custom `LLM_API_URL` deployments pointing at strict OpenAI-compatible providers (legacy vLLM, DeepSeek native API, etc.) may reject `max_completion_tokens` because they only accept the legacy `max_tokens`. **Mitigation:** see Decision 3 — we document the limitation, surface the rejection through the existing upstream-body-in-detail path, and accept a follow-up change adding `LLM_MAX_TOKENS_FIELD` if users hit this. Pre-release status keeps this acceptable.

- **Risk:** Switching the default model to `deepseek/deepseek-v4-pro` while OpenRouter has not yet provisioned that exact model id results in 404s for fresh checkouts. **Mitigation:** `LLM_MODEL` is env-overridable; the docs call out the change; operators who pre-installed `v3.2` can pin it via env. A startup probe is *not* added — a 404 on the first chat request is loud enough.

- **Risk:** A strict OpenAI-compatible provider rejects `max_completion_tokens` (e.g. an old vLLM build that only accepts `max_tokens`). **Mitigation:** since the project is pre-release we accept this; if it materialises, a follow-up change can introduce `LLM_MAX_COMPLETION_TOKENS_OMIT` or a legacy-field-name switch. The mid-stream-error path already surfaces upstream rejections via RFC 9457 with the upstream body included, so the failure is diagnosable.

- **Trade-off:** The `posIntEnv` helper is a third numeric parser alongside `numEnv` and the existing boolean/effort parsers. We accept the small duplication to keep `numEnv` semantics unchanged for the existing fields, rather than retrofitting integer validation onto every numeric env var in this change.

- **Trade-off:** `xhigh` reasoning effort costs more tokens upstream than `high`. Combined with `max_completion_tokens=4096`, reasoning-heavy turns may now hit the cap before producing visible content. This is a deliberate observability win — the cap makes the failure mode visible rather than letting it run unbounded.

## Migration Plan

There is no user-facing migration. On upgrade:

1. Operators who relied on the implicit `deepseek/deepseek-v3.2` default and want to keep it SHALL set `LLM_MODEL=deepseek/deepseek-v3.2` in their environment. The release notes call this out.
2. Operators who relied on the implicit `LLM_REASONING_EFFORT=high` default and want to keep it SHALL set `LLM_REASONING_EFFORT=high` in their environment. Release notes call this out.
3. Existing per-story `_config.json` files continue to validate; the new whitelist key is additive. No file format changes.
4. No DB migrations, no on-disk format changes, no API URL changes.

Rollback is a `git revert` of the change commit; no data is rewritten on first run.

## Open Questions

- *None.* The instruction explicitly authorises decisions over questions; the items above were resolved during proposal review.
