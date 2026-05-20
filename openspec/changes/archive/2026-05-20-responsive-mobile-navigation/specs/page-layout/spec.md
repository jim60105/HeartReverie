## MODIFIED Requirements

### Requirement: Compact header sizing

The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area. The header SHALL contain the story selector toggle, the folder-name display, the reload button (when chapters are loaded), the tools-menu button, the settings button, and the chapter-navigation cluster. The chapter-navigation cluster SHALL contain, in this fixed left-to-right order, the first-chapter jump button (`⇇`), the previous-chapter button (`← 上一章`), the chapter progress indicator (e.g., `3 / 11`), the next-chapter button (`下一章 →`), and the last-chapter jump button (`⇉`). The cluster SHALL be hidden until a story is loaded.

The tools-menu button (`🧰`) SHALL be rendered immediately adjacent to the settings button (`⚙️`) and SHALL share the same `header-btn header-btn--icon` class set as the settings button. Clicking the tools button SHALL toggle a dropdown panel rendered as a descendant of the `<header>` element (NOT via `<Teleport>`) so that the panel inherits the header's sticky stacking context and z-index. The contents of the dropdown are specified by the `tools-menu` capability.

`AppHeader.vue` itself SHALL NOT declare a mobile hamburger button or a `mobileMenuOpen` reactive state ref; the legacy in-component `☰` control SHALL remain removed. A `☰` control MAY appear inside the rendered `<header>` only when it originates from a layout-owned `#leading` slot fill (e.g. `SettingsLayout.vue` or `ToolsLayout.vue` injecting their drawer toggle on mobile); such slot-injected toggles are governed by the `settings-page` / `tools-menu` capabilities respectively. Any other future mobile-drawer functionality, if introduced, SHALL be specified in a separate change rather than carried as dead code.

At a viewport width of 767 px or less, the header SHALL adapt to a single-row layout via CSS media queries:

- The `.folder-name` breadcrumb (e.g. `<series> / <story>`) SHALL NOT be visible. Series and story name remain reachable through the `📖` story-selector dropdown.
- The first-chapter jump button (`⇇`) and the last-chapter jump button (`⇉`) SHALL NOT be visible or focusable, and SHALL NOT be exposed to assistive tech. They SHALL become visible and reachable again when the viewport widens to 768 px or above without requiring a Vue remount of the header component.
- The `← 上一章`, the `i / N` progress indicator, and `下一章 →` SHALL remain visible at all viewport widths once a story is loaded.
- The `📖` story-selector toggle, the `🔄` reload button, the `🧰` tools-menu button, and the `⚙️` settings button SHALL remain visible at all viewport widths.
- The header row SHALL NOT wrap onto multiple lines and the visible content SHALL fit within the row width without horizontal overflow at any viewport width in the audited mobile range (360 px to 767 px) at default user-agent text scaling. Behavior at viewport widths below 360 px or under non-default text scaling (e.g. browser-level zoom or user-set base font size of 200 % or more) is not guaranteed by this requirement; if a future regression report identifies an overflow at those widths, a follow-up change SHALL extend coverage rather than silently re-introducing wrap.

At a viewport width below 410 px (audited at 360 px and 375 px), the `← 上一章` and `下一章 →` button labels SHALL collapse to icon-only `←` and `→`: the textual portion (the localized Chinese label "上一章" / "下一章") SHALL be hidden from sight (`display: none` on a dedicated label span) AND hidden from assistive tech reachability for the visible button (the button SHALL still expose an `aria-label` carrying the full localized name, so screen readers continue to announce "Previous chapter" / "Next chapter"). The arrow glyph SHALL remain visible and the button SHALL remain a single tap target. At viewport widths ≥ 410 px the full `← 上一章` / `下一章 →` labels SHALL be visible.

To prevent a long chapter progress counter (e.g. `123 / 999`) from re-introducing horizontal overflow even with the labels collapsed, the `.chapter-progress` element SHALL be constrained with `flex-shrink: 1`, `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` so it truncates rather than pushing other items off-screen. The no-overflow guarantee (`documentElement.scrollWidth === clientWidth` across the 360–767 px range) SHALL hold for any plausible counter string up to and including `999 / 999`.

The collapse-to-icon transition SHALL NOT remount the buttons — it SHALL be a pure CSS media-query toggle so Vue state (e.g. focus inside the cluster, tooltip open state) is preserved.

The mobile media-query breakpoint (`@media (max-width: 767px)`) SHALL be the same value used by `ContentArea.vue`'s grid-collapse rule so that header collapse and content single-column collapse trigger together. The narrow-label-collapse breakpoint (`@media (max-width: 409px)`) is a separate, narrower threshold that operates inside the existing mobile range.

#### Scenario: Compact header padding

- **WHEN** the application is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-2 py-1` padding for a minimal-height header bar

#### Scenario: Header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport ≥ 768 px
- **THEN** the header SHALL display the story selector toggle, folder name, reload button, tools-menu button, settings button, and the chapter-navigation cluster (`⇇` `← 上一章` `i / N` `下一章 →` `⇉`) in a single unified bar

#### Scenario: Mobile header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport in the audited mobile range (360 px to 767 px) at default user-agent text scaling
- **THEN** the header SHALL display only the story selector toggle (`📖`), the reload button (`🔄`), the tools-menu button (`🧰`), the settings button (`⚙️`), and the reduced chapter-navigation cluster (the previous button, the `i / N` progress indicator, and the next button) in a single row without wrapping or horizontal overflow, and the folder-name breadcrumb, the `⇇` button, and the `⇉` button SHALL NOT be visible or focusable

#### Scenario: Narrow-viewport label collapse on prev/next chapter buttons

- **WHEN** a story is loaded on a viewport whose width is below 410 px (audited at 360 px and 375 px) at default user-agent text scaling
- **THEN** the previous-chapter button SHALL display as `←` only (with the "上一章" text label hidden), the next-chapter button SHALL display as `→` only (with the "下一章" text label hidden), both buttons SHALL still expose their full localized label via `aria-label`, the document SHALL satisfy `documentElement.scrollWidth === clientWidth` (no horizontal page overflow), and the header row SHALL still NOT wrap

#### Scenario: Wider mobile viewport keeps the full text labels

- **WHEN** a story is loaded on a viewport whose width is between 410 px and 767 px (audited at 443 px)
- **THEN** the previous-chapter button SHALL display as `← 上一章` (with the text label visible), the next-chapter button SHALL display as `下一章 →` (with the text label visible), and the document SHALL satisfy `documentElement.scrollWidth === clientWidth`

#### Scenario: Long chapter counter does not overflow

- **WHEN** a story with 999 chapters is loaded at chapter 123 (so the progress indicator reads `123 / 999`) on a 360 px viewport at default text scaling
- **THEN** the document SHALL satisfy `documentElement.scrollWidth === clientWidth` (no horizontal overflow), the header row SHALL NOT wrap, and the `.chapter-progress` element computed style SHALL include `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` so any further-overrun counter truncates rather than pushing other items off-screen

#### Scenario: Label collapse is CSS-only (no remount)

- **WHEN** the viewport is resized from 443 px to 375 px and back, with the previous-chapter button focused
- **THEN** the prev/next button DOM elements SHALL NOT be remounted, focus SHALL remain on the previous-chapter button across the transitions, and the button's `aria-label` SHALL remain stable throughout

#### Scenario: Mobile breakpoint matches content-area breakpoint

- **WHEN** inspecting the header's mobile-collapse media query and `ContentArea.vue`'s grid-collapse media query
- **THEN** both SHALL use `@media (max-width: 767px)` (identical breakpoint), so resizing past 768 px collapses or restores both elements simultaneously

#### Scenario: Resize from mobile to desktop restores hidden controls without remount

- **WHEN** the viewport is resized from 443 px (or any mobile width) to 1280 px (or any desktop width) within the same page session
- **THEN** the breadcrumb, the `⇇` button, and the `⇉` button SHALL become visible again, and the transition SHALL NOT require remounting the `AppHeader` component (i.e. component-local state such as the StorySelector's open / closed state SHALL be preserved across the transition)

#### Scenario: Navigation cluster hidden before story load

- **WHEN** no story has been loaded yet
- **THEN** the entire chapter-navigation cluster — first-chapter button, previous button, progress indicator, next button, last-chapter button — SHALL be hidden via Vue directive (`v-if`), and only the story selector, reload button, tools-menu button, and settings button SHALL remain visible

#### Scenario: No hamburger button declared by AppHeader itself

- **WHEN** the application is rendered in any state, at any viewport width
- **THEN** `AppHeader.vue` SHALL NOT declare a `☰` hamburger button in its own template and SHALL NOT declare an unused `mobileMenuOpen` reactive state ref; any `☰` that appears within the `<header>` element SHALL originate from a layout-owned `#leading` slot fill (e.g. `SettingsLayout` or `ToolsLayout`) and SHALL be governed by the `settings-page` or `tools-menu` capability, not by this requirement

#### Scenario: Tools button placement

- **WHEN** the application is rendered with a loaded story on a desktop viewport
- **THEN** the `🧰` tools-menu button SHALL appear in the header immediately adjacent to the `⚙️` settings button (no other interactive control between them)

#### Scenario: Tools dropdown is a descendant of header

- **WHEN** the user opens the tools dropdown by clicking `🧰`
- **THEN** the rendered dropdown panel SHALL be a descendant element of the `<header>` element, NOT a direct child of `<body>` (no `<Teleport>` is used)
