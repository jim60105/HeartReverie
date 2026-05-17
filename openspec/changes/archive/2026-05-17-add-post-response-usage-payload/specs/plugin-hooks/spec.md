## ADDED Requirements

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
- `appendedTag?: string` — set when `source === "plugin-action"` and the run appended a wrapped block
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

### Requirement: Post-response payload is fully frozen at dispatch

The fully-assembled `PostResponsePayload` placed onto the dispatched `post-response` context SHALL be deep-frozen via `deepFreeze(payload)` before `hookDispatcher.dispatch("post-response", payload)` is called. `Object.isFrozen(payload) === true` SHALL hold, AND every nested value reachable from the payload (notably the non-null `usage` `TokenUsageRecord`) SHALL also be frozen. This generalises the field-scoped deep-freeze that the `hook-observability` capability already establishes for the `pre-llm-fetch` payload's `messages` and `requestMetadata` slots — applying the same runtime contract to the whole `post-response` payload rather than a named subset of fields.

Every field of `PostResponsePayload` (declared `readonly` on the TypeScript interface) is therefore observation-only at runtime. Both top-level reassignment of any slot (`context.usage`, `context.content`, `context.endpoint`, `context.chapterPath`, …) and nested mutation of the `usage` record SHALL throw `TypeError` under strict mode (Deno ESM modules are strict by default). The whole-payload freeze invariant SHALL hold equally for serial and parallel handlers; parallel `post-response` handlers SHALL observe a payload that no peer handler can have mutated.

When `usage` is `null` (upstream omitted token counts), the `null` value SHALL be passed through without `structuredClone`/`deepFreeze` (both are no-ops on `null`), but the surrounding payload SHALL still be `Object.isFrozen`, so reassignment of the `usage` slot SHALL throw exactly as in the non-null case.

The `HookDispatcher` SHALL NOT mutate the dispatched `post-response` payload between dispatch entry and handler invocation. In particular, per-handler logger injection SHALL be performed via a `Proxy` view (matching the dispatcher's existing parallel-path pattern) rather than by writing `context.logger = ...` on the payload, so that freezing the payload at the dispatch site does not cause dispatcher-internal mutation to throw.

#### Scenario: Reassigning the usage slot throws

- **GIVEN** a dispatched `post-response` payload whose `usage` is a non-null `TokenUsageRecord` (or `null`)
- **WHEN** a handler executes `context.usage = null` (or `context.usage = { ...someOtherRecord }`)
- **THEN** the assignment SHALL throw `TypeError` under strict mode, because the payload is frozen

#### Scenario: Reassigning any other top-level slot throws

- **GIVEN** a dispatched `post-response` payload
- **WHEN** a handler executes `context.content = "..."`, `context.endpoint = "..."`, `context.chapterPath = "..."`, or reassigns any other declared field
- **THEN** the assignment SHALL throw `TypeError` under strict mode, because the payload is frozen

#### Scenario: Mutating usage record fields throws

- **WHEN** a `post-response` handler executes `context.usage.totalTokens = 0` (or any other field reassignment) on a payload whose `usage` is a non-null `TokenUsageRecord`
- **THEN** the assignment SHALL throw `TypeError` under strict mode, because the payload (and its `usage` value) is deep-frozen

#### Scenario: Adding keys to the usage record throws

- **WHEN** a `post-response` handler executes `(context.usage as Record<string, unknown>).cost = 0.0042`
- **THEN** the assignment SHALL throw `TypeError` because `usage` is deep-frozen

#### Scenario: Payload is observable but not mutable across parallel handlers

- **GIVEN** two `post-response` handlers registered in the parallel bucket
- **WHEN** the dispatcher invokes them concurrently and one of them attempts any mutation on the payload (`context.usage`, `context.content`, nested fields, etc.)
- **THEN** the mutating handler SHALL throw `TypeError`, and the peer handler SHALL observe the original payload byte-for-byte

#### Scenario: Null usage still produces a frozen payload

- **WHEN** `usage` is `null` (upstream omitted token counts) at dispatch time
- **THEN** the dispatched `context.usage` SHALL be exactly `null` with no `structuredClone`/`deepFreeze` applied to the value itself (both are no-ops on `null`), AND the surrounding payload SHALL satisfy `Object.isFrozen(context) === true`, so a handler assigning `context.usage = someRecord` SHALL throw `TypeError` under strict mode

#### Scenario: Dispatcher does not mutate the frozen payload to inject logger

- **GIVEN** a frozen `PostResponsePayload` passed to `HookDispatcher.dispatch("post-response", payload)`
- **WHEN** a serial handler is invoked
- **THEN** the dispatcher SHALL invoke the handler with a `Proxy` view that returns the per-handler logger from `ctx.logger`, without writing `logger` (or any other property) onto the underlying frozen payload, and the dispatch SHALL NOT throw `TypeError` despite the payload being frozen
