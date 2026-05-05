## Context

The `/tools/import-character-card` page was recently implemented as part of `add-spa-tools-menu`. Testing with a real SillyTavern character card (`高橋 玲奈.png`) revealed that the PNG parser, UI layout, lore scope, and styling all need corrections.

Key findings from parsing the real card:
- SillyTavern stores entry display names in `entry.comment`, NOT `entry.name` (which is always empty string `""`)
- Most entries have empty `keys[]` arrays (they use `constant: true` activation instead)
- The card contains `character_book.name` as a top-level world book name field

The existing lore API already supports series-scope writes (`PUT /api/lore/series/:series/:path`) and nested paths (up to 2 segments), so no backend changes are needed.

## Goals / Non-Goals

**Goals:**
- Fix the parser to correctly extract entry names from the `comment` field (with appropriate fallback chain)
- Eliminate empty `**Keys:**` lines in world_info markdown when no keys exist
- Restructure the import page UI to use `<fieldset class="group">` visual grouping (consistent with QuickAddPage)
- Move lore writes from story scope to series scope so character/world_info are shared across all stories in a series
- Nest the character file under a `character/` subdirectory for organizational clarity
- Fix `.themed-btn` to have visible base button styling
- Style the file input to look like a proper file-picker widget
- Pre-fill 世界典籍名稱 with the parsed `character_book.name` value (empty if absent), not a hardcoded default
- Add a dedicated 世界典籍 section in the UI that displays the parsed character_book entries

**Non-Goals:**
- Adding support for V3-specific `character_book` extensions beyond the standard fields
- Changing the QuickAddPage — it already uses fieldset.group
- Modifying the lore PUT endpoint itself (it already supports both scopes)
- Handling the `secondary_keys` field from ST entries (deferred to a future enhancement)

## Decisions

### D1: Entry name fallback chain — `comment` → `name` → first key → empty

Real SillyTavern cards store the entry identifier in `comment`. However, some community tools may use `name` instead. The parser SHALL try `comment` first, then `name`, then fall back to the first key. This maximises compatibility.

| Approach | Pros | Cons |
| --- | --- | --- |
| **`comment` → `name` → first key (chosen)** | Works with real ST cards, handles edge cases from other tools | Slightly more complex fallback chain |
| `name` only (current) | Simpler | Broken for all standard ST cards |
| `comment` only | Works for ST | Breaks for tools that use `name` |

### D2: Series scope instead of story scope

Characters and world books are conceptually shared across a series (all stories featuring that character). Writing to series scope (`PUT /api/lore/series/:series/character/<name>.md`) makes the lore available to any story's prompt without duplication. The URL shape becomes `/api/lore/series/:series/character/<filename>` for characters and `/api/lore/series/:series/<world_info_filename>` for world info.

### D3: Character file nested under `character/` subdirectory

This provides organization within the `_lore/` directory at series scope. The physical path becomes `playground/<series>/_lore/character/<name>.md`. The URL for the PUT (scope-relative, no `_lore/` segment) is `character/<name>.md`. Since the lore API already supports up to 2 path segments, this works without backend changes.

### D4: 世界典籍名稱 default value

The field SHALL be hydrated from `character_book.name` if present in the parsed card, otherwise it starts empty. This is more useful than a hardcoded "世界典籍" because the card already carries a meaningful name (e.g., "悠奈" in our test card). If the user leaves it empty, the world_info markdown simply omits the H1 heading.

### D5: Skip Keys line when empty

When `entry.keys` is empty (length 0), the markdown builder SHALL omit the `**Keys:**` line entirely. This produces cleaner output since many entries use `constant: true` activation without keys.

### D6: fieldset.group wrapping

Reuse the exact same CSS class from QuickAddPage (`.group` on `<fieldset>` elements) for consistent visual grouping. The sections are: 檔案選擇, 角色資料, 故事位置, 世界典籍. "角色檔案名稱" moves from 故事位置 into 角色資料 because it's semantically about the character, not the story location.

### D7: .themed-btn base styling

Currently `.themed-btn` only has a `:hover` rule. Add base styling that mirrors other buttons in the app: `border: 1px solid var(--btn-border)`, `border-radius: 4px`, `background: var(--btn-bg)`, `padding: 8px 16px`, `color: inherit`, `cursor: pointer`. This fixes all pages using `.themed-btn`.

### D8: File input styling

Style `input[type=file]` inside the dropzone with a custom appearance: hide the native input, use a styled label or pseudo-button with border, padding, and hover effects. Keep the actual `<input>` functional for accessibility but visually replace it with a button-like trigger.

## Risks / Trade-offs

- **[Risk]** `entry.comment` may not exist in all card formats → **Mitigation**: Full fallback chain (`comment` → `name` → first key → empty string)
- **[Risk]** Changing lore scope from story to series may confuse users who already imported at story scope → **Mitigation**: Project is pre-release with 0 users. No migration needed.
- **[Risk]** The `character/` subdirectory adds a path segment; lore API limits depth to 2 → **Mitigation**: `character/<name>.md` is exactly 2 segments, within the limit.
- **[Risk]** `.themed-btn` base styling may affect other pages → **Mitigation**: This is intentional — all pages using `.themed-btn` should have visible buttons. Current state (invisible until hover) is the bug.
