## Context

The OpenAI-compatible streaming protocol used by the project's configured LLM provider (e.g. OpenRouter / DeepSeek) emits a final SSE chunk containing a `usage` object with `prompt_tokens`, `completion_tokens`, and `total_tokens`. The upstream request already opts into this by passing `stream_options: { include_usage: true }` (see `writer/lib/chat-shared.ts` line 173). Inside `executeChat()` the captured data is kept in the local `tokenUsage` variable (line 264), logged through the LLM interaction logger (lines 363, 395), and then goes out of scope when the function returns. No persistence, no client-facing propagation, no UI.

Story data lives under `playground/<series>/<story>/` with the convention that entries whose name starts with `_` are system-reserved (`_lore/`, `_prompts/`, `_config.json` in flight). Listing helpers in `writer/lib/story.ts` already exclude underscore-prefixed entries from series/story/chapter enumeration, so a new `_usage.json` slots into the same pattern without new filtering logic.

Chat flows through two transports: the authenticated WebSocket handler in `writer/routes/ws.ts` (using `chat:send` / `chat:resend` → `chat:done`) and the HTTP fallback `POST /api/stories/:series/:name/chat` in `writer/routes/chat.ts`. Both ultimately call `executeChat()` and share the same result type `ChatResult` defined in `writer/lib/chat-shared.ts`. Any new field threaded out of `executeChat()` is therefore surfaced consistently across both transports.

Zero production users — no migration, no versioning.

## Goals / Non-Goals

**Goals:**
- Persist token usage per generated chapter in a compact, append-friendly JSON file colocated with the story.
- Return usage data on both transports (`chat:done` WebSocket frame and HTTP chat response) so the frontend can react at the moment generation finishes, without an extra round-trip.
- Offer a backfill/read endpoint (`GET /api/stories/:series/:name/usage`) so the reader can render historical totals when a story is opened.
- Provide an unobtrusive, collapsible UI element in the reader showing the latest chapter's usage plus the cumulative story total.
- Degrade gracefully when the upstream LLM omits `usage` — no `_usage.json` pollution, UI shows "—", no errors.

**Non-Goals:**
- Cost estimation in currency (pricing is model- and provider-dependent and fluctuates).
- Per-plugin / per-fragment token accounting.
- Historical editing of `_usage.json` through the API (file is append-only in the normal flow; manual edits by humans remain possible but unsupported).
- Token streaming progress (OpenAI streams token content, not running counts).
- Exporting usage as CSV / other formats.

## Decisions

### Decision: `_usage.json` is a JSON array at `playground/<series>/<story>/_usage.json`
A flat array of records matches the "append on each generation" access pattern: read file → parse → push → write. Records are keyed implicitly by array order, which matches chapter creation order. JSON is already first-class across the codebase and avoids adding a new dependency.

**Alternative considered:** JSON Lines (`.jsonl`) to allow `O(1)` appends without re-serialising the whole array. Rejected because (a) files stay small in practice (hundreds of chapters × ~120 bytes per record ≈ tens of KB), (b) the read endpoint wants a parsed array anyway, and (c) re-parsing is simpler than managing two shapes. If growth becomes an issue later we can switch — the external shape stays "array of records".

**Alternative considered:** Frontmatter inside each chapter `.md`. Rejected because it couples the LLM output file with metadata the authoring UI shouldn't touch and would make cumulative queries an O(chapters) directory scan.

### Decision: Record shape matches the proposal schema verbatim
```json
{
  "chapter": 4,
  "promptTokens": 1234,
  "completionTokens": 567,
  "totalTokens": 1801,
  "model": "deepseek/deepseek-v3.2",
  "timestamp": "2026-01-17T12:00:00.000Z"
}
```
- `chapter` is added to the stored record (beyond the user-specified schema) so the reader can correlate a usage record with a chapter without relying on array index, which matters when a generation targeted an existing empty chapter rather than appending a new one (see "reuse last empty file" path in `executeChat()` around line 229).
- `promptTokens`/`completionTokens`/`totalTokens` are stored as numbers and MUST all be present (non-null) for a record to be appended. Providers that return partial usage (e.g. total but no breakdown) are treated as "no usage" for persistence; a debug log records the anomaly.
- `model` captures the **effective merged model** in force for the generation — i.e. the value produced by merging env defaults with any per-story override (see the `per-story-llm-settings` proposal: `Object.assign({}, llmDefaults, storyOverrides).model`) — not the raw `config.LLM_MODEL` env value. This guarantees historical accuracy when the env default changes **and** when a story overrides `model` per request. When `per-story-llm-settings` is not yet implemented the merged result is identical to `config.LLM_MODEL`, so the contract is already satisfied by reading `config.LLM_MODEL` at generation time; once per-story overrides land, the implementation MUST read the resolved model from the effective `LlmConfig` object built inside `executeChat()` rather than from the env constant.
- `timestamp` is the backend wall-clock time of append (ISO 8601 UTC). Not the upstream response time — we don't have that.

### Decision: Append path is a new library module `writer/lib/usage.ts`
Usage IO stays isolated from `story.ts` (chapter listing) and `chat-shared.ts` (orchestration) to keep modules cohesive. Exposes:
- `readUsage(storyDir: string): Promise<TokenUsageRecord[]>` — returns `[]` when the file is absent or malformed (malformed case logs a warning and treats the file as empty to avoid blocking a generation; a backup copy is written to `_usage.json.bak`).
- `appendUsage(storyDir: string, record: TokenUsageRecord): Promise<void>` — read → push → write with `Deno.writeFile` (mode `0o664`), using a per-story async lock to serialise concurrent writes. The WebSocket handler currently allows at most one generation per request id per connection, but the lock is cheap insurance.
- `computeTotals(records: readonly TokenUsageRecord[]): UsageTotals` — returns `{ promptTokens, completionTokens, totalTokens, count }`, summing numeric fields.

### Decision: `executeChat()` owns the append and the return
`executeChat()` already knows the chapter number (`targetNum`), the resolved model (`config.LLM_MODEL`), and the captured `tokenUsage`. Appending there keeps the write adjacent to the post-response hook dispatch and ensures aborted/errored generations never persist usage. The function's `ChatResult` grows an optional `usage?: TokenUsageRecord | null` field; callers that don't care ignore it.

### Decision: Both transports surface `usage` additively
- HTTP (`writer/routes/chat.ts`): the existing `return c.json(result)` automatically includes the new optional field. No shape break.
- WebSocket (`writer/routes/ws.ts`): extend `WsChatDoneMessage` in `writer/types.ts` with `readonly usage?: TokenUsageRecord | null` and populate it from `result.usage` when dispatching the `chat:done` frame.
- When the LLM emitted no usage, the field is `null` (explicit) rather than omitted, so frontend code can distinguish "usage unavailable" from "field not supported yet". Since there are no existing clients, this is purely a forward-looking discriminator.

### Decision: New authenticated route `GET /api/stories/:series/:name/usage`
Registered in a new `writer/routes/usage.ts` behind the existing `validateParams` + passphrase middleware + rate limiter. The path is nested under `/api/stories/...` to match the existing story-scoped namespace used by `POST /api/stories/:series/:name/chat`, `GET /api/stories/:series/:name/chapters`, and `POST /api/stories/:series/:name/preview-prompt` (see `writer/app.ts`). Returns:
```json
{ "records": [ ... ], "totals": { "promptTokens": ..., "completionTokens": ..., "totalTokens": ..., "count": ... } }
```
Totals are computed server-side so the frontend doesn't duplicate the logic. No PUT/DELETE — the file is backend-managed. Manual editing remains possible but unsupported.

### Decision: Coordinate `_usage.json` lifecycle with chapter-edit-branch

`_usage.json` is append-only in the steady-state chat flow, but the in-flight `chapter-edit-branch` proposal introduces two operations that mutate the chapter set non-append-only: **rewind** (delete every chapter after some chapter N within the same story) and **branch/fork** (copy a prefix of a story's chapters into a new story at a chosen chapter N). Left uncoordinated, rewound stories would retain orphan usage rows pointing at deleted chapters, and forked stories would either inherit stale foreign records or have no usage history at all.

Resolution — `chapter-edit-branch` implementation SHALL treat `_usage.json` as a first-class sibling of the chapter files:

- **On rewind (truncate to chapter N):** after deleting chapters with number > N, the rewind operation SHALL load `_usage.json`, filter records whose `chapter <= N`, and write the result back (or delete the file if the filtered array is empty). The existing per-story async lock in `writer/lib/usage.ts` SHALL be acquired for this mutation to avoid racing a concurrent chat append.
- **On branch/fork (copy chapters 1..N into a new story):** after copying the chapter files, the branch operation SHALL also copy the source `_usage.json` (if present) into the new story directory, filtering to records with `chapter <= N`. The new story's ledger starts with the copied prefix; subsequent generations in the new story append normally.

`token-usage-tracking` itself exposes only the append/read/compute surface; the mutation surface (truncate-on-rewind, copy-on-branch) lives with the edit/branch feature. `writer/lib/usage.ts` SHOULD export a `pruneUsage(storyDir, keepThroughChapter)` and `copyUsage(sourceDir, destDir, keepThroughChapter)` helper at implementation time so the edit/branch code has a single tested entry point for these mutations instead of re-reading/re-writing the file directly. This pair of helpers is a future coordination point — their exact names, signatures, and ownership will be nailed down when the two proposals are merged/implemented, but the file-format contract stated here (the filter predicate is `record.chapter <= N`) is stable now.

### Decision: Frontend state in a dedicated composable `useUsage.ts`
Mirrors `useChapterNav.ts` in shape: singleton module-level refs keyed by `series/story`, a `load(series, story)` method that calls `GET /api/stories/:series/:name/usage`, and a `pushRecord(record)` method invoked by the WebSocket `chat:done` listener in `useChatApi.ts`. When the HTTP fallback is used (no `usage` on response), the composable triggers a re-fetch instead. Separation from `useChatApi` keeps chat orchestration focused.

### Decision: UI element is a single collapsible badge, not a full page
The reader is a reading-first surface; a full stats page is overkill. A compact badge in the reading layout header/footer area shows "Total: N tokens · Last: P+C" and expands to a small panel listing the most recent 10 records on click. This aligns with the "unobtrusive" constraint and reuses existing Tailwind styling. A future settings page can embed a richer view if needed.

## Risks / Trade-offs

- [**Provider omits `usage`**] → Graceful skip: no append, WebSocket sends `usage: null`, UI shows "—". Already the common case for some local inference gateways; the design treats it as first-class instead of a bug.
- [**Concurrent writes corrupt `_usage.json`**] → Per-story async lock in `usage.ts` serialises read-modify-write. Worst case a write is delayed a few hundred ms.
- [**Malformed existing `_usage.json` (manual edit gone wrong)**] → Treat as empty, back up to `_usage.json.bak`, log a warning. Generation proceeds. Alternative — hard-fail generation — was rejected because usage is a secondary concern and must never block the primary flow.
- [**File grows unboundedly for very long stories**] → Acceptable for the foreseeable future (hundreds of records × ~120 bytes). If a story ever reaches tens of thousands of chapters we can switch to JSONL without changing the external surface.
- [**Clock skew in `timestamp`**] → Timestamps are informational only (display sort is by `chapter`, not by timestamp). Using backend wall clock is sufficient.
- [**Frontend re-render storm on `chat:done`**] → `useUsage` updates a single reactive ref; the badge component re-renders once per generation, which is already the pace of the existing streaming UI.

## Migration Plan

No migration. Zero users. The feature activates the next time `executeChat()` runs after deploy; stories without `_usage.json` start accumulating from that point. The read endpoint returns `{ records: [], totals: { ... zeroes ... } }` for pre-feature stories.

## Open Questions

- Should the UI expose a "clear usage history" action? **Tentative answer: no.** The file is backend-managed and persisting historical accuracy is the point. Users who insist can delete the file manually.
- Should `GET /api/stories/:series/:name/usage` support pagination? **Tentative answer: no.** Expected row counts stay within a single response even for long stories.
