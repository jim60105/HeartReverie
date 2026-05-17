## ADDED Requirements

### Requirement: Progress PUT endpoint

The plugin SHALL expose `PUT /api/plugins/reading-progress/progress/:series/:story` that accepts a JSON body with fields: `chapterIndex` (non-negative integer), `scrollRatio` (number 0–1), `lastReadAt` (valid ISO 8601 date string), optional `selectionAnchor` (TextFragmentAnchor object or null), optional `clientId` (string), and optional `ifMatchRevision` (non-negative integer). The endpoint SHALL validate all fields and return `400` for invalid input. Request body SHALL NOT exceed 4096 bytes (return `413`).

#### Scenario: Valid PUT creates progress file

- **WHEN** a valid PUT is sent with `chapterIndex: 3`, `scrollRatio: 0.42`, `lastReadAt: "2025-01-15T00:00:00Z"`
- **THEN** the server SHALL return `200` with `{ ok: true, revision: 1, serverUpdatedAt: "<ISO timestamp>" }` and create a JSON file at `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/<series>/<story>.json`

#### Scenario: Subsequent PUT increments revision

- **WHEN** a second valid PUT is sent to the same `(series, story)`
- **THEN** the server SHALL return `revision: 2` with an updated `serverUpdatedAt`

#### Scenario: Invalid series name rejected

- **WHEN** PUT is sent with `series` containing `..`, `.`, empty string, or exceeding 128 characters
- **THEN** the server SHALL return `400` with `{ error: "invalid_identity" }`

#### Scenario: Invalid story name rejected

- **WHEN** PUT is sent with `story` containing `..`, `.`, `/`, `\`, empty string, or exceeding 128 characters
- **THEN** the server SHALL return `400` with `{ error: "invalid_identity" }`

#### Scenario: Path traversal in series or story rejected

- **WHEN** PUT is sent with `series` or `story` containing path traversal sequences, `.` (bare dot), or OS-reserved names
- **THEN** the validation SHALL reject the input and return `400` with `{ error: "invalid_identity" }`

#### Scenario: Invalid payload rejected

- **WHEN** PUT is sent with `scrollRatio: 1.5` or `chapterIndex: -1` or non-integer `chapterIndex`
- **THEN** the server SHALL return `400` with `{ error: "validation_error", detail: "<reason>" }`

#### Scenario: Oversized body rejected

- **WHEN** PUT body exceeds 4096 bytes
- **THEN** the server SHALL return `413` with `{ error: "payload_too_large" }`

#### Scenario: selectionAnchor validation

- **WHEN** PUT is sent with `selectionAnchor.textStart` exceeding 32 characters or missing `textStart`
- **THEN** the server SHALL return `400` with `{ error: "validation_error", detail: "selectionAnchor is invalid or fields exceed 32 chars" }`

### Requirement: Conflict detection via ifMatchRevision

The PUT endpoint SHALL support optimistic concurrency via `ifMatchRevision`. When `ifMatchRevision` is provided and does not equal the current stored `revision`, the server SHALL still write the new progress (last-writer-wins) but include `conflict: true` and `serverRevision` in the response. The `serverRevision` value SHALL be the newly written revision (post-write), not the pre-existing one.

#### Scenario: ifMatchRevision matches

- **WHEN** PUT includes `ifMatchRevision: 5` and stored revision is `5`
- **THEN** the server SHALL return `{ ok: true, revision: 6 }` without `conflict` field

#### Scenario: ifMatchRevision does not match

- **WHEN** PUT includes `ifMatchRevision: 3` and stored revision is `5`
- **THEN** the server SHALL return `{ ok: true, revision: 6, conflict: true, serverRevision: 6 }` (write still succeeds per LWW semantics)

### Requirement: Strict-monotonic revision counter

The server SHALL maintain a per-`(series, story)` in-process mutex (async lock) ensuring that concurrent PUT requests produce strictly increasing revision numbers with no duplicates. Under 50 concurrent PUTs, the final file SHALL have `revision === 50` and each response SHALL contain a unique revision in `[1..50]`.

#### Scenario: Concurrent PUT produces strictly monotonic revisions

- **WHEN** 50 concurrent PUT requests are sent to the same `(series, story)`
- **THEN** all 50 SHALL return `200`, each with a distinct `revision` value, and the stored file SHALL have `revision: 50`

#### Scenario: Process restart preserves monotonicity

- **WHEN** the server restarts and the first PUT occurs
- **THEN** the server SHALL read the existing file's `revision` to reseed the in-memory counter, producing `revision: previous + 1`

### Requirement: Atomic file writes

All file writes SHALL use a unique temporary file name (`${file}.${randomUUID}.tmp`) followed by `Deno.rename` (POSIX atomic rename) to prevent corruption under concurrent access.

#### Scenario: Concurrent writes do not corrupt file

- **WHEN** two PUT requests race on the same file
- **THEN** the final file SHALL be valid JSON containing one complete entry (the last rename wins)

### Requirement: Progress GET endpoint

The plugin SHALL expose `GET /api/plugins/reading-progress/progress/:series/:story` returning the stored progress entry as JSON, or `null` (with HTTP 200) if none exists. This avoids browser console "Failed to load resource" noise from 404 responses on normal first-visit fetch calls.

#### Scenario: GET existing progress

- **WHEN** GET is sent for a `(series, story)` with stored progress
- **THEN** the server SHALL return `200` with the full stored entry including `revision`, `serverUpdatedAt`, and all client fields

#### Scenario: GET non-existent progress

- **WHEN** GET is sent for a `(series, story)` with no stored progress
- **THEN** the server SHALL return `200` with `null` body

### Requirement: Progress DELETE endpoint

The plugin SHALL expose `DELETE /api/plugins/reading-progress/progress/:series/:story` that removes the stored progress file and returns `200 { ok: true }`. Deleting non-existent progress SHALL return `404`.

#### Scenario: DELETE existing progress

- **WHEN** DELETE is sent for existing progress
- **THEN** the server SHALL remove the file and return `200 { ok: true }`

#### Scenario: DELETE non-existent progress

- **WHEN** DELETE is sent for non-existent progress
- **THEN** the server SHALL return `404`

### Requirement: Progress list endpoint

The plugin SHALL expose `GET /api/plugins/reading-progress/progress` returning an array of all stored progress entries (or an empty array if none exist).

#### Scenario: List all progress entries

- **WHEN** GET is sent to the list endpoint with multiple stored entries
- **THEN** the server SHALL return `200` with an array containing all entries

### Requirement: Import local progress endpoint

The plugin SHALL expose `POST /api/plugins/reading-progress/import-local` accepting `{ entries: ProgressEntry[], dryRun: boolean }`. In dry-run mode, it SHALL return `{ wouldWrite: N, conflicts: M, skipped: K }` without writing. In write mode, it SHALL persist entries and return `{ written: N, conflicts: M, skipped: K }`. The endpoint SHALL be idempotent — re-sending the same payload with `dryRun: false` SHALL return `written: 0`.

A **conflict** is defined as an existing stored entry for the same `(series, story)` with a different `clientId` or `lastReadAt`. In write mode, conflicts are resolved by last-writer-wins (import overwrites). **Skipped** entries are those where stored `(series, story, clientId, lastReadAt)` already matches the import entry exactly (idempotency). Each written entry SHALL receive a new server-assigned `revision` and `serverUpdatedAt`. Invalid entries (missing required fields) SHALL be skipped with a count in `skipped`.

#### Scenario: Dry-run import preview

- **WHEN** POST is sent with `dryRun: true` and 5 new entries
- **THEN** the server SHALL return `200 { wouldWrite: 5, conflicts: 0, skipped: 0 }` without creating any files

#### Scenario: Write import persists entries

- **WHEN** POST is sent with `dryRun: false` and 5 new entries
- **THEN** the server SHALL create 5 progress files and return `{ written: 5, conflicts: 0, skipped: 0 }`

#### Scenario: Idempotent re-import

- **WHEN** the same payload is sent again with `dryRun: false`
- **THEN** the server SHALL return `{ written: 0, conflicts: 0, skipped: 5 }`

### Requirement: Authentication via passphrase middleware

All reading-progress endpoints SHALL be mounted under `/api/plugins/reading-progress/` which inherits the global passphrase middleware. Requests without a valid `X-Passphrase` header SHALL receive `401`.

#### Scenario: Missing passphrase returns 401

- **WHEN** PUT is sent without `X-Passphrase` header
- **THEN** the server SHALL return `401`

#### Scenario: Valid passphrase allows access

- **WHEN** PUT is sent with correct `X-Passphrase` header
- **THEN** the server SHALL process the request normally

### Requirement: Frontend scroll tracking

The frontend module SHALL subscribe to `chapter:dom:ready` and install a throttled scroll listener on `window` (the actual page scroll container, since `.chapter-content` has `overflow: visible`). The throttle interval is configurable via `syncIntervalSeconds` setting (default 5s). The throttle SHALL use trailing strategy. Each scroll event SHALL update an in-memory `lastEntryByIndex` map keyed by chapter index. Text fragment anchor lookup SHALL use the `ctx.container` element (where chapter text nodes reside).

#### Scenario: Scroll triggers throttled PUT

- **WHEN** user scrolls within a chapter
- **THEN** the frontend SHALL send at most one PUT per `syncIntervalSeconds` interval with current `chapterIndex`, `scrollRatio`, `lastReadAt`, and optional `selectionAnchor`

#### Scenario: Idempotent dom:ready

- **WHEN** `chapter:dom:ready` fires twice for the same container
- **THEN** only one scroll listener SHALL be active (previous one removed)

### Requirement: Chapter change flush

On `chapter:change`, the frontend SHALL immediately flush the pending progress for `previousIndex` from the in-memory map (bypassing throttle). The flush SHALL NOT access the DOM (which already shows the new chapter).

#### Scenario: Chapter switch flushes previous chapter

- **WHEN** `chapter:change` fires with `previousIndex: 2`
- **THEN** the frontend SHALL immediately PUT the last known entry for chapter 2

### Requirement: Chapter dispose cleanup

On `chapter:dom:dispose`, the frontend SHALL flush pending progress for `ctx.chapterIndex`, remove all scroll/resize/intersection listeners and observers attached to the container, and clear the corresponding entry from `lastEntryByIndex`.

#### Scenario: Dispose flushes and cleans up

- **WHEN** `chapter:dom:dispose` fires with `chapterIndex: 4`
- **THEN** pending progress for chapter 4 SHALL be flushed, all listeners/observers on that container SHALL be removed, and no memory leaks SHALL remain for that chapter

### Requirement: Stale chapter index handling

When scroll restoration detects that `saved.chapterIndex >= chapters.length` (the saved chapter no longer exists), the frontend SHALL clamp to `chapters.length - 1`, display a one-time notification ("Original chapter no longer exists, jumped to last chapter"), and immediately PUT the corrected progress.

#### Scenario: Saved chapter beyond available range

- **WHEN** stored progress has `chapterIndex: 10` but the story only has 8 chapters
- **THEN** the frontend SHALL clamp to chapter 7, show a notification, and PUT corrected progress with `chapterIndex: 7`

### Requirement: Visibility and page lifecycle sync

On `visibilitychange → hidden` and `pagehide`, the frontend SHALL call `flushAll()` sending all pending entries via `fetch(..., { keepalive: true })`. On `story:switch`, the frontend SHALL `flushAll()` then clear all in-memory state.

#### Scenario: Tab hidden triggers flush

- **WHEN** the browser tab becomes hidden
- **THEN** all pending progress entries SHALL be sent with `keepalive: true`

### Requirement: Scroll restoration on mount

On `chapter:dom:ready`, the frontend SHALL `GET` the stored progress. If the response is non-null and `saved.chapterIndex` differs from the current chapter, the frontend SHALL show a cross-chapter navigation dialog (or auto-navigate if `confirmRemoteJump` is false). If `saved.chapterIndex` matches the current chapter, it SHALL restore scroll position on `document.scrollingElement` using: (1) Text Fragment anchor lookup if available, (2) `scrollRatio` fallback. Restoration SHALL use ResizeObserver + `document.fonts.ready` for stabilization with a 1.5s maximum retry window. User scroll SHALL immediately cancel restoration.

#### Scenario: Restore scroll from ratio

- **WHEN** mount completes and saved progress has `scrollRatio: 0.5` for current chapter
- **THEN** the container SHALL scroll to `(scrollHeight - clientHeight) * 0.5`

#### Scenario: User scroll cancels restoration

- **WHEN** user manually scrolls during the restoration window
- **THEN** restoration attempts SHALL stop immediately

#### Scenario: Expired progress not restored

- **WHEN** `lastReadAt` exceeds `retainDays` setting
- **THEN** scroll restoration SHALL NOT be applied

### Requirement: Multi-device conflict detection

On `visibilitychange → visible` (when `pollOnFocus` is true), the frontend SHALL `GET` current progress. If `remote.revision > cachedRevision` and `remote.chapterIndex > local.chapterIndex`, it SHALL display an inline dialog offering to jump to the remote chapter. If `confirmRemoteJump` setting is false, it SHALL jump silently.

#### Scenario: Remote chapter ahead with confirmation

- **WHEN** remote progress shows `chapterIndex: 5` while local is at `chapterIndex: 2` and `confirmRemoteJump: true`
- **THEN** an inline dialog SHALL appear: "You read to Chapter 5 on another device. Jump there?" with [Jump] and [Stay] options

#### Scenario: Remote chapter ahead without confirmation

- **WHEN** same condition but `confirmRemoteJump: false`
- **THEN** the reader SHALL navigate to chapter 5 silently

#### Scenario: Same chapter minor divergence

- **WHEN** remote progress differs only in `scrollRatio` by more than 0.1 within same chapter
- **THEN** a dismissible hint SHALL appear (not a blocking dialog)

### Requirement: Anti-echo protection

After applying a remote progress update, the frontend SHALL set an `applyingRemote` flag and skip the next scroll-triggered PUT (cancel throttle once) to prevent echoing the remote state back to the server.

#### Scenario: Applied remote not re-sent

- **WHEN** remote progress is applied (scroll restored to remote position)
- **THEN** the first subsequent scroll event SHALL NOT trigger a PUT

### Requirement: 401 one-time disable

If any PUT receives `401`, the frontend SHALL permanently disable sync for the remainder of the page session (no further PUT/GET attempts) to avoid spamming failed requests.

#### Scenario: 401 stops all sync

- **WHEN** a PUT returns `401`
- **THEN** no further network requests SHALL be made by the plugin

### Requirement: Settings schema

The plugin SHALL expose a settings schema with the following configurable fields: `enabled` (boolean, default true), `syncIntervalSeconds` (number 1–60, default 5), `storageBackend` (enum "file"|"local", default "file"), `pollOnFocus` (boolean, default true), `pollIntervalMs` (number 0–600000, default 0), `confirmRemoteJump` (boolean, default true), `retainDays` (number 1–3650, default 90), `trackSelectionAnchor` (boolean, default true).

#### Scenario: storageBackend local mode

- **WHEN** `storageBackend` is set to `"local"`
- **THEN** the frontend SHALL use only localStorage (no network requests)

#### Scenario: Disabled plugin

- **WHEN** `enabled` is `false`
- **THEN** the plugin SHALL not subscribe to any hooks or make any network requests

### Requirement: Settings page progress management (DEFERRED)

The plugin frontend SHALL provide exported utility functions `collectLocalEntries()` and `importLocalToServer(options)` for future use by a settings panel. A full settings panel UI with per-entry deletion and import flow is DEFERRED until the engine provides a custom settings panel extension point. The utility functions SHALL be available as named ESM exports from the frontend module.

#### Scenario: collectLocalEntries reads localStorage

- **WHEN** `collectLocalEntries()` is called
- **THEN** it SHALL return an array of all `reading-progress:*` entries from localStorage with `series`, `story`, `chapterIndex`, `scrollRatio`, `lastReadAt`, and `clientId` fields

#### Scenario: importLocalToServer calls import endpoint

- **WHEN** `importLocalToServer({ dryRun: true })` is called
- **THEN** it SHALL collect local entries and POST to `/import-local` with `dryRun: true`, returning the server response

### Requirement: Plugin manifest

The plugin manifest (`plugin.json`) SHALL declare `type: "full-stack"`, `frontendModule: "./frontend.js"`, `backendModule: "./backend.ts"`, and a `settingsSchema` matching the settings schema requirement. It SHALL NOT declare `promptFragments` or `tags`.

#### Scenario: Manifest validates successfully

- **WHEN** the plugin manager loads `reading-progress/plugin.json`
- **THEN** it SHALL pass schema validation and register both backend routes and frontend module

### Requirement: Privacy and data lifecycle

All progress data SHALL be stored exclusively in `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/`. No telemetry SHALL be sent. The README SHALL document that deleting the `_plugins/reading-progress/` directory removes all progress data, and SHALL prominently warn that multiple users sharing one passphrase will overwrite each other's progress.

#### Scenario: Complete data removal

- **WHEN** user deletes `${PLAYGROUND_DIR}/_plugins/reading-progress/` directory
- **THEN** all reading progress data SHALL be permanently removed
