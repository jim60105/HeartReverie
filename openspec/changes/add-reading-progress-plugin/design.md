## Context

HeartReverie is a single-user (single-passphrase) interactive fiction engine running as a single Deno process. Story content is served through a Vue 3 SPA reader; the backend proxies LLM calls and manages file-based storage under `${PLAYGROUND_DIR}/`. The plugin system supports full-stack plugins with backend routes (Hono), frontend hooks (chapter lifecycle events), and user-configurable settings via JSON schema.

Currently, no mechanism exists to persist or restore reading position. Users lose their place on page reload, device switch, or browser crash. The `chapter-bookmark` plugin (in the sibling `HeartReverie_Plugins` repo) provides localStorage-only bookmarks but has no server sync capability.

This plugin will live in the core repo (`plugins/reading-progress/`) because it provides a fundamental reader UX capability that should ship with the engine by default.

## Goals / Non-Goals

**Goals:**

- Seamless cross-device reading continuity using server-synced progress (chapter index + scroll position + text anchor)
- Automatic scroll restoration on story open, with stabilization for lazy-loaded images/fonts
- Multi-device conflict detection with user-friendly inline dialog UX
- Strict-monotonic server revision counter ensuring deterministic last-writer-wins semantics under concurrent writes
- Zero LLM cost impact (no prompt fragments, no tag participation)
- Settings page with progress management (list/delete) and localStorage migration

**Non-Goals:**

- Multi-user isolation (engine has single passphrase; explicitly documented as limitation)
- Reading history/analytics panel (deferred to future A14.5 proposal)
- WebSocket/SSE push for real-time sync (polling on focus is sufficient for single-user)
- Offline-first with full conflict resolution (simple LWW is adequate for single-user)
- Syncing to external services (e.g., cloud storage, third-party APIs)

## Decisions

### D1: Storage — File-based JSON, not SQLite

**Choice**: One JSON file per `(series, story)` at `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/<series>/<story>.json`.

**Rationale**: Consistent with engine conventions (all data is file-based); trivially portable with `playground/` backup; no new runtime dependency. The access pattern (single key lookup/write) doesn't benefit from a database.

**Alternatives considered**: SQLite (rejected: adds `--allow-ffi` dependency complexity, overkill for key-value access), localStorage-only (rejected: no cross-device sync).

### D2: Concurrency — In-process mutex + strict-monotonic revision

**Choice**: Per-`(series, story)` async mutex (Promise chain) with `max(in-memory counter, file.revision) + 1` on every write. Atomic file write via unique-temp-name + `Deno.rename`.

**Rationale**: HeartReverie runs as a single Deno process (no horizontal scaling). In-process mutex is sufficient and avoids file-lock complexity. Strict-monotonic revision enables clients to deterministically detect stale state.

**Alternatives considered**: File-level advisory locks (rejected: OS-dependent, Deno support inconsistent), optimistic concurrency with retry (rejected: adds client complexity without benefit given single-process guarantee).

### D3: Text Fragment Anchor — W3C spec subset

**Choice**: Store `selectionAnchor` as `{ prefix?, textStart, textEnd?, suffix? }` following W3C Text Fragment URL specification. Frontend implements `findTextFragmentAnchor()` via TreeWalker.

**Rationale**: Provides sub-paragraph scroll precision for long chapters where `scrollRatio` alone is insufficient (ratio maps to ~5 chars at 10K-word chapters). The W3C spec is well-defined and handles disambiguation via prefix/suffix.

**Alternatives considered**: DOM element IDs (rejected: markdown rendering doesn't produce stable IDs), character offset (rejected: brittle to any content edit).

### D4: Frontend sync strategy — Throttled PUT + polling on focus

**Choice**: Throttled scroll listener (leading + trailing, configurable interval defaulting to 5s) with `PUT` on scroll/chapter-change/visibility-hidden. Poll on `visibilitychange → visible` and configurable interval (default: disabled).

**Rationale**: Balances network usage with sync freshness. The `keepalive: true` fetch flag ensures writes survive page unload for payloads < 64KB (ours is < 4KB).

**Alternatives considered**: WebSocket push (rejected: over-engineered for single-user), `beforeunload` only (rejected: unreliable on mobile).

### D5: Conflict UX — Inline dialog, not toast

**Choice**: When remote progress is ahead (different chapter), show an inline dialog: "You read to Chapter X on another device. Jump there?" with [Jump] / [Stay] buttons. Configurable via `confirmRemoteJump` setting.

**Rationale**: Cross-chapter jumps are disruptive; user should explicitly consent. Same-chapter divergence (|ΔscrollRatio| > 0.1) uses a dismissible hint instead.

### D6: Plugin location — Core repo `plugins/`

**Choice**: Ship in `HeartReverie/plugins/reading-progress/`, not the external `HeartReverie_Plugins/` repo.

**Rationale**: Reading progress is a fundamental reader UX feature expected by default. Placing it in core avoids requiring users to set up the optional plugins container image.

## Risks / Trade-offs

- **[In-memory counter lost on crash]** → First PUT after restart reads file to reseed counter. Gap in revision sequence is possible but harmless (monotonicity preserved). → Mitigation: `max(file, memory) + 1` formula handles all cases.
- **[No multi-user isolation]** → Documented limitation; users sharing a passphrase will overwrite each other's progress. → Mitigation: Prominent README warning. True isolation requires engine-level auth changes (out of scope).
- **[scrollRatio imprecision for very long chapters]** → ~5 character precision at 10K words. → Mitigation: `trackSelectionAnchor` (default: true) provides sub-paragraph precision via Text Fragment anchoring.
- **[DOM not stable at restore time]** → Images/fonts loading shifts scroll position. → Mitigation: ResizeObserver + font.ready + 1.5s retry window; user scroll cancels restoration immediately.
- **[Chapter renumbering]** → Deleted/reordered chapters make saved `chapterIndex` stale. → Mitigation: Clamp to `chapters.length - 1` with one-time toast notification; auto-PUT corrected position.
- **[localStorage migration is one-shot]** → If user declines, data stays in localStorage. → Mitigation: Import button remains available in settings; dry-run preview shows what would be written; idempotent backend.
