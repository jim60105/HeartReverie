## ADDED Requirements

### Requirement: Settings drawer and content scroll independently within the viewport

When viewport width ≥ 768 px (desktop / tablet), the `SettingsLayout.vue` component SHALL constrain the visible area to the viewport so that the sticky `<header>` (`AppHeader.vue`) is always on screen and the two columns inside `.settings-body` each scroll on their own. Specifically:

- The `.settings-layout` root SHALL be height-capped to `100dvh` (with `100vh` as a `dvh`-unaware fallback declared first). `min-height: 100vh` SHALL NOT cause the layout to grow past the viewport.
- The `.settings-body` flex container SHALL fill the remaining vertical space below the header and SHALL set `flex: 1; min-height: 0; overflow: hidden` so neither column can spill into a body-level scroll.
- The desktop sidebar (`#settings-drawer` `<aside>`, class `.settings-sidebar` without `.is-mobile`) SHALL set `overflow-y: auto; min-height: 0` so that a sidebar long enough to exceed the available height (general tabs + plugin tabs + developer-tools tabs + back-to-reader button) scrolls inside the aside only. Sidebar scroll position SHALL NOT move the content area.
- The content `<main>` (`.settings-content`) SHALL set `overflow-y: auto; min-height: 0` so that long routed content (e.g. `/settings/prompt-editor`, `/settings/lore`, `/settings/llm`, `/settings/theme`, plugin pages) scrolls inside the main column only. Content scroll position SHALL NOT move the sidebar.
- The document body SHALL NOT introduce a vertical scrollbar on any `/settings/*` route at viewport widths ≥ 768 px: `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (allowing subpixel rounding), and the sticky header SHALL never scroll out of view.

At viewport widths ≤ 767 px (mobile) the mobile drawer rules in "Settings sidebar collapses to an overlay drawer on mobile" continue to apply unchanged. The mobile content area MAY scroll either inside `.settings-content` or as the document body (current behavior is unchanged); the desktop independent-scroll guarantee above does NOT apply on mobile.

#### Scenario: Long sidebar scrolls within the aside on desktop

- **GIVEN** the user is on a `/settings/*` route at 1280 × 720 viewport with so many plugin/developer-tools tabs registered that the sidebar's natural content height exceeds the viewport
- **WHEN** the user scrolls inside `#settings-drawer`
- **THEN** the aside's internal scroll position SHALL advance, the `<main class="settings-content">` element's `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain fully visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Long routed content scrolls within the main on desktop

- **GIVEN** the user is on `/settings/lore` at 1280 × 720 viewport with a lore list whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `.settings-content`
- **THEN** the main's internal scroll position SHALL advance, `#settings-drawer` element's `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain fully visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Document body does not scroll on any settings route at desktop widths

- **WHEN** the user navigates to any `/settings/*` route at a viewport ≥ 768 px (audited at 1280 × 720 and 768 × 1024)
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (no body-level vertical scrollbar), regardless of how tall the sidebar or content's natural heights are

#### Scenario: Computed styles enforce the scroll containers

- **WHEN** the user is on a `/settings/*` route at a viewport ≥ 768 px
- **THEN** `getComputedStyle(.settings-layout).height` SHALL equal the viewport height (within 1 px), `getComputedStyle(.settings-body)` SHALL include `min-height: 0px` and `overflow: hidden`, `getComputedStyle(#settings-drawer)` SHALL include `min-height: 0px` and `overflow-y: auto`, and `getComputedStyle(.settings-content)` SHALL include `min-height: 0px` and `overflow-y: auto`

#### Scenario: Mobile behavior unaffected

- **WHEN** the user is on a `/settings/*` route at a viewport ≤ 767 px
- **THEN** the desktop-only independent-scroll guarantee SHALL NOT be required, the mobile drawer SHALL render per "Settings sidebar collapses to an overlay drawer on mobile", and the mobile content scroll behavior SHALL remain whatever it was before this change (no regression on mobile)

## REMOVED Requirements

### Requirement: Settings layout caps its height to the viewport on the prompt-editor route

**Reason**: Subsumed by the new universal "Settings drawer and content scroll independently within the viewport" requirement, which caps `.settings-layout` to `100dvh` on every `/settings/*` route via the component's own scoped style. The route-scoped `.settings-layout.settings-layout:has(.editor-page)` rule in `reader-src/src/styles/base.css` becomes dead code and SHALL be removed from `base.css` as part of this change.

**Migration**: None — no users in the wild and no public consumers of the `.editor-page`-gated cap. The new requirement applies the same height cap unconditionally on desktop settings routes (and continues to cap on the prompt-editor mobile route via the mobile drawer overlay rules), so the prompt-editor behavior is preserved while non-editor settings tabs additionally gain the independent-scroll behavior.
