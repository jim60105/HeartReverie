## ADDED Requirements

### Requirement: Tools drawer and content scroll independently within the viewport

When viewport width ≥ 768 px (desktop / tablet), the `ToolsLayout.vue` component SHALL constrain the visible area to the viewport so that the sticky `<header>` (`AppHeader.vue`) is always on screen and the two columns inside `.tools-body` each scroll on their own — mirroring the equivalent behavior specified for `SettingsLayout` in the `settings-page` capability. Specifically:

- The `.tools-layout` root SHALL be height-capped to `100dvh` (with `100vh` declared first as a fallback). `min-height: 100vh` SHALL NOT cause the layout to grow past the viewport.
- The `.tools-body` flex container SHALL set `flex: 1; min-height: 0; overflow: hidden` so neither column can spill into a body-level scroll.
- The desktop sidebar (`#tools-drawer` `<aside>`, class `.tools-sidebar` without `.is-mobile`) SHALL set `overflow-y: auto; min-height: 0`. A long `toolsChildren` list SHALL scroll inside the aside only, with no movement in the content area or the document body.
- The content `<main>` (`.tools-content`) SHALL set `overflow-y: auto; min-height: 0`. Long tool pages (e.g. the new-series wizard, future import / migration tools) SHALL scroll inside the main column only.
- The document body SHALL NOT introduce a vertical scrollbar on any `/tools/*` route at viewport widths ≥ 768 px: `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (allowing subpixel rounding).

At viewport widths ≤ 767 px the mobile drawer rules in "Tools sidebar collapses to an overlay drawer on mobile" continue to apply unchanged.

#### Scenario: Long tools sidebar scrolls within the aside on desktop

- **GIVEN** the user is on a `/tools/*` route at 1280 × 720 viewport with a `toolsChildren` list whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `#tools-drawer`
- **THEN** the aside's internal scroll position SHALL advance, `<main class="tools-content">` `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Long tool content scrolls within the main on desktop

- **GIVEN** the user is on a `/tools/*` route at 1280 × 720 viewport with a tool page whose natural height exceeds the viewport
- **WHEN** the user scrolls inside `.tools-content`
- **THEN** the main's internal scroll position SHALL advance, `#tools-drawer` `scrollTop` SHALL remain `0`, the sticky `<header>` SHALL remain visible, and `document.documentElement.scrollTop` SHALL remain `0`

#### Scenario: Document body does not scroll on any tools route at desktop widths

- **WHEN** the user navigates to any `/tools/*` route at a viewport ≥ 768 px (audited at 1280 × 720 and 768 × 1024)
- **THEN** `document.documentElement.scrollHeight` SHALL be less than or equal to `document.documentElement.clientHeight + 1` (no body-level vertical scrollbar), regardless of how tall the sidebar or content's natural heights are

#### Scenario: Computed styles enforce the scroll containers

- **WHEN** the user is on a `/tools/*` route at a viewport ≥ 768 px
- **THEN** `getComputedStyle(.tools-layout).height` SHALL equal the viewport height (within 1 px), `getComputedStyle(.tools-body)` SHALL include `min-height: 0px` and `overflow: hidden`, `getComputedStyle(#tools-drawer)` SHALL include `min-height: 0px` and `overflow-y: auto`, and `getComputedStyle(.tools-content)` SHALL include `min-height: 0px` and `overflow-y: auto`

#### Scenario: Mobile behavior unaffected

- **WHEN** the user is on a `/tools/*` route at a viewport ≤ 767 px
- **THEN** the desktop-only independent-scroll guarantee SHALL NOT be required and the mobile drawer SHALL render per "Tools sidebar collapses to an overlay drawer on mobile"
