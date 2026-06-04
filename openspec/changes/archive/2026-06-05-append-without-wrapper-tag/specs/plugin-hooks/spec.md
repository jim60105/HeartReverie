## ADDED Requirements

### Requirement: Post-response appendedTag nullability

The `post-response` hook payload field `appendedTag` SHALL be typed `string | null` and SHALL remain OPTIONAL (a handler MAY observe the field as absent). The field SHALL convey the wrapper tag applied by a plugin-action append:

- For a plugin-action append that used an `appendTag` (tagged append), `appendedTag` SHALL be that non-empty tag string.
- For a plugin-action append that used NO `appendTag` (tagless append — the model output is appended verbatim with no wrapper element), `appendedTag` SHALL be `null`.
- For `source === "chat"` (normal chat / write-new), `replace`-mode plugin-action runs, and `discard`-mode runs, the engine SHALL NOT set `appendedTag` (the field is omitted). A `null` value SHALL therefore unambiguously indicate a tagless plugin-action append, distinct from "not an append" (omitted).

Widening the field from `?: string` to `?: string | null` SHALL NOT change any other `post-response` payload field, and all existing dispatch sites that omit the field SHALL continue to satisfy the type. Well-typed `post-response` consumers SHALL treat `appendedTag` as a possibly-absent, possibly-`null` value and SHALL NOT perform unconditional string operations on it.

#### Scenario: Tagged append reports the tag string

- **WHEN** a plugin-action run with `append: true` and `appendTag: "UpdateVariable"` completes successfully
- **THEN** the dispatched `post-response` context SHALL include `appendedTag: "UpdateVariable"` (a non-null string) and `source: "plugin-action"`

#### Scenario: Tagless append reports null

- **WHEN** a plugin-action run with `append: true` and NO `appendTag` completes successfully
- **THEN** the dispatched `post-response` context SHALL include `appendedTag: null` and `source: "plugin-action"`, and `content` SHALL be the full chapter file content AFTER the verbatim (unwrapped) append

#### Scenario: Non-append dispatches omit appendedTag

- **WHEN** a normal chat completion, a `replace`-mode plugin-action run, or a `discard`-mode plugin-action run dispatches `post-response`
- **THEN** the dispatched context SHALL NOT set `appendedTag` (the field is omitted, not `null`)

#### Scenario: Widened type keeps existing consumers compiling

- **WHEN** the `PostResponsePayload.appendedTag` field is widened to `?: string | null`
- **THEN** every in-repo `post-response` dispatch site that omits the field SHALL still satisfy the type, and no in-repo `post-response` consumer SHALL perform an unconditional non-null string operation on `appendedTag`

## MODIFIED Requirements

### Requirement: Post-response typed payload and usage field

The `post-response` hook payload dispatched from `executeChat()` in `writer/lib/chat-shared.ts` SHALL be a value conforming to a single exported TypeScript interface `PostResponsePayload` declared in `writer/types.ts`. This interface SHALL replace the ad-hoc `Record<string, unknown>` currently used at the four `post-response` dispatch sites (the `write-new-chapter`, `append-to-existing-chapter`, `continue-last-chapter`, and `replace-last-chapter` success branches) so all four sites converge on one statically-checked shape.

`PostResponsePayload` SHALL declare the following members (all `readonly`, mirroring the `PreLlmFetchPayload` pattern already in `writer/types.ts`):

- `correlationId: string` — the UUID generated on entry to `executeChat()`, identical to the value seen by `prompt-assembly` and `pre-llm-fetch` for the same chat request
- `content: string` — full chapter file content for plugin-action append mode, bare LLM response otherwise (unchanged semantics from the existing "Hook stages" requirement)
- `storyDir: string`
- `series: string`
- `name: string`
- `rootDir: string`
- `chapterNumber: number` — the chapter number written or appended to
- `chapterPath: string` — absolute path of the chapter file written or appended to
- `source: "chat" | "continue" | "plugin-action"` — `"chat"` for the `write-new-chapter` branch, `"continue"` for the `continue-last-chapter` branch, and `"plugin-action"` for the `append-to-existing-chapter` and `replace-last-chapter` branches (both are triggered by plugin actions and carry a `pluginName`; matches the existing `source` literals emitted by `executeChat()` in `writer/lib/chat-shared.ts`)
- `pluginName?: string` — set when `source === "plugin-action"` (both append-to-existing-chapter and replace-last-chapter branches)
- `appendedTag?: string | null` — set when `source === "plugin-action"` and the run appended content: the wrapper tag string for a TAGGED append, or `null` for a TAGLESS append (the model output was appended verbatim with no wrapper element). Omitted (absent) for `source === "chat"` / `"continue"`, `replace`-mode runs, and `discard`-mode runs; a `null` value therefore unambiguously indicates a tagless plugin-action append, distinct from "not an append" (omitted). Consumers SHALL treat it as a possibly-absent, possibly-`null` value and SHALL NOT perform unconditional string operations on it.
- `usage: TokenUsageRecord | null` — **new required field**; the same record that was (or would have been) appended to `_usage.json` for this completion, or `null` when the upstream LLM omitted token counts (i.e. when `tokenUsage.prompt`, `tokenUsage.completion`, or `tokenUsage.total` was null and no record was appended). The whole `PostResponsePayload` (including a non-null `usage`) is deep-frozen at dispatch — see the separate "Post-response payload is fully frozen at dispatch" Requirement below.
- `endpoint: string` — **new required field**; the resolved upstream LLM API URL used for the request (sourced from `llmConfig.apiUrl` or equivalent — i.e. the engine's configured upstream URL such as `config.LLM_API_URL` — canonicalized to the request URL the engine actually called, **NOT** the env-var verbatim if the two differ). The `endpoint` value SHALL match the URL that the engine used to perform the LLM request, so plugins can key per-endpoint pricing (e.g. `models[endpoint][model]`) without re-deriving it.

`TokenUsageRecord` SHALL be the shape defined by the `token-usage-tracking` capability (the required base fields `chapter`, `promptTokens`, `completionTokens`, `totalTokens`, `model`, `timestamp`, plus any optional fields that capability defines).

All four `post-response` dispatch sites in `chat-shared.ts` SHALL build and pass a `PostResponsePayload` containing `usage`. The dispatch sites SHALL be the **only** sites that construct this payload; no plugin-side code SHALL be expected to synthesise it.

#### Scenario: Post-response payload includes usage for write-new-chapter

- **GIVEN** a normal chat completion with `writeMode = "write-new-chapter"` and upstream `usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 }`
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context SHALL be a `PostResponsePayload` whose `usage` field is a `TokenUsageRecord` with `promptTokens=80`, `completionTokens=40`, `totalTokens=120`, the effective merged `model`, the target chapter number, and an ISO 8601 UTC `timestamp`

#### Scenario: Post-response payload includes usage for append-to-existing-chapter

- **GIVEN** a plugin-action run with `writeMode = "append-to-existing-chapter"`, `append: true`, `appendTag: "UpdateVariable"`, and upstream `usage` fully populated
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context SHALL be a `PostResponsePayload` with `source: "plugin-action"`, `pluginName` set, `appendedTag: "UpdateVariable"`, `content` equal to the full chapter file content AFTER the append, and `usage` set to the corresponding `TokenUsageRecord` (the same record appended to `_usage.json` for this completion)

#### Scenario: Post-response payload reports appendedTag null for a tagless append

- **GIVEN** a plugin-action run with `writeMode = "append-to-existing-chapter"`, `append: true`, and NO `appendTag` (tagless append)
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context SHALL be a `PostResponsePayload` with `source: "plugin-action"`, `pluginName` set, `appendedTag: null`, and `content` equal to the full chapter file content AFTER the verbatim (unwrapped) append

#### Scenario: Post-response payload includes usage for continue-last-chapter

- **GIVEN** a continue-completion with `writeMode = "continue-last-chapter"` and upstream `usage` fully populated
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context SHALL be a `PostResponsePayload` with `source: "continue"` and its `usage` field SHALL be the corresponding `TokenUsageRecord`, identical to the record appended to `_usage.json`

#### Scenario: Post-response payload includes usage for replace-last-chapter

- **GIVEN** a replace-completion with `writeMode = "replace-last-chapter"` and upstream `usage` fully populated
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context's `usage` field SHALL be the corresponding `TokenUsageRecord`, identical to the record appended to `_usage.json`

#### Scenario: Usage is null when upstream omits token counts

- **GIVEN** any successful generation in any of the four `writeMode` branches where the upstream LLM never emits a `usage` object (or emits a partial triple)
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context's `usage` field SHALL be explicitly `null` (not `undefined` and not missing), so subscribers can distinguish "available" from "unavailable"

#### Scenario: Post-response payload carries the upstream endpoint URL

- **GIVEN** any successful generation in any of the four `writeMode` branches
- **WHEN** `executeChat()` dispatches `post-response`
- **THEN** the dispatched context's `endpoint` field SHALL be a non-empty string equal to the upstream LLM API URL that the engine used to perform the `fetch()` for this request (the resolved `llmConfig.apiUrl` / `config.LLM_API_URL` value), so a subscriber can look up per-endpoint pricing via `models[context.endpoint][record.model]` without re-deriving the URL from environment state
