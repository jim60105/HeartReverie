## 1. Backend types and shared shapes

- [x] 1.1 Add `TokenUsageRecord` (`chapter`, `promptTokens`, `completionTokens`, `totalTokens`, `model`, `timestamp`) and `UsageTotals` (`promptTokens`, `completionTokens`, `totalTokens`, `count`) to `writer/types.ts`
- [x] 1.2 Extend `ChatResult` in `writer/lib/chat-shared.ts` with `readonly usage: TokenUsageRecord | null`
- [x] 1.3 Extend `WsChatDoneMessage` in `writer/types.ts` with `readonly usage?: TokenUsageRecord | null`

## 2. Backend usage library

- [x] 2.1 Create `writer/lib/usage.ts` with the AGPL header and module-level imports (`@std/path`, logger)
- [x] 2.2 Implement `readUsage(storyDir: string): Promise<TokenUsageRecord[]>` — returns `[]` when `_usage.json` is absent; on parse error logs warn and returns `[]` (do NOT back up here — backup is the writer's job)
- [x] 2.3 Implement `computeTotals(records: readonly TokenUsageRecord[]): UsageTotals` — pure summation
- [x] 2.4 Implement an internal per-story async lock map (e.g. `Map<string, Promise<void>>` keyed by absolute `storyDir`) used to serialise appends
- [x] 2.5 Implement `appendUsage(storyDir, record): Promise<void>` — under the lock: read current array (back up & reset to `[]` on parse failure), push, `Deno.writeFile` with mode `0o664`; never throw (catch + log warn)
- [x] 2.6 Export a small helper `buildRecord(input: { chapter, promptTokens, completionTokens, totalTokens, model }): TokenUsageRecord` that stamps `timestamp = new Date().toISOString()`

## 3. Backend chat pipeline integration

- [x] 3.1 In `writer/lib/chat-shared.ts::executeChat()`, after the existing success-path logging (around line 397, before the post-response hook) gate on `tokenUsage.prompt !== null && tokenUsage.completion !== null && tokenUsage.total !== null`
- [x] 3.2 If gated true: build a `TokenUsageRecord` via `buildRecord(...)` and call `await appendUsage(storyDir, record)`; assign `record` to a local `usage` variable
- [x] 3.3 If gated false (provider omitted or partial): set `usage = null` and emit a debug log `"Usage unavailable from upstream"`
- [x] 3.4 Update the `return { chapter, content }` to `return { chapter, content, usage }`
- [x] 3.5 Confirm the abort path (line 355) and every `ChatError` throw path leaves `_usage.json` untouched (no append happens before the success branch)

## 4. Backend route

- [x] 4.1 Create `writer/routes/usage.ts` with the AGPL header and `registerUsageRoutes(app, deps: Pick<AppDeps, "safePath">)` exported
- [x] 4.2 Register `GET /api/stories/:series/:name/usage` with `validateParams` middleware; resolve `storyDir = safePath(series, name)` (return Problem Details 400 on null)
- [x] 4.3 In the handler call `readUsage(storyDir)` → `computeTotals(records)` → `c.json({ records, totals })` with HTTP 200
- [x] 4.4 Mount `registerUsageRoutes(app, { safePath })` in `writer/app.ts` after the existing authenticated routes (so passphrase + rate limit middleware applies)

## 5. Backend tests

- [x] 5.1 Add `tests/writer/lib/usage_test.ts` covering: `readUsage` on missing file → `[]`; on malformed file → `[]` + warn; round-trip `appendUsage` then `readUsage`; `computeTotals` math
- [x] 5.2 Add a concurrent-append test that fires 5 `appendUsage` calls in parallel against a temp story dir and asserts all 5 records end up in the file in some order
- [x] 5.3 Add a malformed-file test asserting `_usage.json.bak` is created and `_usage.json` is reset to a single-record array
- [x] 5.4 Add `tests/writer/routes/usage_test.ts` covering: missing passphrase → 401; reserved series (`_lore`) → 400; valid empty story → 200 with zero totals; valid populated story → 200 with computed totals
- [x] 5.5 Extend `tests/writer/lib/chat-shared_test.ts` (or add new) with mocks asserting: append happens on success-with-usage; no append on success-without-usage; no append on abort; no append on error; `ChatResult.usage` reflects the appended record
- [x] 5.6 Verify `tests/writer/lib/story_test.ts` (if it exists) confirms `_usage.json` is excluded from chapter listings; add a regression case if absent

## 6. Frontend types and composable

- [x] 6.1 Add `TokenUsageRecord` and `UsageTotals` shapes to `reader-src/src/types/index.ts`
- [x] 6.2 Update the local `ChatDoneMessage` type (and any related `WsServerMessage` mirror) in `reader-src/src/types/index.ts` to include `usage?: TokenUsageRecord | null`
- [x] 6.3 Create `reader-src/src/composables/useUsage.ts` with module-level reactive `records` and `totals` state plus a `currentKey` discriminator (`series/story`)
- [x] 6.4 Implement `load(series, story)` — calls `GET /api/stories/:series/:name/usage` via `useAuth`, replaces local state with the response, sets `currentKey`
- [x] 6.5 Implement `pushRecord(record: TokenUsageRecord)` — appends to `records`, updates `totals` arithmetically
- [x] 6.6 Implement `reset()` for story switch and a no-op `pushRecord(null)` overload that is a noop (or expose `markUnavailable()`)

## 7. Frontend integration with chat flow

- [x] 7.1 In `reader-src/src/composables/useChatApi.ts`, in the WebSocket `chat:done` handler, when `msg.usage` is a record call `useUsage().pushRecord(msg.usage)`; when `null` do nothing
- [x] 7.2 In the HTTP fallback success path of `sendMessage`/`resendMessage`, parse the response JSON; if it includes a `usage` field, call `pushRecord(usage)`; if absent or `null`, call `useUsage().load(series, story)` to reconcile
- [x] 7.3 Hook story selection (e.g. in `useStorySelector.ts` or wherever the active story changes) to call `useUsage().load(series, story)` so the panel populates on entry
- [x] 7.4 Hook story-change to call `useUsage().reset()` before the new `load` so stale data doesn't briefly flash

## 8. Frontend UI

- [x] 8.1 Create `reader-src/src/components/UsagePanel.vue` (`<script setup lang="ts">`) consuming `useUsage()` — collapsed view shows `Total: <totalTokens> tokens · Last: <prompt>+<completion>` (zh-TW labels, e.g. `總計：N tokens · 最近：P+C`)
- [x] 8.2 Expanded view: small table of the most recent 10 records with columns chapter / prompt / completion / total / model / timestamp; render `—` for any missing numeric value
- [x] 8.3 Mount `UsagePanel` inside the reading layout (`MainLayout.vue` or `ContentArea.vue`) in an unobtrusive location (footer-aligned badge); ensure it does not appear on settings / lore / prompt-editor routes
- [x] 8.4 Style with Tailwind; keep total height < ~3 lines when collapsed; use `<details>` or a small pinia-free toggle ref for the collapse state

## 9. Frontend tests

- [x] 9.1 Add `reader-src/src/composables/useUsage.spec.ts` covering `load` from mocked fetch, `pushRecord` arithmetic, `reset`
- [x] 9.2 Add `reader-src/src/components/UsagePanel.spec.ts` covering collapsed render with totals, expanded render of records, `—` fallback when values are missing or empty
- [x] 9.3 Extend the existing `useChatApi` spec (if present) to assert `pushRecord` is invoked on `chat:done` with usage, and `load` is invoked on the HTTP fallback path

## 10. Documentation

- [x] 10.1 Update `AGENTS.md` "Project Structure" to mention `_usage.json`, `writer/lib/usage.ts`, `writer/routes/usage.ts`, `useUsage.ts`, and `UsagePanel.vue`
- [x] 10.2 Update `AGENTS.md` WebSocket section to note the new `usage` field on `chat:done`
- [x] 10.3 Add a short entry to `CHANGELOG.md` under the unreleased section describing the new tracking and `GET /api/stories/:series/:name/usage` route
- [x] 10.4 Add a brief docs page (or extend an existing one in `docs/`) describing the `_usage.json` format and the API response shape

## 11. Verification

- [x] 11.1 Run `deno task test:backend` — all green
- [x] 11.2 Run `deno task test:frontend` — all green
- [ ] 11.3 Manual smoke: start the server, generate a chapter against a real LLM, confirm `_usage.json` is created/extended, the WebSocket `chat:done` carries `usage`, and the panel updates
- [ ] 11.4 Manual smoke: point at a provider that omits `usage` (or stub one) and confirm `_usage.json` is untouched, `usage: null` arrives, and the panel shows `—`
- [ ] 11.5 Manual smoke: corrupt `_usage.json` to invalid JSON, generate one chapter, confirm `_usage.json.bak` exists and `_usage.json` contains exactly the new record
