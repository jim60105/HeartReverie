# Page Layout — delta for mobile-responsive-layout

## MODIFIED Requirements

### Requirement: Compact header sizing

The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area. The header SHALL contain the story selector toggle, the folder-name display, the reload button (when chapters are loaded), the settings button (in backend mode), and the chapter-navigation cluster. The chapter-navigation cluster SHALL contain, in this fixed left-to-right order, the first-chapter jump button (`⇇`), the previous-chapter button (`← 上一章`), the chapter progress indicator (e.g., `3 / 11`), the next-chapter button (`下一章 →`), and the last-chapter jump button (`⇉`). The cluster SHALL be hidden until a story folder is loaded. The folder-picker button is removed in this change and SHALL NOT appear in the header.

The header SHALL NOT render a mobile hamburger button. Any such legacy `☰` control and its associated `mobileMenuOpen` state SHALL be removed from the component; future mobile-drawer functionality, if introduced, SHALL be specified in a separate change rather than carried as dead code.

At a viewport width of 767 px or less, the header SHALL adapt to a single-row layout via CSS media queries:

- The `.folder-name` breadcrumb (e.g. `<series> / <story>`) SHALL NOT be visible. Series and story name remain reachable through the `📖` story-selector dropdown.
- The first-chapter jump button (`⇇`) and the last-chapter jump button (`⇉`) SHALL NOT be visible or focusable, and SHALL NOT be exposed to assistive tech. They SHALL become visible and reachable again when the viewport widens to 768 px or above without requiring a Vue remount of the header component.
- The `← 上一章`, the `i / N` progress indicator, and `下一章 →` SHALL remain visible at all viewport widths once a story is loaded.
- The `📖` story-selector toggle, the `🔄` reload button, and the `⚙️` settings button (in backend mode) SHALL remain visible at all viewport widths.
- The header row SHALL NOT wrap onto multiple lines and the visible content SHALL fit within the row width without horizontal overflow at any viewport width in the audited mobile range (360 px to 767 px) at default user-agent text scaling. Behavior at viewport widths below 360 px or under non-default text scaling (e.g. browser-level zoom or user-set base font size of 200 % or more) is not guaranteed by this requirement; if a future regression report identifies an overflow at those widths, a follow-up change SHALL extend coverage rather than silently re-introducing wrap.

The mobile media-query breakpoint (`@media (max-width: 767px)`) SHALL be the same value used by `ContentArea.vue`'s grid-collapse rule so that header collapse and content single-column collapse trigger together.

#### Scenario: Compact header padding

- **WHEN** the application is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-2 py-1` padding for a minimal-height header bar

#### Scenario: Header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport ≥ 768 px
- **THEN** the header SHALL display the story selector toggle, folder name, reload button, settings button (backend mode only), and the chapter-navigation cluster (`⇇` `← 上一章` `i / N` `下一章 →` `⇉`) in a single unified bar

#### Scenario: Mobile header layout when story is loaded

- **WHEN** a story is loaded (chapters are present) on a viewport in the audited mobile range (360 px to 767 px) at default user-agent text scaling
- **THEN** the header SHALL display only the story selector toggle (`📖`), the reload button (`🔄`), the settings button (`⚙️`, backend mode only), and the reduced chapter-navigation cluster (`← 上一章` `i / N` `下一章 →`) in a single row without wrapping or horizontal overflow, and the folder-name breadcrumb, the `⇇` button, and the `⇉` button SHALL NOT be visible or focusable

#### Scenario: Mobile breakpoint matches content-area breakpoint

- **WHEN** inspecting the header's mobile-collapse media query and `ContentArea.vue`'s grid-collapse media query
- **THEN** both SHALL use `@media (max-width: 767px)` (identical breakpoint), so resizing past 768 px collapses or restores both elements simultaneously

#### Scenario: Resize from mobile to desktop restores hidden controls without remount

- **WHEN** the viewport is resized from 443 px (or any mobile width) to 1280 px (or any desktop width) within the same page session
- **THEN** the breadcrumb, the `⇇` button, and the `⇉` button SHALL become visible again, and the transition SHALL NOT require remounting the `AppHeader` component (i.e. component-local state such as the StorySelector's open / closed state SHALL be preserved across the transition)

#### Scenario: Navigation cluster hidden before story load

- **WHEN** no story has been loaded yet
- **THEN** the entire chapter-navigation cluster — first-chapter button, previous button, progress indicator, next button, last-chapter button — SHALL be hidden via Vue directive (`v-if`), and only the story selector and (if `useFileReader().isSupported` is `true`) any non-folder-picker controls SHALL remain visible

#### Scenario: No folder-picker button in header

- **WHEN** the application is rendered in any state (story loaded or not)
- **THEN** the header SHALL NOT render a `📂 選擇資料夾` button or any equivalent UI control that invokes `useFileReader().openDirectory()`

#### Scenario: No hamburger button in header

- **WHEN** the application is rendered in any state, at any viewport width
- **THEN** the header SHALL NOT render a `☰` hamburger button, and the component SHALL NOT declare an unused `mobileMenuOpen` reactive state ref

## ADDED Requirements

### Requirement: Prompt-editor toolbar narrow-viewport wrap

The prompt-editor settings page (`/settings/prompt-editor`) SHALL render its toolbar action cluster (the buttons that perform `＋ 新增訊息`, `↻ 回復預設`, `儲存`, and `預覽 Prompt`) so that, when the available container width is narrower than the cluster's natural one-line width, the cluster wraps onto multiple rows aligned to the trailing edge rather than overflowing horizontally past the viewport. Specifically, the `.toolbar-actions` flex container SHALL declare `flex-wrap: wrap` and SHALL NOT pin its width via `flex-shrink: 0`; remaining items SHALL be right-aligned via `justify-content: flex-end` so that on a narrow viewport the rightmost button (`預覽 Prompt`) lands flush with the trailing edge of the toolbar instead of dropping under the leftmost button.

#### Scenario: Toolbar action cluster wraps without overflow at narrow viewport

- **WHEN** the prompt-editor page is rendered in a viewport whose width is narrower than the action cluster's natural one-line width (audited at 360 px and 375 px)
- **THEN** the action cluster SHALL wrap onto two or more rows within the editor pane, every button SHALL remain fully inside the viewport (`getBoundingClientRect().right ≤ window.innerWidth`), and the document SHALL NOT introduce horizontal page overflow (`document.body.scrollWidth === window.innerWidth`)

#### Scenario: Toolbar action cluster fits on one row on wider viewports

- **WHEN** the prompt-editor page is rendered in a viewport whose width is at least the action cluster's natural one-line width (audited at 390 px, 443 px, and 1280 px)
- **THEN** the action cluster SHALL render on a single row right-aligned within the toolbar with no wrap
