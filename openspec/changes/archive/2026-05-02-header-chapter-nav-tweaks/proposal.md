## Why

The reader's app header has accumulated visual clutter: the `📂 選擇資料夾` button consumes prime header real estate even though backend-mode story routing is now the primary entry path, and the `📖 故事選擇` label remains fully expanded after a story is already loaded — its label is redundant at that point. Chapter navigation, meanwhile, only supports stepwise `← 上一章` / `下一章 →` movement; readers reading long stories have no quick way to jump to the start or the latest chapter without repeatedly clicking through. This change tightens the header layout and adds first / last chapter shortcuts.

The project has 0 users in the wild, so no migration or backward-compat affordances are required. FSA mode (the local-folder File System Access API path) remains in `useFileReader` for future re-introduction but loses its UI entry point in this change.

## What Changes

- **BREAKING**: Remove the `📂 選擇資料夾` button from `AppHeader.vue`. FSA mode is no longer reachable from the UI; `useFileReader` and `loadFromFSA()` remain as plumbing for future use but are not invoked from the header.
- Collapse the `StorySelector` toggle label so it renders only the `📖` glyph (no text) when a backend story is currently selected; render the full `📖 故事選擇` label when no story is selected.
- Add a first-chapter button rendered immediately before `← 上一章` with the glyph `⇇` and the tooltip `第一章`. Add a last-chapter button rendered immediately after `下一章 →` with the glyph `⇉` and the tooltip `最後一章`.
- Both new buttons SHALL share visibility and disabled-at-boundary semantics with the existing previous/next pair: hidden when no story is loaded, disabled when already on the boundary they target.

## Capabilities

### New Capabilities

_(none — all changes attach to existing capabilities)_

### Modified Capabilities

- `chapter-navigation`: add requirements for first-chapter and last-chapter jump buttons in the header navigation cluster.
- `story-selector`: add a requirement governing the collapsed toggle label when a story is selected.
- `file-reader`: remove the FSA directory-chooser button requirement; the composable plumbing remains but the UI entry point no longer SHALL exist.
- `page-layout`: update the header-content requirement so it no longer mandates the folder-picker button alongside navigation controls.

## Impact

- **Frontend code**: `reader-src/src/components/AppHeader.vue` (remove FSA button, add ⇇/⇉ buttons), `reader-src/src/components/StorySelector.vue` (conditional label), `reader-src/src/components/ContentArea.vue` (empty-state copy no longer references the removed `📂 選擇資料夾` button). No backend changes.
- **Frontend tests**: `reader-src/src/components/__tests__/AppHeader.test.ts`, `ContentArea.test.ts` (currently asserts the `選擇資料夾` empty-state copy and SHALL be updated), and `StorySelector.test.ts` (if present) will need updates for the new layout. New tests cover the four new scenarios.
- **Composables**: `useChapterNav` already exposes `currentIndex` / `chapters` and an internal `navigateTo(index)` helper. Two new exported helpers (`goToFirst`, `goToLast`) wrap the existing logic — they SHALL go through the same FSA / backend branching as `next` / `previous`.
- **Specs**: four delta specs as listed above. No new capability files.
- **Affected user-visible UX**: header is shorter; FSA local-folder loading is no longer accessible from the app shell (acknowledged regression — 0 users, no migration).
