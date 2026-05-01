## MODIFIED Requirements

### Requirement: Compact header sizing

The sticky `<header>` element SHALL use reduced vertical and horizontal padding and compact button padding to minimise the space occupied at the top of the viewport, increasing the visible reading area. The header SHALL contain the story selector toggle, the folder-name display, the reload button (when chapters are loaded), the settings button (in backend mode), and the chapter-navigation cluster. The chapter-navigation cluster SHALL contain, in this fixed left-to-right order, the first-chapter jump button (`⇇`), the previous-chapter button (`← 上一章`), the chapter progress indicator (e.g., `3 / 11`), the next-chapter button (`下一章 →`), and the last-chapter jump button (`⇉`). The cluster SHALL be hidden until a story folder is loaded. The folder-picker button is removed in this change and SHALL NOT appear in the header.

#### Scenario: Compact header padding

- **WHEN** the application is rendered
- **THEN** the header SHALL use `py-1 px-3` padding and buttons SHALL use `px-2 py-1` padding for a minimal-height header bar

#### Scenario: Header layout when story is loaded

- **WHEN** a story is loaded (chapters are present)
- **THEN** the header SHALL display the story selector toggle, folder name, reload button, settings button (backend mode only), and the chapter-navigation cluster (`⇇` `← 上一章` `i / N` `下一章 →` `⇉`) in a single unified bar

#### Scenario: Navigation cluster hidden before story load

- **WHEN** no story has been loaded yet
- **THEN** the entire chapter-navigation cluster — first-chapter button, previous button, progress indicator, next button, last-chapter button — SHALL be hidden via Vue directive (`v-if`), and only the story selector and (if `useFileReader().isSupported` is `true`) any non-folder-picker controls SHALL remain visible

#### Scenario: No folder-picker button in header

- **WHEN** the application is rendered in any state (story loaded or not)
- **THEN** the header SHALL NOT render a `📂 選擇資料夾` button or any equivalent UI control that invokes `useFileReader().openDirectory()`
