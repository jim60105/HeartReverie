# Design — independent-settings-scroll

## Context

The current `SettingsLayout.vue` / `ToolsLayout.vue` shells use `min-height: 100vh` on the root and let `.settings-body` / `.tools-body` grow naturally. As a result, when either the sidebar or the routed content exceeds the viewport the document body itself scrolls and the sticky header is the only "fixed" thing — the two columns scroll together. There is already a route-scoped hack in `reader-src/src/styles/base.css` (`.settings-layout.settings-layout:has(.editor-page) { height: 100dvh; min-height: 0; overflow: hidden; }`) that caps the layout only on `/settings/prompt-editor`, which proves the approach works but limits the fix to one route via a fragile `:has()` selector. We want every settings and tools route to behave like that and want the cap to live in the component's own scoped style rather than a global rule that has to fight specificity.

## Approach

A pure CSS change inside `SettingsLayout.vue` and `ToolsLayout.vue` scoped styles, plus removal of the dead `:has(.editor-page)` block in `base.css`. No template, script, composable, or router changes.

The viewport-cap math relies on the fact that both layouts already render `<AppHeader>` as the first child of their flex column root, followed by `.settings-body` / `.tools-body` as the second child. So `.settings-body` (and `.tools-body`) automatically fills `100dvh - <header height>` once we:

1. Cap the root to `100dvh` (declaring `100vh` first as fallback for browsers without `dvh`).
2. Set `min-height: 0` on the root to neutralize any inherited `min-height: 100vh` from descendant rules.
3. Keep the root `display: flex; flex-direction: column` (already present) so `.settings-body` (`flex: 1`) gets the remaining vertical room.
4. Add `min-height: 0; overflow: hidden` to `.settings-body` so its children can shrink to fit and a scrollbar cannot escape upward.
5. Add `overflow-y: auto; min-height: 0` to the desktop `.settings-sidebar` (the existing `<aside id="settings-drawer">`) and `.settings-content` (`<main>`).
6. Gate the rules so the mobile drawer (which uses `position: fixed`) is unaffected. The simplest gate is `@media (min-width: 768px)` for steps 5 (since on mobile `.settings-sidebar.is-mobile` is fixed-positioned and already self-scrolls when open) and to apply the root cap unconditionally (the route still benefits from a viewport cap on mobile — the existing `:has(.editor-page)` rule already did this; we're matching that).

Both layouts get the same treatment, parallel scoped CSS blocks. We delete the route-scoped `:has(.editor-page)` rule from `base.css`.

### Browser support

`dvh` units have universal modern-evergreen support (Chrome 108+, Safari 15.4+, Firefox 101+); Vite's default browserslist already targets that. We declare `height: 100vh` first as a fallback so older engines fall back gracefully (slight overscroll on mobile is acceptable — this matches the existing `base.css` hack).

### Why CSS-only

The behavior we need is purely visual / layout — no state, no Vue reactivity. Putting it in scoped CSS:

- co-locates the cap with the layout it constrains, so future refactors of `SettingsLayout` carry the cap with them;
- avoids global stylesheet specificity wars (the existing `:has()` hack already shows how fragile that gets);
- means no JS overhead (no `ResizeObserver`, no `useMediaQuery` needed for this — `@media` queries are enough since the mobile drawer is already breakpoint-gated).

## Decisions

### Decision 1: Cap `.settings-layout` to `100dvh` unconditionally (both mobile and desktop)

The mobile content area today scrolls inside the document body. After the cap, on mobile the content area must scroll inside `.settings-content` instead. This is a small behavioural change on mobile but it's a strict improvement: the sticky `<AppHeader>` already stays pinned on mobile (it's `position: sticky; top: 0`), and capping the layout simply means the body scrollbar moves to `.settings-content`. There is no degradation in reachable content, and the mobile drawer (which is `position: fixed`) is untouched.

**Alternative considered**: cap only at `≥ 768 px` via `@media`. Rejected because (a) it would leave mobile in the inconsistent "page-scroll" state we already disliked (the existing `:has(.editor-page)` rule explicitly caps on mobile too, citing the same reason — "the combined element MUST still fit within `100dvh`"), and (b) two different scroll models across breakpoints make Vitest assertions and visual regressions noisier.

### Decision 2: Remove the `:has(.editor-page)` rule rather than coexist with it

Once `.settings-layout`'s own scoped style caps to `100dvh`, the global rule becomes dead code. Keeping it as defence-in-depth would just rot — when someone refactors `SettingsLayout`'s class name, both rules would need to update. Removing it now is safer (single source of truth) and aligns with the proposal's "no backward compatibility / no migration" stance.

### Decision 3: Apply the same shape to `ToolsLayout`

`ToolsLayout.vue` mirrors `SettingsLayout.vue` structurally; if we don't also fix tools, we get a half-finished UX. The proposal therefore covers both, and we explicitly mention it in the `tools-menu` delta.

### Decision 4: Keep the `page-layout` capability's body-scroll guarantee separate from per-layout rules

The new `page-layout` requirement is a single-sentence global invariant ("no body scrollbar on settings/tools desktop"). It overlaps semantically with the per-layout `settings-page` and `tools-menu` requirements, but having it stated explicitly at the shell level makes regressions obvious during smoke testing — a screenshot showing a body scrollbar on `/settings/lore` is a single check, not a per-component recomputation.

### Decision 5: Reading routes are out of scope

Reading routes (`/`, `/:series/:story/chapter/:i`, etc.) intentionally retain body-level scrolling. Long chapters should scroll the whole page with the header staying sticky — that's the canonical reader UX. Capping the body height on reading routes would require restructuring the `ContentArea.vue` scroll containers and is unrelated to the user's complaint, which is specifically about settings columns moving together.

## Risks / Open Questions

- **`100dvh` on iOS Safari ≤ 15.3**: small minority but theoretically the `100vh` fallback still works (modulo dynamic browser chrome). We accept the same trade-off the existing `:has(.editor-page)` rule already accepted.
- **Vitest happy-dom does not perform layout**: the "long content scrolls" scenarios cannot be unit-tested by reading `scrollTop`. We assert the *computed styles* (e.g. `overflow-y: auto`, `min-height: 0`) in Vitest, and document the layout-dependent scenarios as agent-browser visual smoke tests. This mirrors how the existing prompt-editor cap is verified (see existing scenario "validated by manual browser smoke; Happy DOM does not perform layout").
- **Fixed-position absolute children**: if any settings tab page renders a `position: fixed` modal/toast, the new `overflow: hidden` on `.settings-body` will NOT trap it (fixed elements escape overflow). Existing toast notifications use `<Teleport to="body">` so they stay attached to the document, not the settings layout — verified by re-reading `useToastBus`. No regression expected.
- **Sidebar scrollbar gutter**: when the sidebar starts being a scroll container, browsers may render a scrollbar gutter that visually pushes the content. We use `overflow-y: auto` (not `scroll`) so the gutter only appears when needed, which matches existing behavior on the mobile drawer.
- **Tests existing today**: `SettingsLayout.test.ts` and `SettingsLayout.grouping.test.ts` already assert layout DOM. We will add a small test file (or extend an existing one) to assert the new computed-style invariants.
