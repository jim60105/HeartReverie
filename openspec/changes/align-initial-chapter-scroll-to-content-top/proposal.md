# Align initial chapter scroll to content top

## Why

When a reader navigates to (or reloads) a chapter URL, the reading area should start with the **chapter container itself** at the top of the visible content area — the user should immediately see the `.chapter-toolbar` (the "編輯 / 倒回至此 / 從此分支" row) sitting flush beneath the sticky page header, followed by the chapter body.

Today the page often loads with the toolbar already scrolled out of view. The browser does not perform an auto-scroll on its own (there is no router `scrollBehavior`, no `scrollIntoView()` call in the engine, no hash anchor); the offset is produced entirely by the `reading-progress` plugin's scroll-restoration path.

**Root cause.** `captureTextFragmentAnchor()` walks the chapter container's text nodes top-down (`TreeWalker` over `ctx.container`, which is `.chapter-content`) and records the first text node with `text.length >= 4` whose rect overlaps the current viewport. That walker descends through **every** descendant of `.chapter-content`, including the button labels inside `.chapter-toolbar` (e.g. "倒回至此", "從此分支", "加入書籤"). Even when the reader is at `scrollEl.scrollTop === 0`, the captured anchor's absolute document position lands somewhere inside the toolbar (or in the first paragraph of the body), at `y ≈ 60–120 px`. On the next mount, `restoreScroll()` sets `scrollEl.scrollTop = anchorAbsTop`, which pins the anchor's text node to viewport `y = 0` — pushing both the toolbar **and** the chapter container's top edge above the viewport, behind the sticky header.

Reproduced empirically on `/櫻帝學園/日常/chapter/2` against the running container:

- Initial state at chapter mount with no scroll: `window.scrollY === 0`; `.chapter-content.getBoundingClientRect().top === 40` (i.e. the container starts immediately below the 40-px sticky header); `.chapter-toolbar.top === 56`. This is the desired layout.
- Save: `window.scrollTo(0, 0)`, wait ≥ the throttle interval for the PUT to flush, then reload.
- Restored: `window.scrollY === 77`; `.chapter-content.top === -37`; `.chapter-toolbar.top === -21`. Both the toolbar and the chapter container's top edge are now hidden behind the sticky header.

The fix is to teach the `reading-progress` plugin that "the reader was at the top of the chapter" is a semantic state and must be restored as **no scroll mutation at all** — i.e. `scrollEl.scrollTop === 0`, which is the natural document position that places `.chapter-content` flush beneath the sticky header (as confirmed by the initial-state measurement above). A stored `selectionAnchor` SHALL NOT override this; an anchor is meaningful only when the reader actually scrolled away from the top.

This is a pre-release project with **no users in the wild and no migration concerns**, so we can change the behaviour for already-stored progress files without a compatibility shim or rewrite step.

## What Changes

### Behaviour

1. **"At the top" snap (restore-side).** When the saved entry's resolved scroll target — converted to pixels via `saved.scrollRatio * max(1, scrollEl.scrollHeight - window.innerHeight)` — is **less than 1 pixel**, `restoreScroll()` SHALL ignore any saved `selectionAnchor` and SHALL leave `scrollEl.scrollTop` at its current value (which, on a fresh chapter mount, is `0`). The 1-pixel threshold is an absolute-pixel tolerance for floating-point noise around zero; it does NOT scale with chapter length, so a reader who was genuinely 0.4 % into a 50,000-pixel chapter (`savedTop ≈ 200 px`) still gets a precise anchor / ratio restore.
2. **Capture-side guard (forward-compatible cleanup).** `captureTextFragmentAnchor()` SHALL return `null` when `scrollEl.scrollTop === 0` at the moment of capture. No anchor is semantically meaningful at the absolute top of the document. The throttled PUT in this case SHALL persist `selectionAnchor: null` alongside `scrollRatio: 0`, so subsequent restores hit the snap branch above directly without an anchor-resolution detour.
3. **Local-mode parity.** The localStorage-backed restore path (`initLocalMode`) SHALL apply the same "at the top" snap behaviour: when `saved.scrollRatio * maxScroll < 1`, the localStorage restore SHALL skip the `scrollEl.scrollTop = …` mutation.
4. **Existing safeguards preserved.** The ResizeObserver stabilisation window, the 1.5-s timer, the user-scroll cancel listener, the per-`(container, chapterIndex)` streaming idempotency guard, and the cross-chapter dialog branch are all unchanged. Mid-chapter precise restores (anchor lookup or `scrollRatio` fallback) continue to land the saved position at the viewport's top edge exactly as today.
5. **No engine-side changes.** The router, MainLayout, ContentArea, and ChapterContent components remain plugin-agnostic; no `scrollIntoView()` or hash-based mechanism is introduced.

### Code

- `plugins/reading-progress/frontend.js`:
  - `restoreScroll()` — add a snap branch at the top of the function: compute `savedTop = (saved.scrollRatio ?? 0) * Math.max(1, scrollEl.scrollHeight - window.innerHeight)`; when `savedTop < 1`, set `targetTop = null` for the anchor branch, skip the ratio fallback, and `return` early without mutating `scrollEl.scrollTop`.
  - `captureTextFragmentAnchor(container)` — add an early `if (getScrollElement().scrollTop === 0) return null;` before the TreeWalker loop.
  - `initLocalMode()` — gate the existing `scrollEl.scrollTop = saved.scrollRatio * maxScroll` assignment behind `if (saved.scrollRatio * maxScroll >= 1)`.

### Specs

- `reading-progress`: MODIFY the existing `Requirement: Scroll restoration on mount` to incorporate the "at the top" snap branch and the capture-side guard, and add scenarios that observe the toolbar's visibility against the sticky header.

## Impact

- **Affected specs:** `reading-progress` (MODIFIED — one requirement gains the snap and capture-guard clauses and three new scenarios).
- **Affected code:** `plugins/reading-progress/frontend.js` only. No backend changes, no manifest changes, no other plugin touched.
- **Affected tests:** existing `reading-progress-*` Vitest files; any assertion that hard-codes a non-zero post-restore `scrollTop` for a `scrollRatio: 0` save needs updating to "no scroll mutation".
- **User-visible impact:** On every chapter reload where the reader was at the chapter's top, the toolbar is visible immediately below the sticky page header. Deep-scroll restores (`scrollRatio ≥ 1 px worth`) are unchanged. Cross-chapter navigation prompts are unchanged.
- **Backward compatibility / migration:** None required (pre-release, zero users). Already-stored progress files that have a `selectionAnchor` saved at `scrollRatio === 0` are simply ignored by the new snap branch.
