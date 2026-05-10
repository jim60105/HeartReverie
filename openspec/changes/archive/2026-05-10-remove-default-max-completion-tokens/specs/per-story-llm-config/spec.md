# Spec delta: per-story-llm-config

## MODIFIED Requirements

### Requirement: Overridable LLM parameters whitelist

The per-story `_config.json` SHALL accept only the following keys: `model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`, `reasoningEnabled`, `reasoningEffort`, `maxCompletionTokens`. `model` SHALL be a non-empty string; `reasoningEnabled` SHALL be a boolean; `reasoningEffort` SHALL be one of the literal strings `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` (case-sensitive); `maxCompletionTokens` SHALL be either a positive finite safe integer (`Number.isSafeInteger(value) && value > 0`) **or the JSON literal `null`**, where `null` carries the explicit semantics "no application-level token limit; let the upstream provider decide" and is treated specially by the merge step (see `Merge semantics at chat time`). Every other listed key SHALL be a finite number. Any other key SHALL be stripped on write and ignored on read. Values of incorrect type SHALL cause the write to be rejected and the read to raise a validation error.

For all whitelisted keys **except** `maxCompletionTokens`, the validator SHALL accept `null` and `undefined` as "no override" markers and SHALL strip them from the parsed object (so they never appear in `storyOverrides` and trivially fall through to the env default at merge time). Only `maxCompletionTokens: null` SHALL be preserved verbatim through both the validator and the on-disk JSON file, so the merge step can distinguish "key absent / null-stripped → fall through to env default" from "`maxCompletionTokens` explicitly `null` → override env default to `null`".

#### Scenario: Write rejects wrong-type value

- **WHEN** a client PUTs `{ "temperature": "hot" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying the offending field

#### Scenario: Write strips non-whitelisted keys

- **WHEN** a client PUTs `{ "temperature": 0.7, "tools": [] }` to the per-story config endpoint
- **THEN** the persisted file SHALL contain only `{ "temperature": 0.7 }`

#### Scenario: Model must be a non-empty string

- **WHEN** a client PUTs `{ "model": "" }`
- **THEN** the server SHALL respond with HTTP 400 and SHALL NOT modify the persisted file

#### Scenario: Write accepts reasoningEnabled boolean

- **WHEN** an authenticated client PUTs `{ "reasoningEnabled": false }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "reasoningEnabled": false }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write rejects non-boolean reasoningEnabled

- **WHEN** an authenticated client PUTs `{ "reasoningEnabled": "yes" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `reasoningEnabled` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write accepts a valid reasoningEffort

- **WHEN** an authenticated client PUTs `{ "reasoningEffort": "low" }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "reasoningEffort": "low" }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write rejects unknown reasoningEffort

- **WHEN** an authenticated client PUTs `{ "reasoningEffort": "extreme" }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `reasoningEffort` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write accepts a valid maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 8192 }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "maxCompletionTokens": 8192 }` to `_config.json` and respond HTTP 200 with the persisted object

#### Scenario: Write accepts null maxCompletionTokens as explicit "no limit"

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": null }` to the per-story config endpoint
- **THEN** the server SHALL persist `{ "maxCompletionTokens": null }` to `_config.json` verbatim (the field SHALL NOT be stripped) and respond HTTP 200 with the persisted object

#### Scenario: Write rejects non-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 1024.5 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-positive maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 0 }` or `{ "maxCompletionTokens": -1 }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects unsafe-integer maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": 9007199254740993 }` (a JSON number above `Number.MAX_SAFE_INTEGER`) to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

#### Scenario: Write rejects non-number, non-null maxCompletionTokens

- **WHEN** an authenticated client PUTs `{ "maxCompletionTokens": "4096" }` (string) or `{ "maxCompletionTokens": true }` to the per-story config endpoint
- **THEN** the server SHALL respond with HTTP 400 and an RFC 9457 Problem Details body identifying `maxCompletionTokens` as the offending field, and SHALL NOT modify the persisted file

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
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 8192`

#### Scenario: Missing maxCompletionTokens falls through to env default

- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` that does NOT include the `maxCompletionTokens` key at all
- **WHEN** a chat request targets that story
- **THEN** the upstream request body SHALL contain `max_completion_tokens: 4096`

#### Scenario: Explicit null maxCompletionTokens overrides a non-null env default

- **GIVEN** env default `maxCompletionTokens=4096` (from `LLM_MAX_COMPLETION_TOKENS=4096`) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` (the explicit per-story `null` overrides the env default rather than falling through), AND the upstream chat/completions request body SHALL NOT contain a `max_completion_tokens` key at all

#### Scenario: Both null collapses to no upstream key

- **GIVEN** env default `maxCompletionTokens=null` (from `LLM_MAX_COMPLETION_TOKENS` unset) and a story with `_config.json` containing `{ "maxCompletionTokens": null }`
- **WHEN** a chat request targets that story
- **THEN** the merged `maxCompletionTokens` SHALL be `null` AND the upstream request body SHALL NOT contain a `max_completion_tokens` key
