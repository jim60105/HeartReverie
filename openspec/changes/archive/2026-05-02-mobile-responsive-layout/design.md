# Design: Mobile-responsive header layout

## Context

A live audit at 443 × 792 (iPhone 14 Pro Max CSS-px width) of every reader page surfaced exactly one user-visible regression: the sticky `<header>` wraps onto two rows because it carries nine elements (`📖`, breadcrumb, `🔄`, `⚙️`, `⇇`, `← 上一章`, `i / N`, `下一章 →`, `⇉`, plus a no-op `☰`) and the breadcrumb alone consumes roughly half the row. Layout under the header (welcome screen, chapter content, plugin sidebar, chat input, settings pages) already works correctly because the existing `@media (max-width: 767px)` rules in `ContentArea.vue` collapse the grid to a single column.

Empirically measured at 443 px:

| Header height (px) | Layout | Notes |
|---|---|---|
| ~90 | wrapped onto 2 rows | `← 上一章` is partially clipped at the left edge of row 2 |

After this change:

| Header height (px) | Layout | Notes |
|---|---|---|
| ~32 | single row | `📖 🔄 ⚙️ ← 上一章 i / N 下一章 →` |

## Goals / Non-Goals

### Goals
- Header fits in a single row at a 443 px viewport with no clipping.
- Desktop (≥ 768 px) renders identically to the current build — same buttons, same order, same paddings.
- Remove a dead `mobileMenuOpen` ref and `.hamburger-btn` button so they cannot mislead future contributors or users.

### Non-Goals
- Restructuring chat input / plugin sidebar placement on mobile (deliberately out of scope; the existing column-stack already works and `chat-input/spec.md` forbids fixed positioning).
- Fixing third-party / user-installed plugins that paint extra DOM (e.g. `scene-info-sidebar`'s left vertical rail).
- Adding a true mobile drawer / off-canvas menu (would re-introduce the hamburger meaningfully but is unnecessary once the header fits).

## Decisions

### Decision 1 — CSS-only mobile gating with explicit `flex-wrap: nowrap`
Hide `.folder-name`, `⇇`, and `⇉` via `@media (max-width: 767px)` `display: none` rather than via `v-if="isMobile"` on a JS-derived ref. In the same media-query block, force `.header-row { flex-wrap: nowrap; }`.

- **Why CSS, not JS:** The existing breakpoint in `ContentArea.vue` already uses `@media (max-width: 767px)`. Using the same media query keeps the breakpoint single-sourced (in CSS), avoids `window.matchMedia` watchers / SSR concerns, and means resize from desktop to mobile applies instantly without Vue reactivity. The buttons keep their event handlers and `aria-label`s on the desktop path; nothing changes structurally.
- **Why 767px (not 768):** matches the existing `ContentArea.vue` `@media (max-width: 767px)` rule character-for-character. The two media queries SHOULD agree so the header collapse and the content single-column collapse trigger at the exact same viewport width.
- **Why `flex-wrap: nowrap` matters:** the *only* reason today's header wraps onto a second row at 443 px is `.header-row { flex-wrap: wrap }` (the desktop default needed when nothing is hidden). Even after hiding the breadcrumb and the two boundary buttons, the remaining controls' accumulated width may exceed the available row width at narrower phone widths (390, 375, 360 px), under accessibility-zoomed font sizes, or when the chapter progress indicator widens to e.g. `123 / 200`. Forcing `nowrap` makes any future regression visually obvious (an overflow / clipped button on the agent-browser smoke run) instead of silently re-wrapping into a tall header. The smoke-test step in `tasks.md` validates the layout at 443, 390, 375, and 360 px.

### Decision 2 — Hard-delete the hamburger, do not wire it up
The hamburger button has been dead since at least the page-layout consolidation that removed the per-page side menus. Two paths considered:

- (A) Wire the hamburger to toggle a real off-canvas drawer holding `StorySelector`, settings link, and chat input.
- (B) Delete it.

Chose **(B)**. The header at 443 px already exposes 📖 (story selector), ⚙️ (settings), and chapter-nav directly. A drawer would duplicate those entry points without solving any user problem. Re-introducing the hamburger if a future "settings drawer" feature actually needs one is cheap (5-line addition in this same component).

### Decision 3 — Hide `⇇` / `⇉` instead of merging with `←` / `→`
Considered: rendering only `⇇` (which itself jumps to first) instead of `← 上一章`, repurposing the icon button. Rejected because:

- The icon `←` vs `⇇` semantic distinction (single step vs jump-to-end) is already established and tested.
- Hiding the icon-only boundary buttons keeps the desktop spec untouched and only adds two scenarios per direction.
- The `1 / N` progress indicator + ←/→ remain visible, so the user keeps both linear navigation and an at-a-glance position read-out.

### Decision 4 — Keep the existing `padding: 4px 8px` from the prior header-padding work
No padding tweak in this change. The recent header-padding consolidation already brought every header / story-selector button to `padding: 4px 8px`, which is a comfortable touch target at mobile (32 px high). Tightening further would jeopardise touch usability without giving meaningful width back.

### Decision 5 — Treat jsdom unit tests as structural guardrails, not responsive verification
jsdom does not evaluate flex layout, real font metrics, or scoped CSS media queries; mocking `window.matchMedia` does not cause `@media` rules to apply. Therefore the unit-test layer in this change asserts *structure* only:

- the hamburger element / `mobileMenuOpen` ref is gone,
- the breadcrumb is rendered in the desktop default path,
- the two boundary buttons carry the `header-btn--boundary` class hook,
- the component's `<style>` block contains the mobile media-query rule referencing `.folder-name`, `.header-btn--boundary`, and `.header-row { flex-wrap: nowrap }`.

The authoritative responsive verification is the agent-browser smoke step which exercises the real browser engine at 443, 390, 375, and 360 px viewports. If the project later adds a Playwright-based browser-test runner, the smoke-test assertions documented in `tasks.md` should migrate there.

## Risks / Trade-offs

- **Breadcrumb context loss on mobile.** Users on phones lose at-a-glance "which series / story am I on?" Mitigation: the `📖` glyph still expands the StorySelector, which always shows the current series + story in its dropdown labels. Acceptable — desktop still shows the breadcrumb verbatim.
- **`⇇` / `⇉` reachability on mobile.** A user who genuinely needs to jump to chapter 1 of a 200-chapter story has to click `← 上一章` repeatedly. Acceptable trade-off given the audience — phone reading is typically linear; desktop power-users keep both buttons.
- **Pure CSS hide vs structural removal.** `display: none` removes the elements from layout *and* from the accessibility tree (DOM nodes remain queryable but assistive tech does not see them). This is the desired behaviour: a screen-reader user on mobile should not navigate to a button that is intentionally not available. The desktop UX is unaffected because `display: none` only applies inside the `@media (max-width: 767px)` block.

## Migration Plan

None required — pre-release, 0 users.

## Open Questions

None.
