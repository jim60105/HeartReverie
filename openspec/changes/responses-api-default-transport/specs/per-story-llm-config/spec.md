# Spec Delta

## MODIFIED Requirements

### Requirement: Merge semantics at chat time

The backend SHALL compute the effective LLM configuration for each chat request as `Object.assign({}, llmDefaults, storyOverrides)`, where `llmDefaults` is the env-derived `LlmConfig` object (including the `maxCompletionTokens` field, whose env default is `null` when `LLM_MAX_COMPLETION_TOKENS` is unset/empty/invalid) and `storyOverrides` is the validated partial object read from `_config.json`. Merging SHALL happen per chat request so that changes to `_config.json` take effect on the next request without a server restart.

For all fields **except** `maxCompletionTokens`, fields present in `storyOverrides` with non-`undefined`, non-`null` values SHALL replace the default; otherwise they SHALL keep the env default (i.e. a `null` override falls through).

For `maxCompletionTokens` specifically, the merge SHALL diverge from the default `Object.assign(...)` semantics: a key explicitly present in `_config.json` with the value `null` SHALL be treated as an explicit "no limit" override that replaces the env default with `null` (rather than falling through). The whitelist validator SHALL preserve `null` literals during read so the merge step can distinguish "key absent" (fall through to env default) from "key explicitly `null`" (override to `null`). When the merged `maxCompletionTokens` is `null`, the upstream chat/completions request body SHALL omit the `max_completion_tokens` key entirely.

#### Scenario: Merge resolves at each request
- **GIVEN** env default `temperature=0.1` and a story with `_config.json` containing `{ "temperature": 0.7 }`
- **WHEN** two chat requests arrive, and between them the file is updated to `{ "temperature": 0.3 }`
- **THEN** the first request SHALL use `temperature=0.7` and the second request SHALL use `temperature=0.3` without restarting the server

#### Scenario: Null and missing fields both fall through to default (non-maxCompletionTokens)
- **GIVEN** env default `topK=10` and a story with `_config.json` containing `{ "topK": null }`
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL use `top_k=10`

#### Scenario: maxCompletionTokens override resolves at each request
- **GIVEN** env default `maxCompletionTokens=null` and a story with `_config.json` containing `{ "maxCompletionTokens": 8192 }`
- **WHEN** a chat request targets that story
- **THEN** a Chat Completions request body SHALL contain `max_completion_tokens: 8192` and a Responses request body SHALL contain `max_output_tokens: 8192`

#### Scenario: Missing maxCompletionTokens falls through to env default
- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` that does NOT include the `maxCompletionTokens` key at all
- **WHEN** a chat request targets that story
- **THEN** a Chat Completions request body SHALL contain `max_completion_tokens: 4096` and a Responses request body SHALL contain `max_output_tokens: 4096`

#### Scenario: Explicit null maxCompletionTokens overrides a non-null env default
- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` (the explicit per-story `null` overrides the env default rather than falling through), AND the upstream chat/completions request body SHALL NOT contain a `max_completion_tokens` key at all, and a Responses request body SHALL NOT contain a `max_output_tokens` key

#### Scenario: Both null collapses to no upstream key
- **GIVEN** env default `maxCompletionTokens=null` (from `LLM_MAX_COMPLETION_TOKENS` unset) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` AND a Chat Completions request body SHALL NOT contain a `max_completion_tokens` key and a Responses request body SHALL NOT contain a `max_output_tokens` key
