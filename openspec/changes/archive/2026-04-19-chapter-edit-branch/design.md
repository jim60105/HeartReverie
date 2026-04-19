## Context

HeartReverie stores each chapter as an independent `NNN.md` file inside a per-story directory (`playground/<series>/<story>/`). Chapter writes happen incrementally during LLM streaming: `writer/lib/chat-shared.ts` opens `NNN.md` before the SSE stream starts and appends each delta. Readers see partial content via WebSocket push (`chapters:content`) or 3 s HTTP polling. Only two mutation endpoints exist today: `DELETE /api/stories/:series/:name/chapters/last` and the implicit write performed by `POST .../chat`.

Stakeholders: authors running a single-user personal instance. There are zero production users to migrate, so backward compatibility is not required — but we still prefer additive changes to keep existing frontend code working during rollout.

Constraints:

- Single-process Deno server; in-memory coordination is sufficient (no Redis/DB).
- Must not conflict with the active-generation writer that appends to the latest chapter.
- Must preserve the streaming-read guarantee: pollers and WebSocket subscribers must never observe a torn write.
- Path safety is mandatory: all new handlers reuse `safePath()` and `validateParams` from `writer/lib/middleware.ts`.

## Goals / Non-Goals

**Goals:**

- Edit any existing chapter's content atomically via HTTP.
- Truncate a story at a chosen chapter ("rewind") in one call.
- Fork a story at a chosen chapter into a new story directory ("branch").
- Reject mutations that would race an active LLM generation on the same story.
- Push chapter list / content updates to other connected clients so their UIs refresh.
- Provide frontend affordances (edit / rewind / branch) on every chapter.

**Non-Goals:**

- No chapter reordering, insertion in the middle, or splitting one chapter into two.
- No undo/history beyond what branching already provides.
- No cross-series branching (branch always lands in the same series).
- No lore copy-on-branch of global/series-level lore (they remain shared; only story-scoped `_lore/` is copied with the branch).
- No chapter-level permissions or multi-user locking — single-user model is assumed.

## Decisions

### Decision 1: REST shape — per-chapter PUT, rewind as a separate DELETE, branch as POST

We expose:

- `PUT /api/stories/:series/:name/chapters/:number` — body `{ content: string }`. Returns `{ number, content }`.
- `DELETE /api/stories/:series/:name/chapters/after/:number` — removes every `NNN.md` where `N > :number`. Returns `{ deleted: number[] }`. Keeps the existing `.../chapters/last` endpoint working (it is a thin special case and is still used by the resend flow in `useChatApi`).
- `POST /api/stories/:series/:name/branch` — body `{ fromChapter: number, newName?: string }`. Returns `{ series, name, copiedChapters: number }`.

Alternatives considered:

- **Single `PATCH .../chapters` with an operation enum.** Rejected: harder to rate-limit / audit per operation, and diverges from the REST style already used in `writer/routes/chapters.ts`.
- **`POST .../rewind`** instead of `DELETE .../chapters/after/:number`. Rejected: the operation semantically deletes resources, so `DELETE` is the correct verb and the URL composes nicely with the existing chapter namespace.

### Decision 2: Atomic chapter writes via temp-file + rename

For both chapter edits and each file copy in the branch flow we:

1. Write the new bytes to `NNN.md.tmp-<crypto.randomUUID()>` in the **same directory** (so the rename is on the same filesystem).
2. `await Deno.rename(tmpPath, finalPath)` — POSIX rename is atomic on the same filesystem; the streaming reader either sees the old file or the new file, never a partial one.
3. On any failure between write and rename, delete the temp file in a `finally` block.

Alternatives considered:

- **In-place `Deno.writeTextFile`.** Rejected: truncates the file and the append-only streaming reader could observe an empty / short file.
- **Advisory `flock`.** Rejected: platform-specific on Windows/macOS and overkill for a single-process server; rename atomicity is sufficient.

### Decision 3: Per-story active-generation registry (in-memory refcount)

`writer/lib/chat-shared.ts` already owns the chat execution lifecycle. We add a module-level `Map<string, number>` keyed by `"<series>/<name>"` that tracks the number of generations currently streaming into that story. `executeChat()` increments the refcount before opening the SSE stream and decrements it in a `finally` block (covering success, error, and abort paths); when the refcount would drop to zero, the key is deleted from the map. The edit and rewind handlers call a new helper `isGenerationActive(series, name)` — which returns `true` iff the key is present and its value is `> 0` — and return `409 Conflict` (Problem Details) if so. Branch is allowed during generation because it only reads the source story, but it must copy chapters with a stable snapshot (see Decision 4).

The refcount is required because two overlapping generations on the same story are possible (e.g., a second chat is started before the first has fully ended). A plain `Set<string>` would let the first generation's `finally` clear the key while the second is still actively writing, which would incorrectly unblock an edit or rewind mid-stream.

Alternatives considered:

- **File-system sentinel.** Rejected: needs cleanup on crash; in-memory is simpler and the server restart already resets state.
- **Serialize all mutations through an async queue.** Rejected: more complexity than needed for two endpoints; the registry gives precise, low-latency rejection.

### Decision 4: Branch is a cold copy with a snapshot guard

Branch flow:

1. Validate `newName` with `isValidParam()` (reject reserved `_`-prefixed names, traversal, empty strings). Generate `<story>-branch-<Date.now()>` if absent.
2. `Deno.mkdir` the destination (`playground/<series>/<newName>/`) with `{ recursive: false }`. If it already exists → `409 Conflict`.
3. List source chapters with the shared `listChapterFiles(dir)` helper, filter to `number <= fromChapter`.
4. For each file, read bytes and write via the atomic temp-file + rename pattern into the destination.
5. After all chapters succeed, if the source story contains a `_lore/` subdirectory, recursively copy it to the destination so the branch is self-contained.
6. If any step fails, best-effort remove the destination directory (`Deno.remove(dest, { recursive: true })`).

If the last (Nth) chapter is being streamed while we branch AND the user's `fromChapter` equals N, we explicitly copy the content at read-time — this yields a snapshot at whatever offset the file currently has, which matches user expectation ("branch from what I just saw"). Stream continues writing to the source file only.

### Decision 5: Lore handling on branch

Global (`playground/_lore/`) and series (`playground/<series>/_lore/`) lore are shared by reference — they're not under the story directory and remain untouched. Story-scoped lore (`playground/<series>/<story>/_lore/`) IS copied into the branch so the branch is fully independent for story-level passages. This matches the scoping model documented in `docs/lore-codex.md` and avoids data divergence for higher-scope lore.

### Decision 6: WebSocket fan-out via existing polling

There is no shared subscriber registry in the current server: WebSocket chapter updates are driven by per-connection server-side polling (see `writer/routes/ws.ts` — the `subscribe` message starts a 1-second `setInterval` on that connection that watches the story's directory for chapter-count and last-chapter-content changes and pushes `chapters:updated` / `chapters:content` accordingly).

We therefore do NOT introduce a `broadcastToStory()` helper. Instead, the edit and rewind handlers rely on the existing polling mechanism: after the atomic rename or file deletion completes, each subscriber's 1-second poller will observe the change within ≤1 s and push the appropriate `chapters:updated` (rewind — count changed) or `chapters:content` (edit of the last chapter — content changed) message on its own. Edits to a non-last chapter will not trigger the content watcher (it only tracks the latest chapter), which matches current behavior; clients that need to refresh arbitrary chapters can fall back to HTTP reload. Branch does not require notification — the new story has no subscribers yet, and the frontend will navigate to it explicitly.

### Decision 7: Frontend composable split

We add `reader-src/src/composables/useChapterActions.ts` exposing `editChapter`, `rewindAfter`, `branchFrom`. `useChapterNav` stays focused on navigation; actions are orchestrated separately so a new `ChapterContent.vue` toolbar can invoke them and then call `useChapterNav.reloadToLast()` / a new `reloadKeepingIndex()` helper. This avoids coupling navigation state to mutation logic and keeps tests focused.

Alternatives considered:

- **Fold actions into `useChapterNav`.** Rejected: that composable is already ~440 LOC and mixes FSA / backend / WebSocket concerns; adding three more API calls would push it past readability.

## Risks / Trade-offs

- **Rename atomicity is filesystem-dependent** → Mitigation: documented requirement that `PLAYGROUND_DIR` lives on a POSIX-compatible filesystem; the container image already uses ext4/overlayfs. Windows hosts are not a supported deployment target.
- **In-memory generation registry is lost on server restart** → Mitigation: acceptable — a restart kills the SSE stream anyway; stale partial chapters are already a pre-existing reality. Edits after restart are unblocked, which is the correct behavior.
- **Branch during active streaming could include a half-written last chapter** → Mitigation: documented behavior ("branch captures the current on-disk state"); the user can rewind-after in the branch if unhappy. Adding a full generation-wait would block the UI for long periods.
- **Directory name collision on auto-generated branch name (same millisecond)** → Mitigation: `Date.now()` + retry once with `Date.now()` after a 1 ms await; beyond that, surface `409 Conflict`.
- **Edit removes content a plugin's `promptStripTags` would strip anyway** → Trade-off accepted: the edit API stores exactly what the client sends; plugin stripping still runs at prompt-assembly time.
- **Frontend edit UI is markdown-agnostic (plain textarea)** → Trade-off: ships as a simple textarea first; a richer editor can land later without changing the API contract.

## Migration Plan

- No data migration needed — all existing stories remain valid.
- Deploy backend and frontend together. The new endpoints are additive; the old frontend ignores them harmlessly.
- Rollback: revert the commit. No on-disk schema change to undo.

## Open Questions

- Should the rewind endpoint also accept `DELETE .../chapters/after/0` to clear all chapters? Current plan: yes, it's a natural consequence. Validated during spec review.
- Should edits be recorded in `llm-interaction-log` for audit parity with generation? Current plan: out of scope; editing is a human action and the logger targets LLM traffic.
