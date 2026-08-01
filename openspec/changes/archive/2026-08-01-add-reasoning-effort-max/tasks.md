## 1. Backend: add `"max"` to the reasoning-effort enum

- [x] 1.1 In `writer/types/llm.ts`, append `"max"` after `"xhigh"` in the `REASONING_EFFORTS` tuple (the derived `ReasoningEffort` type then includes it everywhere automatically).
- [x] 1.2 In `writer/lib/story-config.ts`, change the hard-coded `reasoningEffort` validation message `"Field 'reasoningEffort' must be one of: none, minimal, low, medium, high, xhigh"` to interpolate `REASONING_EFFORTS.join(", ")` so the message can never drift again.
- [x] 1.3 Verify `writer/lib/config.ts::effortEnv` and `writer/lib/chat-llm-fetch.ts` need no edits (they derive from the tuple / typed `LlmConfig`).

## 2. Frontend: mirror the tuple

- [x] 2.1 In `reader-src/src/types/index.ts`, append `"max"` after `"xhigh"` in the `REASONING_EFFORTS` mirror tuple.
- [x] 2.2 Confirm `LlmSettingsPage.vue` and `reader-src/src/composables/useStoryLlmConfig.ts` need no edits (options/validation derive from the tuple), and that the existing `reasoning-effort-parity.test.ts` passes with the updated tuples.

## 3. Tests: cover the seven-value enum

- [x] 3.1 `tests/writer/lib/config_test.ts`: add `"max"` to the accepted-values loop and keep the invalid/mixed-case fallback assertions unchanged.
- [x] 3.2 `tests/writer/lib/config_coverage_test.ts`: add `"max"` to the accepted-values loop(s).
- [x] 3.3 `tests/writer/lib/story-config_test.ts`: add `"max"` to the "accepts each … reasoning effort values" loop; confirm `"max"` is accepted and unknown values still rejected.
- [x] 3.4 `reader-src/src/components/__tests__/LlmSettingsPage.test.ts`: update the select-options assertion to expect `["none", "minimal", "low", "medium", "high", "xhigh", "max"]` (and fix the "all six options" comment).
- [x] 3.5 `tests/writer/lib/chat_shared_reasoning_test.ts`: add a step asserting that a `reasoningEffort: "max"` config forwards `reasoning: { enabled: true, effort: "max" }` in the captured upstream request body (end-to-end forwarding regression test, per Rubber-Duck review).

## 4. Documentation & example surfaces

- [x] 4.1 `AGENTS.md`: update the `LLM_REASONING_EFFORT` row and the per-story config paragraph to list `max` (and "7-value enum").
- [x] 4.2 `docs/reference/configuration.md`: update the `LLM_REASONING_EFFORT` accepted-values note.
- [x] 4.3 `.env.example`: update the `LLM_REASONING_EFFORT` comment to list `max` among accepted values.
- [x] 4.4 `helm/heart-reverie/values.yaml`: update the `LLM_REASONING_EFFORT` comment.
- [x] 4.5 `CHANGELOG.md`: add an entry noting the new `max` reasoning effort level.

## 5. Verification

- [x] 5.1 Run `deno task fmt` and `deno task lint`.
- [x] 5.2 Run `deno task test` (backend + frontend) and confirm no regressions.
- [x] 5.3 Build and run the container via `scripts/podman-build-run.sh`; verify clean startup logs and exercise `GET /api/llm-defaults` plus a `PUT /api/:series/:name/config` with `reasoningEffort: "max"` round-trip via the API.
- [x] 5.4 Frontend check with the browser automation skill: open `/settings/llm`, verify the reasoning-effort `<select>` shows a `max` option and can be saved.
- [x] 5.5 Run `openspec validate --change add-reasoning-effort-max --strict` (if available) to confirm the change validates.
