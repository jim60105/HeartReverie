## 1. Plugin Scaffold

- [x] 1.1 Create `plugins/reading-progress/plugin.json` manifest with type "full-stack", frontendModule, backendModule, settingsSchema (all fields from spec), and empty hooks array
- [x] 1.2 Create `plugins/reading-progress/README.md` with feature overview, settings table, privacy disclosure, multi-user caveat, data deletion instructions, and revision strict-monotonic breaking change notice

## 2. Backend Core

- [x] 2.1 Implement `plugins/reading-progress/backend.ts` with `registerRoutes(ctx)`: create base directory, define TypeScript interfaces (ClientProgressEntry, StoredEntry, TextFragmentAnchor), implement path validation using safePath
- [x] 2.2 Implement PUT handler with body size check (4096 bytes), JSON parsing, field validation (chapterIndex non-negative integer, scrollRatio 0–1, lastReadAt string, selectionAnchor validation), unique-temp + atomic rename write
- [x] 2.3 Implement per-(series,story) in-process mutex (Promise-chain pattern) with strict-monotonic revision counter: `max(in-memory counter, file.revision) + 1`, ifMatchRevision conflict detection returning `{ conflict: true, serverRevision }`
- [x] 2.4 Implement GET handler returning stored entry or 404, DELETE handler removing file or 404, and list endpoint scanning progress directory for all entries
- [x] 2.5 Implement `POST import-local` endpoint with dryRun mode, idempotent deduplication by (series, story, clientId, lastReadAt), and write mode that creates progress files

## 3. Backend Tests

- [x] 3.1 Create `plugins/reading-progress/backend_test.ts` with Hono testing client: auth tests (401 without passphrase, 401 wrong passphrase, 200 with correct)
- [x] 3.2 Add PUT validation tests: invalid series (empty, `..`, `/`, `\`, >128 chars) → 400, invalid story (empty, `..`, `/`, `\`, >128 chars, OS-reserved names) → 400, invalid payload (scrollRatio > 1, chapterIndex < 0, non-integer) → 400, oversized body → 413, invalid selectionAnchor → 400
- [x] 3.3 Add PUT success tests: first write → revision 1, second write → revision 2, serverUpdatedAt updates
- [x] 3.4 Add ifMatchRevision tests: matching → no conflict field, non-matching → conflict: true with serverRevision
- [x] 3.5 Add concurrent PUT test: Promise.all 50 PUTs → all 200, each revision unique in [1..50], final file revision === 50
- [x] 3.6 Add GET/DELETE/list tests: GET existing → 200, GET missing → 404, DELETE existing → 200, DELETE missing → 404, list returns all entries
- [x] 3.7 Add import-local tests: dryRun returns preview without writing, write mode creates files, idempotent re-import returns written: 0

## 4. Frontend Core

- [x] 4.1 Create `plugins/reading-progress/frontend.js` with plugin registration, settings check (enabled/storageBackend), hook subscriptions (chapter:dom:ready, chapter:dom:dispose, chapter:change, story:switch)
- [x] 4.2 Implement `makeThrottledSync(waitMs, putFn)` utility with leading+trailing strategy, `push()`, `flush()`, `cancel()` methods
- [x] 4.3 Implement scroll tracking in `chapter:dom:ready` handler: idempotent listener installation, throttled PUT via `putProgress()`, `lastEntryByIndex` Map maintenance, selectionAnchor capture (if trackSelectionAnchor enabled)
- [x] 4.4 Implement `chapter:change` handler: flush previousIndex from map (no DOM access), clear previous listeners
- [x] 4.5 Implement `chapter:dom:dispose` handler: flush pending progress for chapterIndex, remove scroll/resize/intersection listeners, clear lastEntryByIndex entry
- [x] 4.6 Implement visibility/lifecycle handlers: `visibilitychange → hidden` and `pagehide` → flushAll with keepalive, `story:switch` → flushAll + clear state
- [x] 4.7 Implement `putProgress()` network function with cachedRevision tracking, 401 one-time disable (stopSync flag)

## 5. Frontend Scroll Restoration

- [x] 5.1 Implement `restoreScroll(container, saved, settings)`: retainDays expiry check, identity guard (discard stale GET results), scrollRatio-based positioning
- [x] 5.2 Implement `findTextFragmentAnchor(container, anchor)`: TreeWalker text node search, prefix/textStart/textEnd/suffix matching per W3C Text Fragment spec, fallback to scrollRatio
- [x] 5.3 Implement restoration stabilization: ResizeObserver + img.onload + document.fonts.ready, 1.5s max retry window, user-scroll cancellation (once: true passive listener)
- [x] 5.4 Implement stale chapter index handling: clamp saved chapterIndex to chapters.length - 1 when out of range, show one-time notification, PUT corrected progress

## 6. Frontend Multi-device Conflict UX

- [x] 6.1 Implement pollOnFocus: GET on `visibilitychange → visible`, compare remote.revision vs cachedRevision
- [x] 6.2 Implement conflict dialog: cross-chapter detection → inline dialog with Jump/Stay buttons, same-chapter > 0.1 divergence → dismissible hint
- [x] 6.3 Implement anti-echo protection: `applyingRemote` flag, skip first scroll PUT after remote apply, cancel throttle once
- [x] 6.4 Implement configurable pollIntervalMs foreground polling (default 0 = disabled)

## 7. Frontend Settings & Import

- [x] 7.1 Implement settings panel: list all progress entries (call list endpoint), delete individual entry (call DELETE), display series/story/chapter/lastReadAt
- [x] 7.2 Implement "Import local progress" flow: read localStorage entries, POST import-local with dryRun:true → show preview dialog (N to write, M conflicts), on confirm → dryRun:false → update list

## 8. Spec Delta Application

- [x] 8.1 Update `openspec/specs/plugin-core/spec.md` to document plugin data directory convention (`${PLAYGROUND_DIR}/_plugins/<name>/`)
- [x] 8.2 Update `openspec/specs/plugin-core/spec.md` to clarify that registerRoutes paths MUST use `${basePath}` prefix for middleware inheritance

## 9. Integration Verification

- [x] 9.1 Run `deno task test` — all backend tests pass
- [x] 9.2 Run `deno task build:reader` — frontend bundle succeeds
- [x] 9.3 Run `scripts/podman-build-run.sh` — container builds and starts cleanly (no errors/warnings in logs)
- [x] 9.4 Verify PUT endpoint via curl: `curl -X PUT -H "X-Passphrase: ..." -H "Content-Type: application/json" -d '{"chapterIndex":3,"scrollRatio":0.42,"lastReadAt":"2025-01-15T00:00:00Z"}' localhost:8080/api/plugins/reading-progress/progress/demo-series/demo-story` → `{ ok: true, revision: 1 }`
- [x] 9.5 Verify auth: same request without X-Passphrase → 401
- [x] 9.6 Verify file created at `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/demo-series/demo-story.json`
- [x] 9.7 Two-tab manual test: tab A reads to chapter 3 → tab B refocuses → conflict dialog appears
