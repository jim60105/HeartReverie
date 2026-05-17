## Context

`HeartReverie/writer/lib/chat-shared.ts` is the single source of truth for LLM chat completion. After upstream usage is parsed from the SSE stream, the local variable `usage: TokenUsageRecord | null` is built at `chat-shared.ts:752–764`. From there, the function fans out into four `writeMode` branches:

| `writeMode`                  | Lines       | Calls `appendUsage()`? | Dispatches `post-response`? |
|------------------------------|-------------|------------------------|-----------------------------|
| `write-new-chapter`          | 776–778, 782 | ✅                     | ✅                         |
| `append-to-existing-chapter` | 793–823     | ❌ **(bug)**           | ✅                         |
| `continue-last-chapter`      | 825–827, 839 | ✅                     | ✅                         |
| `replace-last-chapter`       | 860–862, 873 | ✅                     | ✅                         |

The `post-response` payload at every dispatch site is currently an untyped `Record<string, unknown>` and does **not** carry `usage` — subscribers can only re-read `_usage.json` from disk, which (a) is racy against append, (b) requires file I/O on every dispatch, and (c) is silently empty for plugin-action append completions due to the missing call in the table above.

Precedent for the dispatch-time observability contract already exists in this repo: `pre-llm-fetch` dispatches `messages` and `requestMetadata` after `deepFreeze(structuredClone(...))`, documented in `openspec/specs/hook-observability/spec.md` ("Pre-LLM-fetch payload is observe-only"). This change applies the same pattern to `usage`.

## Goals / Non-Goals

**Goals:**
- Make per-generation token usage available **synchronously** to every `post-response` subscriber, with no disk I/O and no race against the ledger append.
- Fix the silent ledger drop in the `append-to-existing-chapter` branch so `_usage.json` reflects every successful generation across all four `writeMode` values.
- Introduce a single typed `PostResponsePayload` interface in `writer/types.ts` so all four dispatch sites converge on one schema and TypeScript catches drift.
- Enforce the observe-only contract for the new field at runtime via deep-freeze, matching the `pre-llm-fetch` precedent.

**Non-Goals:**
- Reshaping `TokenUsageRecord` to Anthropic-native fields or preserving prompt-cache / reasoning-tokens — permanent design exclusion (operators using Anthropic models route through an OpenAI-compatible gateway).
- Backward-compat / migration shims (no production users; project is early-stage).
- New plugin code — the `cost-tracker` plugin is a separate proposal in the `HeartReverie_Plugins` repo.
- WebSocket protocol changes — `chat:done` already carries `usage` per `token-usage-tracking`.
- Adding a brand-new hook stage or a new dispatcher; the existing `hookDispatcher.dispatch("post-response", ctx)` is reused with a richer typed `ctx`.

## Decisions

### Decision 1: Add `usage` to `post-response` rather than introduce a new hook stage

**Choice:** Extend the existing `post-response` payload with `usage: TokenUsageRecord | null`.

**Alternatives considered:**
- A new dedicated `usage-recorded` stage. Rejected: it would split the post-completion lifecycle into two hops for plugins, duplicate the dispatch fanout, and create a new ordering dependency between `post-response` and `usage-recorded` for plugins that need both.
- Pass `usage` only via WebSocket `chat:done`. Rejected: HTTP fallback wouldn't receive it; `post-response` runs server-side and is the only path that can attribute cost regardless of transport (including plugin-action runs which don't go through WebSocket chat).

**Rationale:** `post-response` already runs exactly once per completion, exactly where `usage` is available, in the same code path for both HTTP and WebSocket. Extending its payload is the minimal change that delivers the capability.

### Decision 2: `usage: TokenUsageRecord | null` (required field, nullable value) instead of optional

**Choice:** Make `usage` a **required** key on `PostResponsePayload`, but allow the value to be `null` when upstream omitted token counts.

**Alternatives considered:**
- Optional `usage?: TokenUsageRecord` (key absent when unknown). Rejected: subscribers must explicitly distinguish "no usage available" from "key forgotten by dispatch site," exactly mirroring the choice already made for the WebSocket `chat:done` payload in `token-usage-tracking`.

**Rationale:** Consistency with the existing WS contract; TypeScript narrows correctly; impossible for a dispatch site to forget the field without a compile error.

### Decision 3: Deep-freeze the WHOLE `PostResponsePayload` at dispatch

**Choice:** Apply `deepFreeze(payload)` to the fully-constructed `PostResponsePayload` (after assembling every field including `usage`) immediately before dispatching `post-response`. `Object.isFrozen(payload) === true` MUST hold recursively across all nested values (including `usage`). Every field is declared `readonly` on the TypeScript interface, and at runtime both top-level reassignment (`context.usage = null`, `context.content = "..."`, `context.endpoint = "..."`) and nested mutation (`context.usage.totalTokens = 0`, adding new keys to `context.usage`) throw `TypeError` under strict mode (Deno ESM modules are strict by default).

**Alternatives considered:**
- `readonly` type-only contract without runtime freeze. Rejected: `pre-llm-fetch` already establishes deep-freeze as the runtime-enforced precedent for observation-only fields in this codebase (see `hook-observability` capability, "Pre-LLM-fetch payload is observe-only"). Type-only readonly is bypassable at runtime; deep-freeze is not.
- Freeze only the `usage` slot (via `deepFreeze(structuredClone(usage))` + `Object.defineProperty(payload, "usage", { writable:false, configurable:false })`) and leave `content`, `chapterPath`, `endpoint`, etc. mutable. Rejected: the whole payload is observation-only by intent. Splitting "this field is observe-only, that field is mutable" within a single payload is a footgun for plugin authors and creates an inconsistent contract; freezing the whole object is the simpler, stronger guarantee and removes per-field `Object.defineProperty` plumbing.
- Freeze only top-level fields via `Object.freeze(payload)` without recursing into `usage`. Rejected: handlers could still mutate `payload.usage.totalTokens`, defeating the cross-handler isolation goal.

**Rationale:** The `post-response` hook is observation-only by design — handlers may inspect `usage`, `endpoint`, `content`, etc. to attribute cost, emit metrics, persist analytics, or kick off side-effectful jobs, but they MUST NOT alter what peer handlers or downstream code observe. Freezing the whole payload (a) gives the strongest runtime guarantee that no handler can corrupt another's view, (b) is one line at the dispatch site rather than per-field property descriptors, and (c) is symmetric with the `pre-llm-fetch` precedent's intent (just applied to the whole context rather than two named slots).

**Dispatcher contract impact:** `HookDispatcher.#runSerial()` previously assigned `context.logger = ...` directly on the passed context, which would throw against a frozen payload. As part of this change, `#runSerial()` is refactored to inject `logger` via a `Proxy` view (identical pattern to the parallel path's `#runParallel()`), so the underlying payload is never mutated to install the per-handler logger. Handlers continue to read `ctx.logger` transparently; writes to `ctx.logger` remain a no-op (the per-handler logger is immutable). All other property writes by serial handlers pass through to the real context — but since `post-response` payloads are frozen, those writes will throw, which is the desired semantics for this stage.

### Decision 4: Single shared payload per dispatch — not per-handler

**Choice:** Build the deep-frozen `PostResponsePayload` once at the start of the post-completion block and pass the same reference into the dispatched context. Each branch then constructs its branch-specific `PostResponsePayload` via a tiny `buildPostResponsePayload({...base})` helper that closes over the pre-built `usage` and `endpoint` and applies `deepFreeze()` to the assembled object.

**Rationale:** Cheaper than freezing per handler; consistent with how `pre-llm-fetch` freezes `messages`/`requestMetadata` exactly once at the dispatch site. Plugins running in parallel see byte-identical observation.

### Decision 5: Append fix lives in the same change as the payload change

**Choice:** Bundle Delta 1 (append-on-success for `append-to-existing-chapter`) and Delta 2 (typed payload + `usage` field) into one proposal.

**Rationale:** Both are required for a plugin to **reliably** attribute usage on every completion. Splitting them would leave the `cost-tracker` consumer broken for plugin-action appends even after Delta 2 lands. The two changes touch adjacent lines in one function and share the same test surface.

## Risks / Trade-offs

- **[Risk] Freezing the entire payload could break a hypothetical existing subscriber that mutates any field (`usage`, `content`, etc.).** → Mitigation: no such subscriber exists in the engine repo, and the `pre-llm-fetch` precedent already established that hook payloads documented as observation-only are deep-frozen. The whole-payload freeze is documented in the spec delta so plugin authors are not surprised.
- **[Risk] The new required `usage` field on `PostResponsePayload` is a typed-API breaking change for any out-of-tree subscriber typing the context.** → Mitigation: project is early-stage with no production plugin consumers; making the field required (rather than optional) is the same trade-off already made for WS `chat:done`. Acceptable.
- **[Risk] `appendUsage()` in the `append-to-existing-chapter` branch may interact with file-locking semantics around the chapter write itself.** → Mitigation: `appendUsage()` already provides its own per-story async lock and swallow-on-failure semantics per the `token-usage-tracking` capability ("Append must be resilient to concurrent writes and malformed existing files"). The other three branches already rely on those guarantees; this branch will too.
- **[Risk] `HookDispatcher.#runSerial()` previously mutated `context.logger` directly; freezing the payload would break this.** → Mitigation: as part of this change, `#runSerial()` is refactored to inject the per-handler logger via a `Proxy` view (matching the parallel path's existing pattern), so the dispatcher never mutates the payload to install `logger`. Existing tests that read `ctx.logger` inside handlers continue to pass unchanged; no test asserted that `logger` persists on the base context after dispatch.
- **[Trade-off] No migration path for plugins that were re-reading `_usage.json` from disk.** → Accepted: they will continue to work; this change only makes the data also available on the payload. They may opt in incrementally.

## Migration Plan

No migration. The change is additive on the payload (new field) and corrective on the ledger (one missing append). Existing subscribers that ignore unknown fields continue to work; existing readers of `_usage.json` see the file grow more consistently. Rollback is a single `git revert` with no data side effects.

## Open Questions

None. The four dispatch sites, the typed-interface location (`writer/types.ts`), and the freeze precedent are all unambiguously established by the existing codebase and the `hook-observability` capability.
