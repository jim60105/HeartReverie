## Why

The UI/UX audit at `tmp/uiaudit/REPORT.md` documented two real mobile defects in the core engine:

1. **HIGH — `/settings/*` is mostly unreachable on phones.** `SettingsLayout.vue`'s `@media (max-width: 767px)` block flips `.sidebar-nav` to `flex-direction: row` without `flex-wrap` or `overflow-x: auto`, so the 30+ settings tabs lay out in a single ~2221 px row. The whole document then widens to ~2233 px on most settings pages (`hScroll: true`), pushing the majority of nav tabs off-screen and requiring horizontal page scroll to reach them.
2. **MEDIUM — Reader top toolbar clips at viewports ≤ ~410 px.** At 375 px the `← 上一章` / `下一章 →` text labels push the rightmost button (`下一章 →`) past the viewport edge (measured: `docw=406`, `vw=375`). This violates the existing `page-layout` requirement that promises no horizontal overflow in the 360–767 px range.

Both bugs surface on real mobile devices today. Fixing them is a prerequisite for usable mobile reading and configuration.

## What Changes

- **Settings sidebar becomes an overlay drawer on mobile.** Replace the broken horizontal row flip with an off-canvas vertical drawer that the user opens by tapping a toggle button. Desktop layout (~200 px fixed sidebar) is unchanged. The same pattern is applied to `ToolsLayout` for consistency, even though it does not currently overflow.
- **Reader header chapter-nav buttons collapse to icon-only at narrow widths.** At viewports below 410 px, `← 上一章` and `下一章 →` SHALL render as `←` and `→` (label text hidden), preserving the existing single-row layout while eliminating the overflow. The progress indicator (`i / N`) and all other header controls are unchanged.
- A toggle button (e.g. `☰` icon-only button) is added to the `SettingsLayout` and `ToolsLayout` content header (mobile-only), with proper ARIA semantics, focus management, ESC-to-close, backdrop click-to-close, and auto-close on intra-section route navigation.
- **NOT BREAKING:** no API, route, or persisted-state change. CSS-only and template-only changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `settings-page`: The mobile representation of the sidebar changes from "horizontal row flip" (broken) to "vertical off-canvas drawer with toggle button". The desktop fixed-width sidebar is unchanged.
- `tools-menu`: The `ToolsLayout` mobile sidebar adopts the same off-canvas drawer pattern as the settings sidebar so the two layouts behave consistently.
- `page-layout`: The reader top header at viewports below 410 px renders `← 上一章` and `下一章 →` as icon-only `←` and `→` to satisfy the existing no-overflow / no-wrap promise.

## Impact

- **Affected components:** `HeartReverie/reader-src/src/components/SettingsLayout.vue`, `HeartReverie/reader-src/src/components/ToolsLayout.vue`, `HeartReverie/reader-src/src/components/AppHeader.vue` (or whichever component owns the chapter-nav cluster — to be confirmed in design).
- **Affected styles:** the `@media (max-width: 767px)` blocks in both layout components are rewritten; a new `@media (max-width: 410px)` block is added for the header chapter-nav label collapse.
- **Affected behavior:** users on phones can now reach every settings/tools tab; the reader header no longer clips on narrow phones.
- **No backend changes.** No route, prop, or persisted-state changes. No new dependencies.
- **Testing:** existing Vitest unit tests for `SettingsLayout` / `ToolsLayout` continue to assert desktop behavior; new tests cover drawer open/close + auto-close on route change. Browser-level overflow re-verified via `agent-browser` at 375 × 812, 443 × 920, and 1451 × 790 inside the container.
