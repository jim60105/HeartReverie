## Context

The HeartReverie reader is a Vue 3 SPA. Two layout components share an identical sidebar-nav pattern: `SettingsLayout.vue` (~30 child routes) and `ToolsLayout.vue` (~5 child routes). Both flip `.sidebar-nav` from `flex-direction: column` to `flex-direction: row` at `@media (max-width: 767px)`. `SettingsLayout` omits `flex-wrap: wrap` and `overflow-x: auto` from the row variant — this is the root cause of the High-severity overflow (DOM-measured: `.sidebar-nav` = 2221 × 122 px, document scrollWidth = 2233 px on a 443 px viewport). `ToolsLayout` happens to include `flex-wrap: wrap` (`ToolsLayout.vue:123`) so it does not overflow today, but its row-flip pattern is fragile: any user adding more tools children would re-trigger the same risk, and a horizontal wrap-row is not a great mobile UX for either layout in the first place.

The reader top toolbar lives inside `AppHeader.vue` (the sticky `<header>` element). At viewports below ~410 px the chapter-nav cluster (`← 上一章`, `i / N`, `下一章 →`) plus the four icon buttons (`📖`, `🔄`, `🧰`, `⚙️`) exceed available width, with the rightmost button clipping at right=406 vs viewport=375 (measured at `/艾爾瑞亞/日常/chapter/1`). The existing `page-layout` spec already promises no overflow in 360–767 px range, so this is a behavioral defect: the spec is correct, the implementation isn't.

Project policy: 0 users in the wild → no backward compatibility / no migration concerns.

## Goals / Non-Goals

**Goals:**

- Settings tabs are reachable on a 375 × 812 phone without horizontal page scroll.
- Tools tabs follow the same drawer pattern as settings (consistency over divergence, even though Tools doesn't currently overflow).
- Reader top header does not introduce horizontal page scroll at viewports ≥ 360 px (matches existing spec promise).
- Drawer is keyboard accessible (ESC closes, focus trap while open, focus returned to toggle on close), screen-reader friendly (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`), and auto-closes on route navigation so the user lands on the new tab's content without a stale drawer overlay.
- Zero new dependencies. No new component libraries.

**Non-Goals:**

- A full hamburger global navigation. The existing `page-layout` requirement explicitly states "The header SHALL NOT render a `☰` hamburger button" — that promise is preserved. The new toggle button lives **inside** the SettingsLayout/ToolsLayout content area (not in the global AppHeader), and only on mobile widths.
- Persisting drawer open/closed state across navigation or reload — drawer always starts closed on (re)mount.
- Theming or animation polish beyond a basic 0.2 s slide-in transform.
- Touch swipe-to-open / swipe-to-close gestures (can be added later; not required to fix the reachability bug).
- Reworking the reader header beyond the icon-only label collapse. Cluster order, button set, and breakpoint at 767 px are unchanged.

## Decisions

### Decision 1: Drawer over scroll, dropdown, or `<select>`

- **Drawer (off-canvas vertical list with backdrop):** native-feeling on mobile, scales to 30+ items via internal scroll, doesn't change information architecture, accessible.
- ~~Horizontal scroll row with `overflow-x: auto`:~~ rejected — most tabs would still be hidden behind a single edge of horizontal scroll affordance that mobile users routinely miss.
- ~~`<select>` element:~~ rejected — would diverge from the desktop "vertical list of router-links with active-class highlighting" UX and breaks active-state visual continuity when resizing back to desktop without remount.
- ~~Dropdown menu:~~ rejected for the same reason as `<select>` — divergent affordance and harder to scan 30 items.

### Decision 2: Toggle button placement

- **Top-of-content-area icon button (`☰`)** rendered as a sibling of the `<router-view />` inside `SettingsLayout` / `ToolsLayout`. Visible only at `@media (max-width: 767px)`. Sized to be tap-target-friendly (≥ 40 × 40 px).
- This is **not** a header-level hamburger button (the existing `page-layout` `## Scenario: No hamburger button in header` requirement is preserved). The button is scoped to the layout component.

### Decision 3: Drawer mechanics

- Drawer is rendered always (CSS-driven open/close), not `v-if`'d, so animation is smooth and Vue state is preserved across opens. Closed state: `transform: translateX(-100%)` + `aria-hidden="true"` + `inert` attribute. Open state: `transform: translateX(0)` + `aria-hidden="false"`.
- Width: `min(280px, 80vw)` so phones at 360 px still see content beneath the drawer edge and can tap the backdrop to close.
- Backdrop: full-viewport `<div>` with `position: fixed; inset: 0; background: rgba(0,0,0,0.4)`, click closes drawer.
- ESC keydown on `document` while drawer is open → close.
- After `router.afterEach` fires for any route inside the layout, close the drawer (so tapping a tab navigates AND dismisses the overlay).
- Focus trap implementation: simple — on open, focus the first router-link; on TAB / SHIFT+TAB at boundaries, wrap. On close, return focus to the toggle button.

### Decision 4: Reader header label collapse (Issue 4)

- Add `@media (max-width: 409px)` rule inside `AppHeader.vue`'s style block that hides the text label spans inside the prev/next chapter buttons, leaving only the arrow glyphs. Implementation can be either a `.label` span with `display: none` at narrow widths, or `font-size: 0` on the text node with the arrow as a `::before` pseudo-element. Prefer the explicit `<span class="nav-label">` + `display: none` approach — clearer and easier to test from outside the component.
- The 410 px cutoff is chosen because 411 px and above already fit on the measured device (`mobile-03-reader.png` at 443 px shows the row fitting cleanly; the overflow only appears below ~410 px).
- The breakpoint is **deliberately narrower than** the existing `767 px` mobile breakpoint so the desktop UX is unchanged and 443-px-wide phones still see the labels.

### Decision 5: Consistency for ToolsLayout

- Apply the same drawer pattern to `ToolsLayout.vue` even though it doesn't overflow today. Rationale: two layouts that look identical on desktop should look identical on mobile; bug-prevention against future tool additions; reuses one composable.
- Factor the drawer logic into a small composable `useSidebarDrawer` so both layouts share open/close + ESC + auto-close-on-route + focus-trap, with only the link list / toggle button slot differing per layout.

## Risks / Trade-offs

- **Risk:** drawer auto-close on route change is normally desired, but if a future child route registers as a nested router-view that re-uses the SettingsLayout (it doesn't today), the drawer would close prematurely. Mitigated by listening to `router.afterEach` and only closing if the matched parent layout name changed OR the path moved within the same layout family — easier rule: just always close on any route change while drawer is open, and accept the minor cost in edge case.
- **Trade-off:** moving to a drawer-with-toggle adds one tap to reach a new settings tab on mobile (tap toggle → tap tab) versus the broken status quo (scroll horizontally → tap tab). The extra tap is acceptable because the status quo is unreachable for most tabs.
- **Risk:** focus trap implementation bugs (e.g. trapping focus when drawer is closed). Mitigated by `inert` attribute + `aria-hidden="true"` when closed and unit tests that assert focus location after open/close cycles.
- **Risk:** the 410 px breakpoint for label collapse is empirical. If a future device or text-scaling combination overflows at, say, 420 px, this requirement remains technically met (because the spec scopes the audit to 360–767 px at default scaling) but the user would still see clipping. Mitigation: re-audit at common phone sizes (360, 375, 390, 412, 414, 428) before sign-off.
- **Trade-off:** rendering the drawer always (not `v-if`) means `RouterLink` instances stay mounted on desktop too, where they're visible as the static vertical sidebar. That's actually the existing behavior, just with `transform: none` always — no regression.
