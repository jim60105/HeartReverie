# Design — align-initial-chapter-scroll-to-content-top

## Context

The reading area's vertical layout is:

```
<header position:sticky top:0 height:40px>   ← --header-height
<div class="content-wrapper">                 ← document scrolls
  <div class="chapter-content">               ← ctx.container, overflow:visible, padding:0 1rem
    <div class="chapter-toolbar">             ← first child: 編輯 / 倒回至此 / 從此分支 / …
    <div v-html="…body…">                     ← second child: rendered markdown
    <div v-html="…body…">                     ← (possibly more)
  <aside class="sidebar"> …
```

The document scrolls; `.chapter-content` itself has `overflow: visible`. The reading-progress plugin therefore operates on `document.scrollingElement` for `scrollTop` and on `ctx.container` (`.chapter-content`) for text-node walking.

Empirically measured against the running container at chapter mount with no prior progress:

```
scrollY                                       = 0
.chapter-content.getBoundingClientRect().top  = 40   (== --header-height)
.chapter-toolbar.getBoundingClientRect().top  = 56
first body div.getBoundingClientRect().top    = 115
```

This is the desired post-restore state: the chapter container sits flush beneath the sticky header, the toolbar is at `y = 56`, the body begins at `y = 115`.

After save-at-top then reload, observed state is:

```
scrollY                                       = 77
.chapter-content.top                          = −37
.chapter-toolbar.top                          = −21
```

The 77-pixel offset is the absolute document position of the **first qualifying text node inside `.chapter-content`** at the moment of capture. `captureTextFragmentAnchor()` uses `document.createTreeWalker(container, NodeFilter.SHOW_TEXT)` which descends through every descendant — including the button labels inside `.chapter-toolbar`. Button labels like `倒回至此`, `從此分支`, `加入書籤` all satisfy `text.length >= 4`, so the captured anchor is whichever toolbar-button text node first overlaps the viewport. On restore, `scrollEl.scrollTop = anchorAbsTop = 77` places that text node at viewport `y = 0`, hiding everything visually above it (the rest of the toolbar and the container's top edge) behind the sticky header.

## Goals

- After a chapter reload taken while the reader was at the top of the chapter, the toolbar is visible immediately below the sticky page header — i.e. the natural `scrollY === 0` state.
- Deep-scroll restores (e.g. mid-chapter saved positions) continue to land the saved anchor or ratio at the viewport's top edge — that path is intentionally precise and unchanged.
- No regression to the streaming idempotency, cross-chapter dialog, multi-device polling, user-scroll-cancel, or ResizeObserver stabilisation behaviours.

## Non-goals

- We do not change the `scrollRatio` semantics, the `selectionAnchor` schema, the PUT/GET endpoints, or any persisted field name.
- We do not introduce a header-aware offset via CSS `scroll-margin-top` or by computing `containerAbsTop − headerHeight`. The desired top-of-chapter target is `scrollEl.scrollTop === 0` — the natural document position — and that is the simplest expressible target. Any header-aware math would re-introduce a coupling between the plugin and the engine's header layout.
- We do not migrate or rewrite already-stored progress files.

## Decisions

### Decision 1 — Snap target is "no scroll mutation" (`scrollEl.scrollTop` left untouched), not `containerAbsTop`

**What.** When the snap branch fires, `restoreScroll()` returns early without touching `scrollEl.scrollTop`.

**Why.** A fresh chapter mount lands with `scrollEl.scrollTop === 0` because the engine does not scroll on navigation. `0` is exactly the natural state where `.chapter-content` begins at viewport `y = 40` (immediately below the sticky header) — confirmed by the empirical measurement above. Setting `scrollEl.scrollTop = containerAbsTop` (= 40) would scroll the document by 40 px, which would slide `.chapter-content` up to viewport `y = 0` — behind the sticky header. "No mutation" is simpler, header-agnostic, and visually correct.

**Alternatives considered.**

- *Snap to `containerAbsTop − headerHeight`.* Equivalent to `0` in the current layout (`40 − 40 == 0`), but introduces a coupling to the `--header-height` CSS variable that the plugin would have to read. Rejected for the engine-agnostic property.
- *Snap to `containerAbsTop` (clamped to `≥ 0`).* Hides the toolbar behind the header. Rejected as incorrect.
- *Hard-clamp every restore target to `≤ containerAbsTop`.* Would break deep-scroll restoration: a reader who was 50 % through a long chapter would be snapped back to the chapter top on every reload. Rejected.

### Decision 2 — Pixel-based threshold, not ratio-based

**What.** The snap branch fires when `saved.scrollRatio * max(1, scrollEl.scrollHeight - window.innerHeight) < 1`. Equivalently: when the saved entry decodes to a sub-pixel scroll target.

**Why.** A ratio threshold like `< 0.005` scales with chapter length: in a 100,000-pixel chapter it snaps anything under 500 px, which is multiple paragraphs of legitimate progress. A pixel threshold of `< 1 px` only catches floating-point noise around `0` — which is exactly the population the snap branch is meant to handle. Anything ≥ 1 px is treated as a real scroll position and uses the precise anchor / ratio path.

**Implementation note.** Capture writes `scrollRatio = scrollTop / max(1, scrollHeight - innerHeight)`. When `scrollTop === 0`, this is exactly `0 / X = 0` (no floating-point error). The `< 1 px` check therefore covers both the exact-zero case and any future capture path that might produce sub-pixel rounding.

**Alternatives considered.**

- *`scrollRatio === 0` exact.* Sufficient for the current capture path but brittle against any future capture path that might produce sub-pixel rounding (e.g. a save dispatched via `requestAnimationFrame` mid-rubber-band on iOS).
- *`scrollRatio < 0.005`.* Rejected per the long-chapter analysis above.

### Decision 3 — Capture-side guard at the exact `scrollEl.scrollTop === 0` boundary

**What.** `captureTextFragmentAnchor()` early-returns `null` when `scrollEl.scrollTop === 0`; otherwise it walks the container as before.

**Why.** Capture is forward-compatibility cleanup: we want future PUTs to write `selectionAnchor: null` when the reader is at the top, so future restores never have to consult the snap branch via the anchor-then-discard path. The exact `=== 0` boundary is the right asymmetry vs. the `< 1 px` restore threshold: capture is conservative (only skip when the user is unambiguously at the top), restore is forgiving (snap whenever the decoded target is sub-pixel).

**Alternatives considered.**

- *`scrollEl.scrollTop < some-small-pixel-value` on the capture side.* Adds no value — restore-side already handles sub-pixel cases.

### Decision 4 — Mirror the snap branch in `initLocalMode()`

**What.** The `initLocalMode()` restore path gains the same `savedTop < 1` skip.

**Why.** The MODIFIED Requirement applies to scroll restoration on mount irrespective of storage backend (`storageBackend: "file"` vs. `"local"`). Keeping the two paths symmetrical avoids two-mode drift.

**Alternatives considered.**

- *Extract a shared `computeRestoreTarget()` helper.* Considered, but the local-mode path doesn't use anchors at all — there's only one mutation site to gate, so a single `if` is clearer than a helper.

### Decision 5 — No engine-side changes

**What.** The router, MainLayout, ContentArea, and ChapterContent.vue do not gain any scroll-control code.

**Why.** Adding `scrollIntoView()` in `ChapterContent.vue`'s `onMounted` would fight the plugin's restore (the plugin runs at hook priority `50` on `chapter:dom:ready`, which fires after `onMounted`). Scroll-position logic stays consolidated in the plugin.

## Risks

- **R1 — A chapter whose body begins with content that pushes the first text node below `containerAbsTop + headerHeight`.** Not relevant to the fix: the snap branch fires based on the saved ratio, not on the anchor's resolved position, so the bug-causing path is short-circuited before the anchor lookup runs.
- **R2 — Header height changes responsively (e.g. taller header on mobile).** Not a concern: the snap target is "no mutation", which works regardless of header height as long as the engine does not pre-scroll on navigation (which it does not).
- **R3 — A future engine change that DOES pre-scroll on chapter mount.** Would surface as the plugin no longer "snapping to 0" but leaving a non-zero pre-scroll in place. Mitigation: out of scope for this change; would require revisiting Decision 1.

## Open questions

None.
