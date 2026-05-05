# Import Character Card Tool — Delta Spec

> Target: `openspec/specs/import-character-card-tool/spec.md`

## MODIFIED Requirement: PNG character card parsing

The normalisation step (step 6) SHALL:

1. Expose `bookName: string` on `ParsedCharacterCard`, derived from `data.character_book.name` if present and non-empty after trim, otherwise `""`.
2. Derive each `bookEntries[].name` using the following trim-aware fallback chain:
   - `entry.comment` trimmed (if non-empty after trim)
   - `entry.name` trimmed (if non-empty after trim)
   - First non-empty-after-trim element of `entry.keys`
   - Empty string `""`

This replaces the previous logic of `name` (from entry's `name` or first key).

The TypeScript interfaces SHALL be extended:

```ts
interface CharacterBookEntry {
  comment?: string;   // NEW — display name in SillyTavern cards
  name?: string;
  keys?: string[];
  content?: string;
}

interface ParsedCharacterCard {
  // ... existing fields ...
  bookName: string;   // NEW — from character_book.name
  bookEntries: ParsedBookEntry[];
}
```

### MODIFIED Scenario: character_book entries become bookEntries
- **WHEN** the source JSON's `data.character_book.entries` array contains three entries whose `comment` fields are "Alice", "   ", and "Charlie" and whose `name` fields are "", "Bob-via-name", and ""
- **THEN** the parsed `bookEntries` array SHALL contain three objects with `name` values of "Alice" (from comment), "Bob-via-name" (from name, because comment is whitespace-only), and "Charlie" (from comment)

### NEW Scenario: bookName is extracted from character_book.name
- **WHEN** `data.character_book.name` is `"悠奈"`
- **THEN** `ParsedCharacterCard.bookName` SHALL be `"悠奈"`

### NEW Scenario: Entry with empty comment falls back to name field
- **WHEN** an entry has `comment: ""` and `name: "Fallback Name"` and `keys: ["k1"]`
- **THEN** its parsed `bookEntries[].name` SHALL be "Fallback Name"

### NEW Scenario: Entry with whitespace-only comment and name falls back to first non-empty key
- **WHEN** an entry has `comment: "  "`, `name: ""`, and `keys: ["", "second"]`
- **THEN** its parsed `bookEntries[].name` SHALL be "second" (first non-empty key after trim)

### NEW Scenario: Entry with all empty fields yields empty name
- **WHEN** an entry has `comment: ""`, `name: ""`, and `keys: []`
- **THEN** its parsed `bookEntries[].name` SHALL be `""`

## MODIFIED Requirement: Import writes the edited form state

Step 5 and step 6 SHALL use **series-scope** lore endpoints instead of story-scope:

- Step 5: `PUT /api/lore/series/:seriesName/character/<characterFilename>` (character file nested under `character/` subdirectory)
- Step 6: `PUT /api/lore/series/:seriesName/<worldInfoFilename>` (world_info file at series root)

All references to `PUT /api/lore/story/:seriesName/:storyName/<path>` in steps 5 and 6 SHALL be replaced with the corresponding series-scope URLs above.

**Path construction:** The `characterFilename` is the user-editable basename (e.g. `hero.md`). The full lore path is `character/<characterFilename>`. URL construction SHALL encode each path segment individually — the slash between `character` and the filename is a literal path separator, NOT part of a single encoded value:

```
/api/lore/series/${encodeURIComponent(series)}/character/${encodeURIComponent(characterFilename)}
```

The filename validation (`validateLoreFilename`) SHALL only validate the basename portion (e.g. `hero.md`), NOT the `character/` prefix.

The world_info markdown (step 6 content) SHALL conditionally include the `**Keys:**` line: if `entry.keys` is empty (length 0 after filtering empty strings), the `**Keys:** ...` line SHALL be omitted entirely. The section becomes:

```
## <entry.name>
<entry.content>
```

instead of:

```
## <entry.name>
**Keys:** <entry.keys joined by ", ">

<entry.content>
```

### MODIFIED Scenario: With book entries, world_info PUT contains all entries
- **WHEN** the user imports a card whose `bookEntries` has two entries: `(name="Alice", keys=["alice","a"], content="Alice description")` and `(name="Bob", keys=[], content="Bob description")`
- **THEN** the world_info PUT URL SHALL be `/api/lore/series/:seriesName/<worldInfoFilename>`, and the body's `content` SHALL contain `## Alice\n**Keys:** alice, a\n\nAlice description` for the first entry and `## Bob\nBob description` for the second entry (no Keys line because keys is empty)

### NEW Scenario: Character file PUT uses series scope with character subdirectory
- **WHEN** the user clicks 匯入 with seriesName "MyCharacters" and characterFilename "hero.md"
- **THEN** the character PUT SHALL go to `PUT /api/lore/series/MyCharacters/character/hero.md`

## MODIFIED Requirement: Collision preflight before lore PUT

The preflight GETs SHALL use the same series-scope paths as the PUT:

- For the character file: `GET /api/lore/series/:series/character/<characterFilename>`.
- For the world_info file: `GET /api/lore/series/:series/<worldInfoFilename>`.

All references to story-scope preflight URLs SHALL be replaced with the corresponding series-scope URLs.

## MODIFIED Requirement: Editable form bound to parsed shape

The page form SHALL be organised into visual sections using `<fieldset class="group">` with `<legend>` headers, matching the styling from QuickAddPage:

1. **檔案選擇** — dropzone and file input
2. **故事位置** — series name input, story name input
3. **角色資料** — character filename input (角色檔案名稱), tags, name, description, personality, scenario, first message, example messages, creator notes, system prompt, post-history instructions, alternate greetings
4. **世界篇章** — world_info filename input (世界篇章檔案名稱), world_info name input (世界篇章名稱), and the collapsible book entries

The "角色檔案名稱" input SHALL be placed at the top of the 角色資料 section (before tags and name fields).

### MODIFIED Scenario: Editable form is hidden before a card is loaded
- **WHEN** the page loads with no file selected
- **THEN** only the 檔案選擇 fieldset SHALL be visible and active; the 角色資料, 故事位置, and 世界篇章 fieldsets SHALL be hidden

## MODIFIED Requirement: Import page route and structure

The world_info name input (世界篇章名稱) SHALL be pre-filled from `parsed.bookName` (empty if absent). The world_info filename input (世界篇章檔案名稱) SHALL be derived from `worldInfoName` using the same CJK-preserving slug logic as the character filename, with fallback to `world_info.md` when derivation yields empty.

**Auto-derivation rule:** If the user has NOT manually edited the world_info filename input, it SHALL automatically re-derive whenever `worldInfoName` changes (via a watcher or computed property). Once the user manually edits the filename, auto-derivation SHALL stop until the next card parse resets the form.

### MODIFIED Scenario: World_info filename is derived from character_book.name
- **WHEN** the parsed card has `character_book.name` = "悠奈"
- **THEN** the world_info name input SHALL show "悠奈" and the world_info filename input SHALL show "悠奈.md"

### NEW Scenario: Empty character_book.name falls back to world_info.md
- **WHEN** the parsed card has no `character_book.name` or it is empty after trim
- **THEN** the world_info name input SHALL be empty and the world_info filename SHALL default to "world_info.md"

### NEW Scenario: Manual filename edit stops auto-derivation
- **WHEN** the user manually edits the world_info filename input from "悠奈.md" to "custom.md", then changes 世界篇章名稱
- **THEN** the filename SHALL remain "custom.md" and SHALL NOT re-derive from the name

## NEW Requirement: Base themed-btn styling

The application's shared stylesheet (`base.css`) SHALL include base styles for `.themed-btn` (not just `:hover`):

```css
.themed-btn {
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 8px 16px;
  color: inherit;
  cursor: pointer;
  font-size: inherit;
}
```

This ensures buttons using `.themed-btn` are visible and styled before hover. The existing `:hover` rule remains unchanged.

### Scenario: themed-btn is visible without hover
- **WHEN** a `.themed-btn` element renders on any page
- **THEN** it SHALL have a visible border, background color, and padding — it SHALL NOT appear as unstyled/invisible text

## NEW Requirement: File input styling

The file input inside the dropzone SHALL be visually styled as a button-like trigger:

- The native `<input type="file">` SHALL be visually hidden (opacity 0, position absolute)
- A styled `<label>` element with class `file-trigger` SHALL serve as the click target with button-like appearance (border, padding, hover state)
- The dropzone area SHALL display instructional text and the file-trigger label

### Scenario: File input appears as a styled button
- **WHEN** the page loads
- **THEN** the file selector area SHALL display a styled button-like element for triggering file selection, not the browser's default file input widget

## NEW Requirement: Required field indicators and validation feedback

Required fields (系列名稱, 故事名稱, 角色檔案名稱, 世界篇章檔案名稱) SHALL display a "必填" indicator next to the field label. When the user clicks 匯入 and validation fails:

1. Each invalid field SHALL receive a red border (`border-color: #b41e3c`) via a `.has-error` class on the `.field` container
2. A descriptive error message SHALL appear below the invalid input
3. The "必填" indicator on invalid fields SHALL turn red to visually reinforce the error

### Scenario: Required fields show 必填 indicator
- **WHEN** the form is visible after card parse
- **THEN** the 系列名稱, 故事名稱, 角色檔案名稱, and 世界篇章檔案名稱 fields SHALL each display a "必填" label indicator

### Scenario: Empty required fields show red border on submit
- **WHEN** the user clicks 匯入 with 系列名稱 and 故事名稱 both empty
- **THEN** both fields SHALL show a red border and their respective error messages ("系列名稱為必填", "故事名稱為必填")

### Scenario: Validation errors clear on successful input
- **WHEN** a field previously showed an error and the user fills it correctly
- **THEN** the red border and error message SHALL be cleared on the next validation attempt (clicking 匯入 again)
