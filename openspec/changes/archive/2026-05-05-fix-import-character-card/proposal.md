## Why

The ST 角色卡轉換工具 (`/tools/import-character-card`) shipped with several parsing and UX deficiencies that surface immediately when testing with a real SillyTavern character card. Entry names display as "(unnamed)" because the parser reads `entry.name` — but SillyTavern stores the display name in `entry.comment`. Additionally, the UI layout lacks visual grouping, the lore is written to the wrong scope (story instead of series), the character file path doesn't use a dedicated `character/` subdirectory, and several CSS/styling issues make the page feel unfinished. Since this project is pre-release with zero users, these are blocking defects that must be fixed before the tool is usable.

## What Changes

- **FIX** Parser: Read `entry.comment` (falling back to `entry.name`, then first key, then empty) as the entry display name — SillyTavern stores the human-readable identifier in `comment`, not `name`.
- **FIX** Markdown builder: Skip the `**Keys:**` line entirely when a `character_book` entry has no keys (instead of rendering `**Keys:** ` with nothing after it).
- **MODIFIED** UI layout: Move "角色檔案名稱" input under the "角色資料" section (currently under "故事位置").
- **MODIFIED** UI layout: Wrap page sections with `<fieldset class="group">` + `<legend>` (matching the visual style of `/tools/new-series`) instead of bare `<h3>` headings.
- **MODIFIED** Default value: "世界篇章名稱" input starts empty (was pre-filled "世界典籍").
- **NEW** UI section: Add a dedicated "世界篇章" section that displays parsed `character_book` entries in a structured grouping.
- **MODIFIED** Terminology: Rename "典籍" → "篇章" throughout the UI and error messages (both "角色典籍" → "角色篇章" and "世界典籍" → "世界篇章"). This applies to ImportCharacterCardPage, QuickAddPage, and their specs.
- **MODIFIED** Lore scope: Create lore files at **series** scope (`PUT /api/lore/series/:series/:path`) instead of story scope. This makes the character and world_info available across all stories in the series.
- **MODIFIED** File path: Create the character file under a `character/` subdirectory, e.g. `_lore/character/<name>.md`.
- **FIX** CSS: Give `.themed-btn` a proper base button style (border, background, padding, border-radius) so it is visually recognizable as a button — currently only the `:hover` rule exists.
- **FIX** CSS: Style the file input (`input[type=file]`) inside the dropzone to look like a proper file selector with a button-like appearance.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `import-character-card-tool`: Fix parser to read `comment` field for entry names; skip empty Keys line; change lore scope from story to series; write character file under `character/` subdirectory; restructure UI with fieldset groups; fix themed-btn and file-input styling; empty default for 世界篇章名稱; add 世界篇章 section; rename 典籍→篇章 terminology.
- `quick-add-tool`: Rename "角色典籍"/"世界典籍" → "角色篇章"/"世界篇章" in UI labels, error messages, and spec.

## Impact

- **Frontend (modified)**:
  - `reader-src/src/lib/character-card-parser.ts` — entry name extraction logic
  - `reader-src/src/components/ImportCharacterCardPage.vue` — UI restructure, lore scope change, file path change, markdown builder fix, CSS fixes
  - `reader-src/src/styles/base.css` — `.themed-btn` base styles (benefits all pages using this class)
- **Tests (modified)**:
  - `reader-src/src/lib/__tests__/character-card-parser.test.ts` — update expectations for `comment`-based name
  - `reader-src/src/components/__tests__/ImportCharacterCardPage.test.ts` — update for series scope, character/ path, empty Keys skip, fieldset structure
- **Backend**: Zero changes. The series-scope lore PUT endpoint (`PUT /api/lore/series/:series/:path`) already exists in `writer/routes/lore.ts`.
- **Other tools**: The QuickAddPage is unaffected. The `.themed-btn` CSS fix benefits any page already using that class.
