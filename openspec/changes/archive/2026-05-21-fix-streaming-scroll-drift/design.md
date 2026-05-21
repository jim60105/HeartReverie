## Context

The earlier change `preserve-chapter-content-dom-during-streaming` split
`renderEpoch` into a notification counter and a remount token, which kept
the `v-html` token list stable across streaming chunks. However, two
downstream consumers of `renderEpoch` still react destructively on every
chunk and reintroduce scroll drift:

- `plugins/reading-progress/frontend.js` registers a `chapter:dom:ready`
  handler that, on every dispatch, restores scroll from saved state and
  starts a 1.5 s `ResizeObserver` window that re-applies the saved scroll
  on every layout shift — and streaming chunks ARE layout shifts.
- `reader-src/src/components/ContentArea.vue` runs a panel-relocation
  watch that treats every change in chapter text as a chapter switch and
  rewrites `<Sidebar>` from scratch, briefly collapsing the sidebar
  column. On stacked layouts this collapses document height and shifts
  scroll.

The earlier change's spec already aspirationally promised that "Streaming
bumps do not destroy already-relocated sidebar panels", but the
implementation only guarded against *duplicate* panels appearing while the
sidebar already had panels — it still fell into the
`contentChanged || !sidebarHasPanels` full-rewrite branch whenever the
chapter text grew, which is *every* streaming chunk.

## Goals / Non-Goals

**Goals:**

- Eliminate the observable scroll drift during LLM streaming for both
  desktop (two-column) and stacked (mobile) layouts.
- Keep the existing semantics for chapter navigation, edit/cancel-edit,
  plugin settings changes, and async plugin registration intact.
- Keep `chapter:dom:ready` dispatch frequency the same — plugins like
  `dialogue-colorize` rely on per-commit walks to maintain Highlight
  ranges.
- Apply the fix in the engine repository only; no changes in
  `HeartReverie_Plugins/`.

**Non-Goals:**

- Removing or rate-limiting the engine-side `chapter:dom:ready` dispatch.
- Changing the streaming pipeline, WebSocket protocol, or the
  `commitContent` / `renderEpoch` contract.
- Reworking the `reading-progress` plugin's storage backend, polling, or
  multi-device conflict logic.
- Re-architecting the `<Sidebar>` column layout.

## Decisions

### Decision 1 — Idempotency in `reading-progress` is keyed on `(container, chapterIndex)`

The plugin already keeps a `WeakMap<HTMLElement, state>` of per-container
state, so the natural fix is to attach `chapterIndex` to that record and
short-circuit on re-dispatch for the same chapter container.

**Alternatives considered:**

- *Skip when `currentIdentity` already matches*: rejected because identity
  is a single mutable record shared across containers; if multiple
  ChapterContent instances ever existed (mounted/unmounted in quick
  succession during HMR or test) the guard would misfire.
- *Listen for a new `chapter:dom:streaming` hook and skip restore on it*:
  rejected because it would require a new public hook stage, a new
  context shape, and updates to every plugin that wants to opt out —
  significant scope for what is a plugin-local issue.
- *Track via a generation counter on the container*: rejected — adds a
  separate map keyed off the same container, redundant with the existing
  `containerState`.

### Decision 2 — `ContentArea` uses `outerHTML` equality as the panel-content fingerprint, with a transient-placeholder safety branch

The watch already filters candidate panels (those in content but not yet
in sidebar). Before falling into the full-rewrite branch, we now join the
candidate panels' `outerHTML` and compare against the already-in-sidebar
panels' `outerHTML`:

- *Fingerprints match* → streaming chunk re-rendered the *same* panels.
  Drop the duplicates from content, leave the sidebar alone. (Eliminates
  the height oscillation.)
- *Fingerprints differ AND `currentContent` changed (or sidebar empty)*
  → real navigation / edit / fresh mount. Clear sidebar and relocate.
- *Fingerprints differ AND `currentContent` unchanged* → transient
  re-render state where a plugin's panel placeholder appeared in content
  before the plugin's frontend-render hook re-injected its full HTML.
  Drop the candidate from content and leave the populated sidebar panel
  in place; the next commit will either match the fingerprint or be
  driven by a real `contentChanged`.

**Alternatives considered:**

- *Hash the panel HTML*: equivalent outcome but adds a hashing dependency
  and another failure mode (collision). The panel count is small (1–3 in
  practice) so direct string comparison is cheap.
- *Tag panels with a stable `data-panel-id` and compare those*: would
  require buy-in from every plugin that produces a sidebar panel —
  outside the scope of an engine-side fix.
- *Tighten `contentChanged` to ignore growth-only changes*: rejected —
  growth-only is hard to detect generically (text edits in the middle
  during a save look the same), and the rule has the side effect of
  *also* not clearing stale panels when content truly changed but the
  panel render happens to be the same string.

### Decision 3 — Both fixes ship together as one change

The two fixes target different layers (plugin code vs core SPA) but
address one user-facing symptom: scroll moves during streaming. Splitting
them would force a partial state where one fix is live and the other
isn't, leaving the scroll bug only half-fixed in either order. Single
change keeps the test surface coherent.

## Risks / Trade-offs

- **[Risk] A plugin that mutates its already-sidebar-resident panel
  in-place between chunks** would not see the new HTML get relocated (it
  would already be in sidebar, so the equality check passes and content
  panels get dropped). → *Mitigation:* this is the desired behaviour;
  in-place mutation should be reflected in the sidebar DOM directly,
  not re-relocated. No known current plugin does this.
- **[Risk] If a plugin renders a panel whose `outerHTML` is identical
  across chapters** (e.g. a static "Tips" widget keyed on plugin name
  only), it would NOT be re-relocated on chapter change. → *Mitigation:*
  chapter change unmounts `<ChapterContent>` → dispatches
  `chapter:dom:dispose` → re-mounts with a fresh wrapper, so the
  `chapterIndex` mismatch in `reading-progress` and a fresh
  `prevContentKey` in `ContentArea` both re-trigger the full path. The
  equality short-circuit only fires within the same chapter's lifetime.
- **[Trade-off] `outerHTML` serialization is O(n) in panel DOM size each
  commit.** In practice n is tiny (status panel is ~30 nodes) and
  streaming commit cadence is on the order of 10/sec, so this is
  immaterial.
- **[Trade-off] Adding `chapterIndex` to the `WeakMap` value couples
  identity-tracking and lifecycle state.** The combined record is still
  small and local to the file; the alternative (parallel map) is messier.

## Migration Plan

Not applicable — pre-release, zero external users, no API changes.
