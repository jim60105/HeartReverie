## Why

The `post-response` hook is the only general-purpose extension point fired after a successful LLM generation, but it currently dispatches an untyped, ad-hoc `Record<string, unknown>` payload that does **not** include token-usage data. Plugins that need to attribute cost or token counts per request (e.g. a planned `cost-tracker`) can only re-read `playground/<series>/<story>/_usage.json` after dispatch — which is racy, slow, and broken in one of the four completion code paths. Specifically, the `append-to-existing-chapter` branch in `writer/lib/chat-shared.ts` never calls `appendUsage()`, so the ledger silently misses every plugin-action append. Without this change, no plugin can reliably observe per-generation token usage.

## What Changes

- **MODIFIED:** `executeChat()` SHALL call `appendUsage()` from the `append-to-existing-chapter` branch (currently the only success branch that omits it), bringing it to parity with `write-new-chapter`, `continue-last-chapter`, and `replace-last-chapter`.
- **ADDED:** A typed `PostResponsePayload` interface SHALL be defined in `writer/types.ts` (mirroring the existing `PreLlmFetchPayload` pattern) and used at every `post-response` dispatch site. It SHALL declare the existing fields (`correlationId`, `content`, `storyDir`, `series`, `name`, `rootDir`, `chapterNumber`, `chapterPath`, `source: "chat" | "continue" | "plugin-action"` — all three literals already emitted by `executeChat()`, optional `pluginName`, optional `appendedTag`) **plus two new required fields: `usage: TokenUsageRecord | null` and `endpoint: string`** (the resolved upstream LLM API URL used for the request, sourced from `llmConfig.apiUrl` / `config.LLM_API_URL`, so plugins can key per-endpoint pricing without re-deriving the URL).
- **ADDED:** All four `post-response` dispatch sites SHALL include `usage` — the same `TokenUsageRecord` already captured locally (currently used only for the ledger append), or `null` when the upstream LLM omitted token counts — and `endpoint` set to the resolved upstream URL the engine `fetch()`-ed for this request.
- **ADDED:** The entire `PostResponsePayload` dispatched to `post-response` handlers SHALL be deep-frozen (`Object.isFrozen(payload) === true`, recursively across nested values including `usage`) before dispatch. Every field is `readonly`; reassigning any top-level slot (e.g. `context.usage = null`, `context.content = "..."`, `context.endpoint = "..."`) and mutating any nested value (e.g. `context.usage.totalTokens = 0`, adding new keys to `context.usage`) SHALL throw `TypeError` under strict mode. This generalises the existing observation-only contract that `pre-llm-fetch` enforces field-by-field via deep-freeze, and replaces the previous design which froze only the `usage` slot.
- No new plugin code is introduced by this change. Hook subscribers (including the future `cost-tracker` plugin, which lives in the `HeartReverie_Plugins` repo and is tracked by a separate proposal `add-cost-tracker-plugin`) consume the richer payload through the existing dispatcher; no new dispatcher, no new hook stage, no protocol change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `token-usage-tracking`: extends the "Append-on-success semantics in `executeChat()`" requirement so it explicitly covers the `append-to-existing-chapter` `writeMode`, not just the three branches that already comply.
- `plugin-hooks`: extends the "Hook stages" requirement (the `post-response` bullet and its dispatch scenarios) to specify the typed `PostResponsePayload`, the new required `usage` field, and the whole-payload deep-freeze invariant — generalising the field-scoped deep-freeze that `pre-llm-fetch` already documents for `messages`/`requestMetadata`.

`hook-observability` is **not** modified — it already specifies the deep-freeze pattern for `pre-llm-fetch`'s `messages` and `requestMetadata`, and this change reuses that precedent without altering or extending the capability itself. design.md cites it as prior art.

## Impact

- **Code touched:** `writer/types.ts` (new exported interface), `writer/lib/chat-shared.ts` (four `post-response` dispatch sites and one missing `appendUsage()` call). No changes to `writer/lib/usage.ts`, no changes to any route, no changes to the WebSocket protocol.
- **Disk format:** unchanged. `_usage.json` schema and the global usage-append contract are unchanged; this change only fixes the one branch that was skipping the append.
- **Plugin API:** strictly additive. Existing `post-response` subscribers that read `content`, `source`, etc. continue to work unchanged; they may opt in to reading `context.usage`.
- **WebSocket `chat:done`:** unchanged. The frame already carries `usage` per the `token-usage-tracking` capability; this change brings hook-level parity but does not touch the WS protocol.
- **Tests:** new unit tests covering (a) `usage` field present on all four sources including `append-to-existing-chapter` with `appendedTag`, (b) ledger growth after plugin-action append, (c) `usage: null` when upstream omits counts, (d) the whole payload is `Object.isFrozen` and that both top-level reassignment and nested mutation throw `TypeError`.
- **Container integration:** a runtime smoke-test in the Podman container is mandatory per root `AGENTS.md` (build, log scan, exercise a chat + a plugin-action append, verify `_usage.json` grows and the hook payload carries `usage`).

## Non-Goals (Out of Scope)

- **Backward compatibility / migration.** The project is early-stage with no production users. Existing `post-response` subscribers are additive-compatible; no migration shim is provided and none is needed.
- **Anthropic-native usage shape.** Not supported. The `TokenUsageRecord` shape recorded by `executeChat()` is the OpenAI/OpenRouter-flavoured `prompt_tokens` / `completion_tokens` / `total_tokens` triple. Operators using Anthropic models SHOULD route through an OpenAI-compatible gateway (e.g. OpenRouter) that normalises usage to the OpenAI shape. Native Anthropic `input_tokens`/`output_tokens`, prompt-cache, and reasoning-token fields are a permanent design exclusion of the engine, not deferred work.
- **Prompt-cache fields.** Not preserved or normalised by this change.
- **New plugin code.** The `cost-tracker` plugin is out of scope here and lives in the `HeartReverie_Plugins` repo as `add-cost-tracker-plugin`.
- **WebSocket protocol change.** `chat:done` already carries `usage`; this change does not alter or duplicate that.
