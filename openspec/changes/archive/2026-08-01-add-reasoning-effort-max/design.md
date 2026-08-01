## Context

`ReasoningEffort` is a closed union of six literal strings — `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` — declared as the `REASONING_EFFORTS` tuple in `writer/types/llm.ts`. Every consumer already derives its allowed set from this single tuple or from the derived `ReasoningEffort` type:

- `writer/lib/config.ts::effortEnv` validates `LLM_REASONING_EFFORT` against `REASONING_EFFORTS` (`(REASONING_EFFORTS as readonly string[]).includes(raw)`).
- `writer/lib/story-config.ts::validateStoryLlmConfig` validates the per-story `reasoningEffort` against the same tuple; only its human-readable error message hard-codes the six values.
- `writer/lib/chat-llm-fetch.ts` maps the typed `reasoningEffort` straight into `reasoning: { enabled, effort }`.
- The frontend mirrors the tuple in `reader-src/src/types/index.ts` (locked to the backend by `reader-src/src/__tests__/reasoning-effort-parity.test.ts`, which regex-extracts the backend tuple and compares it at test time) and `LlmSettingsPage.vue` / `useStoryLlmConfig.ts` consume it for the `<select>` options and body validation.

Providers (notably OpenRouter's `o3`/extended-thinking tiers) expose a fourth, above-`xhigh` effort tier (`max`). Because the set is closed and enumerated in several places, adding the tier requires touching the tuples plus a handful of hard-coded enumerations (one error string, docs, tests).

## Goals / Non-Goals

**Goals:**

- Add `"max"` as a valid reasoning effort, placed **after** `xhigh` in the enum ordering.
- Keep the two tuples in sync with zero new drift surface (the existing parity test already covers it).
- Update every hard-coded enumeration (validation message, docs, `.env.example`, Helm values, CHANGELOG, tests) so the whole product agrees on seven values.
- Preserve existing values, the `"xhigh"` default, and wire behaviour byte-for-byte.

**Non-Goals:**

- Reordering or renaming existing effort values.
- Changing the default effort (`"xhigh"` stays the default everywhere).
- Provider-specific validation — the engine forwards whatever valid literal is configured.
- Any change to `reasoningEnabled`, `LLM_REASONING_OMIT`, or `maxCompletionTokens` semantics.

## Decisions

### Decision 1: Add `"max"` to the shared backend tuple, derive everything else

**Choice:** Append `"max"` to `REASONING_EFFORTS` in `writer/types/llm.ts` (after `"xhigh"`) and to the frontend mirror tuple in `reader-src/src/types/index.ts`. The `ReasoningEffort` type derives automatically, so `config.ts`, `chat-llm-fetch.ts`, `useStoryLlmConfig.ts`, and `LlmSettingsPage.vue` need **no** code edits.

**Rationale:** The tuple is already the single source of truth; every site that validates or renders effort values reads from it. Editing only the two tuples (plus parity-test-passing) is the smallest possible change with the largest consistency guarantee.

**Alternative considered:** Introducing a configurable/arbitrary effort string. Rejected — a closed enum is a deliberate product decision; providers that reject unknown literals fail loudly, which is the desired diagnostic behaviour.

### Decision 2: Derive the story-config validation message from the tuple

**Choice:** Change `writer/lib/story-config.ts`'s hard-coded error string (`"Field 'reasoningEffort' must be one of: none, minimal, low, medium, high, xhigh"`) to interpolate `REASONING_EFFORTS.join(", ")`.

**Rationale:** The string is user-facing (surfaced in the 400 Problem Details `detail`) and would otherwise silently rot on the next enum addition. Deriving it keeps the message truthful forever.

**Alternative considered:** Hand-editing the string to add `max`. Rejected — recreates the exact drift class this decision eliminates.

### Decision 3: Tests enumerate the seven values explicitly

**Choice:** Update the backend tests that loop over accepted efforts (`tests/writer/lib/config_test.ts`, `tests/writer/lib/config_coverage_test.ts`, `tests/writer/lib/story-config_test.ts`) and the frontend select-options assertion (`reader-src/src/components/__tests__/LlmSettingsPage.test.ts`) to include `"max"`. The parity test needs no edits and continues to lock both tuples.

**Rationale:** Explicit expected-value assertions in tests document intent better than a silent pass-through; the enum loop in tests is the regression net for "did we accept the new value everywhere".

## Risks / Trade-offs

- **[Provider rejects `max`]** → The engine forwards it verbatim; a strict provider that does not know the literal returns a non-2xx, which the existing code surfaces as a diagnosable RFC 9457 `detail` including the upstream body. No engine change is warranted.
- **[A third tuple copy drifts in the future]** → The parity test (`reasoning-effort-parity.test.ts`) already guards backend↔frontend drift; the backend tuple remains the single source of truth.
- **[Docs/`.env.example`/Helm comments enumerate the set by hand]** → This change updates all of them; the enumeration is inherently documentation-only and intentionally re-stated per surface.
