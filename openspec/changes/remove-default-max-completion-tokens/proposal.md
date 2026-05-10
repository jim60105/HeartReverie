# Remove the hard-coded `max_completion_tokens` default; let "unset" mean "no limit"

## Why

Today the writer backend hard-codes `LLM_MAX_COMPLETION_TOKENS=4096` and
guarantees the resulting `max_completion_tokens` integer appears in **every**
upstream chat-completion request body, with no opt-out switch. That single
choice causes three concrete problems:

1. **Silent truncation.** `4096` is much smaller than the natural turn length
   that modern reasoning-capable models produce (we routinely see ~5-8k
   characters of reasoning + content in this project's smoke tests). Chapters
   come back chopped mid-sentence with no warning to the writer, who has to
   guess that the cause is a budget issue rather than a prompt regression.
2. **Provider/model mismatch.** Upstream OpenAI-compatible providers each
   ship their own optimal default (often the model's full context minus
   prompt). By always sending `4096` we override that smarter default with a
   conservative one chosen blind.
3. **No way to opt out.** A writer who knows their provider/model has a
   sensible default cannot tell the backend "stop sending this field"; the
   spec literally states `(no opt-out switch)`. Setting an absurdly large
   integer like `999999999` is the only workaround and risks tripping a
   provider's per-field validation.

Empty / unset is the natural way to express "no application-level limit —
let the provider decide". The change makes that the new default.

## What Changes

This change makes `max_completion_tokens` a **fully optional** parameter,
controlled end-to-end by the user, with the default being "absent":

- **Default of `LLM_MAX_COMPLETION_TOKENS` becomes empty / unset.** The
  `posIntEnv("LLM_MAX_COMPLETION_TOKENS", 4096)` call in `writer/lib/config.ts`
  is replaced with a parser whose default is `null`. Empty / whitespace-only
  / unset → `null`. A non-empty value still goes through the existing
  positive-safe-integer regex+predicate and falls back to `null` (with a
  warning log) on validation failure — i.e. an *invalid* env value behaves
  the same as an *unset* env value: no limit applied, plus a startup warning
  surfacing the bad value.
- **`llmDefaults.maxCompletionTokens` type becomes `number | null`.** When
  `null`, the merged `LlmConfig` carries `maxCompletionTokens: null`.
- **Per-story `_config.json` accepts `null` for `maxCompletionTokens`.**
  Today it requires a positive integer; with this change `null` is also
  valid and explicitly means "no limit, override any non-null env default".
  Positive-integer validation rules are unchanged for non-null values.
- **Upstream request body skips the key when null.** The hard rule
  "`max_completion_tokens` SHALL appear in every upstream request body" is
  replaced with: when the merged `maxCompletionTokens` is a positive integer,
  send it as `max_completion_tokens: <int>`; when it is `null`, **omit the
  key entirely** so the provider applies its own default.
- **Logs reflect the new tri-state.** Both the operational log and the LLM
  interaction log now record either the resolved integer or the literal
  `null` for `maxCompletionTokens`, so the on-disk record still answers
  "what budget did this turn run with?" unambiguously.
- **Settings UI accepts an empty value.** The `LlmSettingsPage.vue` form
  treats an empty `maxCompletionTokens` field as "send `null`" (which the
  PUT endpoint persists as `{ "maxCompletionTokens": null }`) rather than
  the current "must be a positive integer" hard error. Non-empty values
  retain the existing positive-safe-integer validation.
- **Documentation updated.** `.env.example` shows the new default state
  (commented-out, no `=4096`); the `env-example` spec scenario is rewritten
  accordingly. `README.md` (top-level configuration table) describes the
  new behaviour: "leave empty → no application-level limit, the upstream
  provider decides".

No backward-compatibility fallback: 0 users in the wild. Stories whose
`_config.json` currently contains `{ "maxCompletionTokens": 4096 }` keep
working unchanged because positive integers remain valid; only the env
default flips.

## Impact

- **Affected specs**:
  - `writer-backend` — one Requirement modified (`LLM API proxy`): env
    default semantics, request-body-composition rule, and log-fields rule
    all updated; the four `max_completion_tokens`-related scenarios are
    rewritten and one new scenario (`max_completion_tokens omitted when
    merged value is null`) is added.
  - `per-story-llm-config` — two Requirements modified
    (`Overridable LLM parameters whitelist` to permit `null` for
    `maxCompletionTokens`; `Merge semantics at chat time` to clarify that
    `null` is an *explicit* value that survives merging rather than falling
    through to the env default).
  - `env-example` — one Requirement modified (`Environment variable
    documentation file`): the `LLM_MAX_COMPLETION_TOKENS documented`
    scenario is rewritten so the documented default is "unset / empty
    (no limit)" rather than `4096`.
- **Affected code**:
  - `writer/lib/config.ts` — replace `posIntEnv("LLM_MAX_COMPLETION_TOKENS", 4096)`
    with a parser returning `number | null`, default `null`.
  - `writer/types.ts` — widen `LlmConfig.maxCompletionTokens` and
    `EnvConfig.LLM_MAX_COMPLETION_TOKENS` to `number | null`.
  - `writer/lib/chat-shared.ts` — guard the `max_completion_tokens` body
    field with a null check; same for the operational + interaction log
    payloads.
  - `writer/lib/story-config.ts` — accept `null` as a valid value for
    `maxCompletionTokens`; preserve existing positive-safe-integer rules
    for non-null values.
  - `reader-src/src/components/LlmSettingsPage.vue` — accept empty input,
    serialise as `null` in the PUT payload, keep positive-integer validation
    for non-empty input. Add a localized hint indicating empty = no limit.
  - `.env.example` — change the `LLM_MAX_COMPLETION_TOKENS` block: comment
    text updated, the assignment line stays commented-out and no longer
    suggests `=4096`.
  - `README.md` — update the configuration table / env-var section to
    describe the new "empty = no limit" semantics.
- **Tests**:
  - `tests/` (Deno) — env parser test for `LLM_MAX_COMPLETION_TOKENS` adds
    cases: unset → `null`, empty → `null`, whitespace → `null`, invalid
    → `null` + warning. Existing valid-integer paths kept.
  - Chat dispatch test — assert request body has no `max_completion_tokens`
    key when merged value is `null`; assert it has the integer when set.
  - Per-story config test — accept `null`, reject `0` / `-1` / `1.5` /
    string / etc. (existing).
  - Frontend settings test — empty input persists `null`; non-empty input
    still validates as positive integer.
- **Not affected**: `HeartReverie_Plugins` (no references to this config in
  that repo); other LLM samplers; the `reasoning` block; rate limiting;
  per-story config REST endpoints; auth.
