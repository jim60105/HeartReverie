## Why

On settings pages the sidebar navigation (`#settings-drawer`) and the per-tab content (`<main class="settings-content">`) currently share a single document scrollbar: the whole `.settings-layout` is `min-height: 100vh` with no overflow cap, so when either column's content exceeds the viewport the user must scroll the whole page. This makes long sidebar lists (general tabs + plugin tabs + developer-tools tabs) push the content off-screen and vice versa, and the active tab indicator scrolls out of view while the user reads the content. The same issue applies to `ToolsLayout.vue` (`#tools-drawer` + `<main class="tools-content">`). On desktop especially, where both panels are visible side by side, they should scroll independently like every other modern settings UI (VS Code, GitHub, GitLab).

## What Changes

- Constrain `SettingsLayout`'s `.settings-body` (and `ToolsLayout`'s `.tools-body`) to the viewport height below the sticky `<header>`, so its own height is `calc(100dvh - var(--header-height))` instead of growing with content.
- Make the desktop sidebar (`#settings-drawer` / `#tools-drawer` aside) `overflow-y: auto; min-height: 0` so a long tab list scrolls within the sidebar only. The back-to-reader button and tab list together form the scroll container; no element above it scrolls.
- Make the content `<main>` (`.settings-content` / `.tools-content`) `overflow-y: auto; min-height: 0` so settings pages with long forms (e.g. plugin settings, prompt editor, lore editor) scroll within the main column only.
- Apply the root viewport cap unconditionally (both mobile and desktop) — the mobile `<aside>` drawer is `position: fixed` and escapes the new `overflow: hidden` on `.settings-body`, so the overlay behaviour and `outside-click` close still work as before. On mobile this moves the page scrollbar from the document body into `.settings-content`; the visible region is unchanged (sticky header still pinned, content still reaches the same depth). This matches what the existing `:has(.editor-page)` rule already did on the prompt-editor route.
- Keep the sticky page header (`AppHeader.vue`) on screen at all times regardless of which column the user scrolls.
- Document the scroll-container guarantee in the `settings-page` and `tools-menu` spec capabilities and add scenarios covering both columns scrolling independently and the no-double-scrollbar invariant.

No backward-compatibility or migration concerns — pre-release, no users.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `settings-page`: add a requirement that the desktop drawer and content area scroll independently within the viewport-constrained `.settings-body`, with the sticky header always visible.
- `tools-menu`: add the equivalent requirement for `ToolsLayout`'s drawer and content area.
- `page-layout`: clarify that on `/settings/*` and `/tools/*` routes the document SHALL NOT introduce a body-level vertical scrollbar (the body fits the viewport; scrolling happens inside the two columns).

## Impact

- **Code:** `reader-src/src/components/SettingsLayout.vue` (scoped style), `reader-src/src/components/ToolsLayout.vue` (scoped style). No template or script changes expected — pure CSS adjustments to existing class selectors. The sticky-header CSS variable `--header-height` already exists and is updated by `AppHeader`'s ResizeObserver, so the math works on resize and theme/font changes.
- **Tests:** add a small Vitest case asserting the computed styles for `.settings-body`, `#settings-drawer`, and `.settings-content` (mirroring existing `SettingsLayout` tests) plus the `tools-*` counterparts. Optionally add an agent-browser visual verification (long lore list + long prompt-editor form on a 1280×720 viewport: scrolling lore list does not move the prompt editor, and vice versa; header stays put).
- **Specs:** delta files for the three capabilities above. No new capabilities.
- **Risk:** low. The change is CSS-only on container elements that already exist. Edge cases to think about: very short content (must not introduce empty scrollbar gutters — use `overflow-y: auto`, not `scroll`); `min-height: 0` propagation through the flex chain; iOS Safari 100dvh support (acceptable — Vite/Vue browserslist already targets modern evergreen). Drawer-as-overlay on mobile must keep working unchanged.
