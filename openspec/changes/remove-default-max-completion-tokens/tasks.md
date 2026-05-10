# Tasks

## 1. Env parser

- [x] 1.1 Add a `posIntOrNullEnv(name, fallback)` helper (or inline the logic)
      to `writer/lib/config.ts` that returns `number | null`. Empty / unset /
      whitespace → `null` (silent). Non-empty value runs through the existing
      `^[1-9]\d*$` regex + `Number.isSafeInteger && > 0` check; failure → `null`
      AND `console.warn` naming the variable + offending value.
- [x] 1.2 Replace `const LLM_MAX_COMPLETION_TOKENS: number = posIntEnv("LLM_MAX_COMPLETION_TOKENS", 4096);`
      with `const LLM_MAX_COMPLETION_TOKENS: number | null = posIntOrNullEnv("LLM_MAX_COMPLETION_TOKENS", null);`.
- [x] 1.3 Widen `LlmConfig.maxCompletionTokens` and
      `EnvConfig.LLM_MAX_COMPLETION_TOKENS` in `writer/types.ts` to
      `number | null`. Update the JSDoc on `LlmConfig.maxCompletionTokens` to
      document `null` = "no limit, key omitted upstream".
- [x] 1.4 Widen `LlmDefaultsResponse.maxCompletionTokens` (in `writer/types.ts`
      and any mirrored type in `reader-src/src/types/index.ts`) to
      `number | null`. The `GET /api/llm-defaults` route in
      `writer/routes/llm-defaults.ts` SHALL return `maxCompletionTokens: null`
      (key present with `null` value) — NOT omit the key — so the existing
      "full defaults snapshot" contract is preserved.
- [x] 1.5 Update `StoryLlmConfig.maxCompletionTokens` in
      `reader-src/src/types/index.ts` to `number | null` and update
      `useStoryLlmConfig.validateLlmDefaultsBody()` (and any sibling validator)
      so that `null` is accepted *only* for `maxCompletionTokens`; for every
      other numeric field, `null` SHALL be rejected as wrong-type (mirroring
      the backend whitelist rules).

## 2. Merge rule and request body

- [x] 2.1 In `writer/lib/story-config.ts`, the field-specific exception for
      `maxCompletionTokens: null` is implemented inside `validateStoryLlmConfig`
      (it preserves an explicit `null` for this one field rather than stripping
      it). This causes the storyOverrides object passed to
      `Object.assign({}, llmDefaults, storyOverrides)` inside
      `resolveStoryLlmConfig` to carry `maxCompletionTokens: null` only when the
      user chose that override, so the existing `Object.assign` produces the
      correct merged result with no special case at the merge site.
- [x] 2.2 In `writer/lib/chat-shared.ts`, change the request body builder so
      that the `max_completion_tokens` key is added **only** when
      `llmConfig.maxCompletionTokens !== null`. (Today it is unconditionally
      assigned.) Confirm by reading the constructed `requestBody` object at
      line ~286-300.
- [x] 2.3 Confirm no other code path constructs an upstream chat-completion
      body with `max_completion_tokens` (grep for the exact string).

## 3. Per-story config validator

- [x] 3.1 In `writer/lib/story-config.ts` (around line 127-135 — the existing
      `maxCompletionTokens` validator), accept `null` as a valid value.
      Preserve all other rules (reject `0`, negatives, non-integers, strings,
      booleans, unsafe integers). Persist `null` verbatim in the JSON file.
- [x] 3.2 Re-confirm the `STORY_LLM_CONFIG_KEYS` whitelist still contains
      `"maxCompletionTokens"` (it does today; this is just a sanity check).

## 4. Settings UI

- [x] 4.1 In `reader-src/src/components/LlmSettingsPage.vue`, change the
      validation branch at line 214-227 (`if (f.key === "maxCompletionTokens")`):
      when `raw === ""`, set `(payload as Record<string, unknown>)[f.key] = null`
      and continue (do **not** error out); when `raw !== ""`, keep the existing
      positive-integer regex/predicate.
- [x] 4.2 Lift the existing `if (raw === "" || !Number.isFinite(num))` early
      reject so it does not fire for the `maxCompletionTokens` key when raw is
      empty (i.e. branch on the field name first).
- [x] 4.3 Add a localized hint (helper text) under the
      `回應上限 (max_completion_tokens)` field: `留空表示不設上限，由模型供應商決定`.
- [x] 4.4 When the backend returns a `maxCompletionTokens` of `null` (or
      missing), display an empty string in the input rather than the literal
      string `"null"` or `"0"`.

## 5. Tests

- [x] 5.1 Env parser test (`tests/...`): `LLM_MAX_COMPLETION_TOKENS` unset →
      `null`; empty string → `null`; whitespace-only → `null`; `"abc"` →
      `null` + warning; `"4096"` → `4096`; `"0"` → `null` + warning;
      `"-1"` → `null` + warning; `"1e3"` → `null` + warning; `"01024"` →
      `null` + warning.
- [x] 5.2 Chat-dispatch test: when merged `maxCompletionTokens` is a positive
      integer, the JSON-stringified upstream body contains `"max_completion_tokens":<n>`;
      when `null`, the body does **not** contain the substring
      `max_completion_tokens` at all.
- [x] 5.3 Per-story config test: PUT `{ "maxCompletionTokens": null }` →
      HTTP 200, persisted file contains `"maxCompletionTokens": null`. Existing
      reject-cases (`0`, `-1`, `1.5`, `"4096"`, `true`, oversized) keep their
      400 responses.
- [x] 5.4 Merge-rule test: `llmDefaults.maxCompletionTokens = 4096` plus
      `_config.json` `{ "maxCompletionTokens": null }` → merged result is
      `null` (NOT `4096`); confirm via the same test that other-field
      `null`-fall-through is unaffected (e.g. `topK: null` still falls back
      to env default).
- [x] 5.5 Frontend settings-form test (if a Vitest harness exists) or a
      manual test entry in the change tasks: empty input persists `null`;
      typing `1234` then saving persists `1234`; typing `0` shows the
      existing positive-integer error.
- [x] 5.6 Log-shape test: the operational and interaction logs include
      `maxCompletionTokens: null` (or `<int>`) in their JSON payloads.

## 6. Docs

- [x] 6.1 `.env.example`: rewrite the `LLM_MAX_COMPLETION_TOKENS` block. The
      comment should say it's optional and that leaving it unset means no
      application-level limit (the upstream provider decides). The assignment
      line stays commented-out and SHALL NOT suggest `=4096`. A short hint
      referencing positive-integer validation when set is fine.
- [x] 6.2 `README.md`: in the configuration / env-var section, update any
      mention of `LLM_MAX_COMPLETION_TOKENS` (or add one if absent — current
      grep shows zero hits, which is itself a doc gap worth filling) so it
      describes the new "empty = no limit" semantics. Use the same wording
      as the settings UI hint where possible.
- [x] 6.3 `docs/`: grep `docs/` for `max_completion_tokens` /
      `maxCompletionTokens` (currently zero hits per the propose-phase
      check); if the grep gains hits during implementation (e.g. another
      file added), update them. Otherwise this task is a no-op confirmation.

## 7. Container smoke test (BLOCKING per AGENTS.md)

- [x] 7.1 `bash HeartReverie/scripts/podman-build-run.sh`. After the container
      is up, run `podman logs heartreverie 2>&1 | grep -i "error\|warn"` per
      the root `AGENTS.md` mandatory protocol — output MUST be empty (no
      errors and no warnings; no "existing dependency noise" exception).
- [x] 7.2 With no `LLM_MAX_COMPLETION_TOKENS` in `.env`, the
      `LLM defaults exposure endpoint` SHALL return `maxCompletionTokens: null`
      (key present, `null` value). Verify with
      `curl -H "X-Passphrase: ..." http://localhost:8080/api/llm-defaults`
      and `jq 'has("maxCompletionTokens") and .maxCompletionTokens == null'`
      → must print `true`.
- [x] 7.3 Trigger one chat turn end-to-end and tail the LLM interaction log;
      confirm the `LLM request` entry's `parameters.maxCompletionTokens` is
      the JSON literal `null`. Body-shape verification (that the upstream
      `max_completion_tokens` key is omitted) is covered by the unit test in
      §5.2 against the constructed `requestBody` object — do NOT rely on a
      raw upstream-body log line that the spec does not require.
- [x] 7.4 Set `LLM_MAX_COMPLETION_TOKENS=8192` in `.env`, re-run the
      container, trigger one chat turn, confirm the log shows
      `maxCompletionTokens: 8192` AND the upstream body contains
      `"max_completion_tokens":8192`.
- [x] 7.5 Frontend smoke (agent-browser): open the LLM settings panel, save
      with the field empty → backend returns the persisted object with
      `maxCompletionTokens: null`; reload the page and confirm the field
      displays empty (not `0`, not `"null"`).
- [x] 7.6 Cleanup: stop+rm container; close browser.

## 8. Spec validation + finalise

- [x] 8.1 `cd HeartReverie && openspec validate remove-default-max-completion-tokens --strict` → must pass.
- [x] 8.2 Mark all tasks `[x]`.
- [x] 8.3 Commit on a feature branch with prefix `feat(llm):` (or `refactor(llm):`
      if the apply phase ends up purely refactor-shaped) and the
      `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
      trailer.
