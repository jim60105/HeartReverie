# Design Notes

## Why a design note for this small change

The spec change looks like a single config flip ("default → empty"), but
three subtle decisions need to be pinned down because they propagate through
the env parser, the merge rule, the request-body composer, the validator,
the settings UI, and the logs.

## Decision 1: Sentinel for "no limit"

Three candidates were considered for "user has no application-level limit":

| Sentinel | Pros | Cons |
| --- | --- | --- |
| `0` | numeric, matches "infinite" intuition for some APIs | conflicts with the "non-positive ⇒ reject" validation rule used by every other sampler in this codebase; some providers actually treat `max_completion_tokens=0` as "return nothing" |
| Field absent (`undefined`) | most conservative — looks like "not configured" | breaks the strict whitelist contract in `_config.json` (we'd have to introduce explicit "delete this key" semantics for PUT) |
| Explicit `null` | distinguishable from "absent" on the wire (JSON `null` vs key missing); aligns with how `_config.json`'s merge rule already treats `null` as "fall through" — but here we want the *opposite*, see Decision 2 | requires a new merge rule (see below) |

**Decision: use explicit `null`** for the in-memory and JSON
representation of "no limit". `null` carries the semantic that the user has
opted out, distinct from "unset" (which falls back to the env default).
Documentation (env-example, README, settings UI hint) consistently calls
this state "empty / no limit" so users don't need to know the JSON wire
representation.

## Decision 2: Merge rule for `maxCompletionTokens` only

The current `per-story-llm-config` `Object.assign({}, llmDefaults, storyOverrides)`
rule says: any field in `storyOverrides` with a non-`undefined`, non-`null`
value replaces the default; `null` falls through to the env default.

That rule was correct when `null` was meaningless for these fields. Now that
`null` is a meaningful value for `maxCompletionTokens` (= "no limit"), we
need to **distinguish** `null`-as-fall-through from `null`-as-explicit-no-limit
**for this field only**. Two options:

a) **Special-case the field**: introduce a `MAX_COMPLETION_TOKENS_NO_LIMIT`
   sentinel value and treat `null` as that sentinel.
b) **Change the merge rule for `maxCompletionTokens`**: treat `null` as a
   legitimate override that replaces the default. Other fields keep the
   existing fall-through-on-null behaviour.

**Decision: option (b).** Special-cased semantics for `maxCompletionTokens`
only. The cleanest implementation places the special case inside
`validateStoryLlmConfig` (not inside `resolveStoryLlmConfig`): the validator
**preserves** `maxCompletionTokens: null` verbatim while continuing to
**strip** `null`/`undefined` for every other field. Because the storyOverride
object handed to `Object.assign({}, llmDefaults, storyOverrides)` then
contains the literal `maxCompletionTokens: null` key only when the user
chose that override, plain `Object.assign` produces the right merged result
without any conditional inside `resolveStoryLlmConfig`. This is the smallest
behavioural change that keeps all other fields' merge semantics untouched.

The spec for `Merge semantics at chat time` is updated to call out this
field-specific exception explicitly with a scenario.

## Decision 3: Validation surface for the new tri-state

Three layers of validation have to agree on the tri-state (`null` /
positive int / invalid):

- **Env parser** (`writer/lib/config.ts`): unset / empty / whitespace →
  `null` (silent). Non-empty value passes through the existing
  `^[1-9]\d*$` regex + `Number.isSafeInteger` predicate. Failed validation
  → `null` AND a warning log naming the variable + offending value (matches
  the existing "invalid value" branch's behaviour, just with a `null`
  fallback instead of `4096`).
- **Per-story `_config.json` validator** (`writer/lib/story-config.ts`):
  accept `null` as valid; preserve existing rules (positive integer,
  reject `0` / negatives / non-integers / non-numbers / unsafe integers) for
  non-null values. Stripping behaviour for unknown keys is unchanged.
- **Settings UI** (`reader-src/src/components/LlmSettingsPage.vue`): empty
  input → submit `null`. Non-empty input → existing positive-integer
  regex/predicate validation. Add a localized hint near the field: "留空表
  示不設上限，由模型供應商決定".

These three layers each enforce the same shape (`number | null`) and emit
the same kind of error for invalid non-null values.

## Decision 4: Logs

Both the operational debug log (`LLM request payload`) and the LLM
interaction log entry (`LLM request`, parameters block) currently record
`maxCompletionTokens: <integer>`. With the new tri-state, the field's value
becomes `<integer> | null`. Logs are JSON-encoded; emitting `null` is
unambiguous and survives a `JSON.stringify` round-trip without special
handling. The on-disk record continues to answer "what budget did this turn
run with?", with `null` meaning "no application-level budget".

## Out of scope

- We do **not** introduce a separate boolean env var like
  `LLM_MAX_COMPLETION_TOKENS_OMIT`. The user already has a single dimension
  to express "send a budget vs don't"; adding a switch would just
  introduce ambiguity (what if the int is set AND the boolean says omit?).
- We do **not** migrate existing `_config.json` files. There are 0 users
  in the wild; existing positive-integer values keep working.
- We do **not** change the merge rule for any other LLM parameter.
- We do **not** alter the `reasoning` field, `LLM_REASONING_OMIT`, the SSE
  parser, the request audit log, or any other unrelated subsystem.
