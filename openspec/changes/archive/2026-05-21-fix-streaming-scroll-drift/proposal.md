## Why

The earlier change `preserve-chapter-content-dom-during-streaming` stopped
the v-html token list from remounting on every streaming chunk, but readers
still report the page scrolling away from where they are while the LLM
streams. Two surviving causes were identified by manual testing:

1. **`reading-progress` plugin re-restores scroll on every chunk.** Its
   `chapter:dom:ready` handler runs once per dispatch, and the engine still
   fires that hook on every commit (intentionally, so plugins can re-walk
   text). Each dispatch re-applies the saved `scrollRatio`, and
   `restoreScroll`'s 1.5 s `ResizeObserver` keeps re-applying it on every
   subsequent layout shift — exactly what the streaming chunks produce.
2. **`ContentArea` rewrites the sidebar on every chunk.** Its panel-
   relocation watch detects the growing chapter text as a content change,
   clears `sidebar.innerHTML`, and re-appends the (typically identical)
   plugin panels. On single-column / mobile layouts the sidebar is below the
   chapter, so its height contributes to document height — clearing then
   refilling it makes the page briefly collapse and then expand again,
   dragging the reader's scroll position along.

Together these produce the user-visible symptom of the viewport drifting
away from the reading position, sometimes back to a saved scroll ratio
and sometimes just floating during the height oscillation.

## What Changes

- **`reading-progress` plugin** — `chapter:dom:ready` handler becomes
  idempotent per `(container, chapterIndex)` pair. The first dispatch for a
  given chapter container still restores scroll and attaches the scroll
  listener; subsequent dispatches for the same chapter (the streaming
  re-dispatch path) only refresh `currentIdentity` and otherwise return
  early. Real chapter changes (different `chapterIndex` on the same
  container, or new container) still cleanup-and-redo as before. Applies to
  both `initLocalMode` and `initFileMode`.
- **`ContentArea` sidebar relocation** — before clearing
  `sidebar.innerHTML`, compare the candidate panels' joined `outerHTML`
  against the panels already in the sidebar. If they match, just remove the
  duplicates from the content area and leave the sidebar DOM untouched. The
  rest of the relocation policy (different content with new panels →
  full re-population; content change with no panels → clear) is unchanged.
- **No public-API changes** for plugins or core composables; the engine
  still dispatches `chapter:dom:ready` on every commit so plugins that
  legitimately need per-chunk walks (e.g. `dialogue-colorize`) keep working.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `reading-progress`: `chapter:dom:ready` handler MUST be idempotent on
  re-dispatch for the same chapter container; only the first dispatch per
  `(container, chapterIndex)` restores scroll or attaches scroll
  listeners.
- `vue-component-architecture`: `ContentArea` sidebar-relocation watch
  MUST preserve the existing sidebar DOM when the candidate panels in the
  content area have the same `outerHTML` as the panels already in the
  sidebar, dropping the candidate panels from the content area instead of
  rewriting the sidebar.

## Impact

- **Frontend code**:
  - `plugins/reading-progress/frontend.js` — two `chapter:dom:ready`
    handler bodies (one in `initLocalMode`, one in `initFileMode`) get an
    idempotency guard keyed on `(container, chapterIndex)`. The
    `containerState` record now carries `chapterIndex`.
  - `reader-src/src/components/ContentArea.vue` — sidebar-relocation watch
    fingerprints candidate panels' `outerHTML` against panels already in
    `<Sidebar>`; identical → drop duplicates from content only, leave
    sidebar DOM untouched; different → clear and relocate (regardless of
    whether `currentContent` changed).
- **Tests** (all in place — see tasks.md section 4):
  - `reader-src/src/__tests__/plugins/reading-progress-idempotency.test.ts`
    — two consecutive `chapter:dom:ready` dispatches for the same
    container + chapterIndex restore scroll only once; a third dispatch
    with a different chapterIndex re-arms restoration.
  - `reader-src/src/components/__tests__/ContentArea.test.ts` — a
    streaming-style content bump with identical panel HTML preserves the
    sidebar's child node identity (positive idempotency test) and a
    chapter-change bump with different panel HTML clears + re-relocates
    the fresh panel (negative test).
- **No backend changes.**
- **No new dependencies.**
- **No backward compatibility** considerations per repo policy (pre-release,
  zero external users). The behavioural change is strictly a relaxation of
  redundant work; existing semantics for real chapter navigation, plugin
  panel updates, and edit/cancel-edit are preserved.
