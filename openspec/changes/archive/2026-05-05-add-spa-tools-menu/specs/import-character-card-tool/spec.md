# Import Character Card Tool

## ADDED Requirements

### Requirement: Import page route and structure

The application SHALL provide an `ImportCharacterCardPage.vue` component mounted at `/tools/import-character-card` (route name `tools-import-character-card`, registered through `toolsChildren`). The page SHALL contain three regions in vertical order:

1. **File selector**: a drop-zone + `<input type="file" accept="image/png">` pair.
2. **Editable form**: textareas for every parsed character field, plus a series/story picker (series name input, story name input — same UX semantics as `StorySelector.vue` allowing either selecting an existing pair or typing a new pair) and a character lore filename input pre-filled with a CJK-preserving slug derived from the parsed character `name` plus `.md` (see *Filename derivation* below), and an optional world_info filename input pre-filled with `world_info.md`.
3. **Action region**: an 匯入 (Import) button and a status region for progress and errors.

The editable form region SHALL be hidden until a card has been successfully parsed.

#### Scenario: Page is reachable through the tools registry
- **WHEN** the user clicks "ST 角色卡轉換工具" in the header tools dropdown or the tools sidebar
- **THEN** the router SHALL navigate to `/tools/import-character-card` and `ImportCharacterCardPage.vue` SHALL render

#### Scenario: Editable form is hidden before a card is loaded
- **WHEN** the page loads with no file selected
- **THEN** the textareas, the series/story picker, the filename inputs, and the 匯入 button SHALL be hidden or disabled, and only the file selector SHALL be active

### Requirement: PNG character card parsing

The page SHALL parse the selected PNG client-side via a `parseCharacterCard(file: File): Promise<ParsedCharacterCard>` function that:

1. Rejects files larger than 16 MiB (`16 * 1024 * 1024` bytes) BEFORE reading them into an `ArrayBuffer`. On over-cap files the function SHALL throw `Error("檔案過大（>16 MiB）")`.
2. Reads the file's bytes via `await file.arrayBuffer()`.
3. Verifies the 8-byte PNG signature `89 50 4E 47 0D 0A 1A 0A`. On mismatch the function SHALL throw `Error("Not a PNG file")`.
4. Walks PNG chunks (`length(4) | type(4) | data | crc(4)`) until `IEND`, collecting every `tEXt` chunk's `(keyword, text)` pair where `keyword` is the bytes before the first `0x00` and `text` is the bytes after. If at any point a chunk's declared length plus its 12-byte framing would extend past the end of the buffer (i.e. the file is truncated mid-chunk), the function SHALL throw `Error("PNG 區塊不完整")` rather than silently returning whatever chunks were parsed so far.
5. Inspects the collected pairs:
   - If a pair with keyword `ccv3` is present and its base64-decoded JSON parses successfully, that JSON SHALL be the source of truth.
   - Otherwise, if a pair with keyword `chara` is present and its base64-decoded JSON parses successfully, that JSON SHALL be the source of truth.
   - If neither pair yields a parsable JSON, the function SHALL throw `Error("No SillyTavern character data found")`.
6. Normalises the chosen JSON (whose `data` object follows the TavernCardV2 / V3 schema) into a `ParsedCharacterCard` shape with the keys `name`, `description`, `personality`, `scenario`, `firstMes`, `mesExample`, `creatorNotes`, `systemPrompt`, `postHistoryInstructions`, `alternateGreetings` (string array), `tags` (string array), `creator`, `characterVersion`, `bookEntries` (array of `{ name: string, keys: string[], content: string }` derived from `data.character_book.entries[]` if present, else empty array). Missing fields SHALL be normalised to empty strings or empty arrays.
7. Enforces a safety ceiling on `bookEntries`: if `data.character_book.entries.length > 1000`, the function SHALL throw `Error("character_book.entries 超過 1000 筆，無法匯入")`. Inside the cap, all entries are preserved (no display-only truncation).

The page SHALL invoke `parseCharacterCard(file)` whenever the user picks a new file (drag-drop or file input). On success the editable form SHALL hydrate from the parsed shape. On failure the page SHALL display the thrown error message inline above the file selector and SHALL NOT clear any previously-shown form state.

#### Scenario: V3 card is preferred over V2 when both chunks are present
- **WHEN** the file contains both a `ccv3` chunk and a `chara` chunk and both decode successfully
- **THEN** the form SHALL hydrate from the `ccv3` JSON and SHALL ignore the `chara` JSON

#### Scenario: V2-only card hydrates from chara
- **WHEN** the file contains only a `chara` chunk
- **THEN** the form SHALL hydrate from the `chara` JSON

#### Scenario: V3-only card hydrates from ccv3
- **WHEN** the file contains only a `ccv3` chunk
- **THEN** the form SHALL hydrate from the `ccv3` JSON

#### Scenario: Missing both chunks surfaces an error
- **WHEN** the file is a valid PNG that contains neither a `ccv3` nor a `chara` `tEXt` chunk
- **THEN** the page SHALL display "No SillyTavern character data found" inline above the file selector and SHALL keep the editable form hidden

#### Scenario: Non-PNG file is rejected
- **WHEN** the user selects a file whose first 8 bytes are not the PNG signature
- **THEN** the page SHALL display "Not a PNG file" inline and SHALL NOT attempt to walk chunks

#### Scenario: Oversized file is rejected before parsing
- **WHEN** the user selects a file larger than 16 MiB
- **THEN** the page SHALL display "檔案過大（>16 MiB）" inline, SHALL NOT call `arrayBuffer()`, and SHALL keep the editable form hidden

#### Scenario: Truncated PNG is rejected
- **WHEN** the user selects a PNG whose final `tEXt` chunk header declares a length extending past the end of the file
- **THEN** the page SHALL display "PNG 區塊不完整" inline and SHALL NOT hydrate the editable form

#### Scenario: character_book over the safety cap is rejected
- **WHEN** the parsed JSON's `data.character_book.entries` contains more than 1000 items
- **THEN** the page SHALL display "character_book.entries 超過 1000 筆，無法匯入" inline and SHALL keep the editable form hidden

#### Scenario: Malformed base64 in chara is treated as missing
- **WHEN** the `chara` chunk contains text that is not valid base64 and no `ccv3` chunk is present
- **THEN** the page SHALL display "No SillyTavern character data found"

#### Scenario: Malformed JSON in ccv3 falls back to chara
- **WHEN** the `ccv3` chunk decodes from base64 but the result is not valid JSON, AND a `chara` chunk decodes and parses successfully
- **THEN** the form SHALL hydrate from the `chara` JSON

#### Scenario: character_book entries become bookEntries
- **WHEN** the source JSON's `data.character_book.entries` array contains three entries
- **THEN** the parsed `bookEntries` array SHALL contain three corresponding objects, each with `name` (from entry's `name` or first key), `keys` (from entry's `keys`), and `content` (from entry's `content`)

### Requirement: Editable form bound to parsed shape

The page SHALL render one textarea per scalar character field (`name`, `description`, `personality`, `scenario`, `firstMes`, `mesExample`, `creatorNotes`, `systemPrompt`, `postHistoryInstructions`), one textarea per element of `alternateGreetings`, and one collapsible block per element of `bookEntries` containing three controls (name input, comma-separated keys input, body textarea). Every control SHALL be `v-model`-bound to a writable form state object that was hydrated from the parser output. The user SHALL be able to edit, add, or delete `alternateGreetings` and `bookEntries` items before clicking 匯入.

#### Scenario: Edits persist into form state
- **WHEN** the user types into any textarea after parsing
- **THEN** the corresponding form state field SHALL reflect the user's input, and re-reading the textarea's value SHALL return the edited string

#### Scenario: Edits do not mutate the parsed source
- **WHEN** the user edits a textarea
- **THEN** the original `ParsedCharacterCard` returned by `parseCharacterCard` SHALL remain unchanged (the form SHALL operate on a deep copy of the parsed shape)

#### Scenario: Deleting a book entry removes it from the form
- **WHEN** the user clicks the delete control on a `bookEntries` item
- **THEN** that item SHALL be removed from the form state and the corresponding collapsible block SHALL no longer render

### Requirement: Import writes the edited form state

The 匯入 button SHALL read the **current form state** (the values currently bound to the textareas at click time, NOT the original `ParsedCharacterCard` returned by the parser) and SHALL execute the following sequence with `useAuth().getAuthHeaders()` for every request, stopping at the first failure. All lore PUT URLs SHALL be **scope-relative** (no `_lore/` segment) — the backend prepends `_lore/` internally; including it client-side would write to a duplicated `_lore/_lore/` directory.

1. Validate the series name, story name, and resolved filenames per the same rules as the Quick-Add tool, including the *Filename derivation and validation* requirement below. If validation fails, display the error inline and issue no network calls.
2. Sanitise `form.tags` per the *Tag sanitisation* requirement. Display any drop-warnings inline above the 匯入 button.
3. Run the *Collision preflight* requirement against both the character filename and (if applicable) the world_info filename. If either collides and the user has not yet acknowledged, abort the import and surface the warning + overwrite checkbox.
4. `POST /api/stories/:seriesName/:storyName/init` (idempotent — 200 or 201 both treated as success; 200 surfaces a non-blocking notice "已沿用現有故事資料夾").
5. `PUT /api/lore/story/:seriesName/:storyName/<characterFilename>` with body:
   - `frontmatter`: `{ enabled: true, priority: 0 }` plus `tags: <sanitisedTags>` only if `sanitisedTags.length > 0`. Frontmatter SHALL NOT contain a `name` key (the backend frontmatter validator at `writer/routes/lore.ts` accepts only `tags`/`priority`/`enabled` and silently drops every other key — the human display name is preserved as the body H1 instead).
   - `content`: a markdown document beginning with `# <form.name>` (omitted only if `form.name` is empty after trim) followed by a blank line, then the major sections joined by `\n\n` and skipping any section whose source field is empty after trimming, in this order:
     - `## Description\n<form.description>`
     - `## Personality\n<form.personality>`
     - `## Scenario\n<form.scenario>`
     - `## First Message\n<form.firstMes>`
     - `## Example Messages\n<form.mesExample>`
     - `## System Prompt\n<form.systemPrompt>`
     - `## Post-History Instructions\n<form.postHistoryInstructions>`
     - `## Alternate Greetings` followed by one bullet `- <greeting>` per non-empty entry of `form.alternateGreetings`
     - `## Creator Notes\n<form.creatorNotes>`
6. If `form.bookEntries.length > 0`, `PUT /api/lore/story/:seriesName/:storyName/<worldInfoFilename>` with body:
   - `frontmatter`: `{ enabled: true, priority: 0 }`. SHALL NOT contain a `name` key.
   - `content`: a markdown document beginning with `# <form.worldInfoName>` (the world_info display name input; omitted if empty), followed by one section per `bookEntries` item: `## <entry.name>\n**Keys:** <entry.keys joined by ", ">\n\n<entry.content>`, sections separated by `\n\n`.

The character lore PUT body SHALL NOT include any field whose form state value is empty after trimming (other than the explicit defaults named above for frontmatter). On full success the page SHALL navigate to `router.push({ name: "story", params: { series, story } })`.

#### Scenario: Edited textarea content is what gets written
- **WHEN** the user parses a card whose `description` is "original" then edits the description textarea to "edited" and clicks 匯入
- **THEN** the character lore PUT body's `content` field SHALL contain the section `## Description\nedited` and SHALL NOT contain the substring `original` (unless the user kept it elsewhere)

#### Scenario: No book entries means no world_info PUT
- **WHEN** the user imports a card whose `bookEntries` is empty (after any edits) and clicks 匯入
- **THEN** the page SHALL issue exactly one story-init POST and one character lore PUT, and SHALL NOT issue a world_info PUT

#### Scenario: With book entries, world_info PUT contains all entries
- **WHEN** the user imports a card whose `bookEntries` has two entries `(name="Alice", keys=["alice","a"], content="Alice description")` and `(name="Bob", keys=["bob"], content="Bob description")`
- **THEN** the world_info PUT body's `content` SHALL contain both `## Alice` and `## Bob` sections, with each section followed by the entry's keys joined by `, ` under `**Keys:**` and the entry's content body

#### Scenario: Empty scalar fields are omitted from the markdown
- **WHEN** the user clears the `systemPrompt` textarea before importing
- **THEN** the character lore PUT body's `content` SHALL NOT contain a `## System Prompt` heading

#### Scenario: Validation failure issues no network calls
- **WHEN** the user leaves the series name empty and clicks 匯入
- **THEN** the page SHALL display the validation error inline, SHALL NOT issue any POST or PUT, and SHALL keep the form state intact for the user to correct

#### Scenario: Tags only included when non-empty
- **WHEN** the sanitised tags array is empty (length 0)
- **THEN** the character lore PUT body's `frontmatter` SHALL NOT contain a `tags` key

#### Scenario: Frontmatter never contains the display name
- **WHEN** the form issues either lore PUT
- **THEN** the JSON body's `frontmatter` object SHALL NOT contain a `name` key, and the display name SHALL appear instead as the first H1 of the body content

#### Scenario: Lore PUT URL does not contain a _lore segment
- **WHEN** the form issues either lore PUT
- **THEN** the request URL SHALL NOT contain the substring `/_lore/` anywhere in its pathname

### Requirement: Tag sanitisation against backend validator

Before any lore PUT, `form.tags` SHALL be sanitised against the same `isValidTag` rule the backend enforces (`writer/routes/lore.ts`: a tag must be a non-empty string, ≤ 100 characters, and contain none of `[`, `]`, `,`, `\n`, `\r`). For each tag in `form.tags`:

- If it is empty after trim, drop it silently.
- If it is over 100 characters, drop it and surface an inline warning "已忽略過長標籤：<truncated preview>".
- If it contains any of `[`, `]`, `,`, `\n`, `\r`, drop it and surface an inline warning "已忽略含特殊字元的標籤：<tag>".

The sanitised array SHALL be used in the lore PUT body. The original `form.tags` SHALL remain untouched in form state so the user sees what the parser produced and which entries were dropped.

#### Scenario: Tag with comma is dropped with warning
- **WHEN** the imported card supplies tag `"adventure, fantasy"`
- **THEN** the character lore PUT's `frontmatter.tags` SHALL NOT contain that tag, and the page SHALL display "已忽略含特殊字元的標籤：adventure, fantasy" inline

#### Scenario: All tags survive sanitisation
- **WHEN** every tag in `form.tags` passes `isValidTag`
- **THEN** the character lore PUT's `frontmatter.tags` SHALL equal the input array verbatim and no warning SHALL be displayed

### Requirement: Collision preflight before lore PUT

Because the lore PUT endpoint silently overwrites any existing file at the same scope-relative path, the importer SHALL run a preflight before each lore PUT:

- For the character file: `GET /api/lore/story/:series/:story/<characterFilename>`. A 200 response means the file exists; 404 means it does not.
- For the world_info file (only when `bookEntries.length > 0`): the analogous GET against `<worldInfoFilename>`.

**Any preflight response other than 200 or 404 (e.g., 401, 403, 500), and any thrown network error, SHALL be treated as a preflight failure**: the page SHALL surface an inline error "預檢典籍失敗：<reason>", SHALL abort the submission, and SHALL NOT issue any `POST /init` or lore PUT.

Acknowledgement is **per-resolved-filename**: the page SHALL track, for each lore group, the exact filename that the user explicitly acknowledged via the 覆寫現有典籍 checkbox. Whenever the resolved filename for a group changes (because the user edited the filename input, the source name used for derivation, or—for world_info—the world_info name), any prior acknowledgement for that group SHALL be cleared and the page SHALL re-run preflight on the next submit.

When any preflight returns 200 the importer SHALL:

- Display the inline warning "已存在同名典籍：<filename>" beside the corresponding filename input.
- Render an unchecked "覆寫現有典籍" checkbox beside the warning.
- Disable the 匯入 button until either (a) every colliding file's checkbox is toggled on for its *current* resolved filename, or (b) the user changes the offending filename to one whose preflight returns 404.

Once acknowledged, the import proceeds to the PUT(s) as normal.

#### Scenario: Existing character file blocks import until acknowledged
- **WHEN** the preflight GET against `<characterFilename>` returns 200
- **THEN** the page SHALL display the warning, render the unchecked overwrite checkbox, and disable 匯入

#### Scenario: Acknowledged collision proceeds with PUT
- **WHEN** a collision was surfaced for the character file and the user toggles the overwrite checkbox on, then clicks 匯入
- **THEN** the page SHALL proceed with the documented call sequence and SHALL include the lore PUT for that file

#### Scenario: 404 preflight skips the warning
- **WHEN** both preflight GETs return 404
- **THEN** the page SHALL NOT display any collision warning and SHALL NOT render any overwrite checkbox

#### Scenario: Preflight non-200/non-404 status fails closed
- **WHEN** the preflight GET returns 401, 403, 500, or any status other than 200/404
- **THEN** the page SHALL surface "預檢典籍失敗：<status>" inline, and SHALL NOT issue any `POST /init` or lore PUT

#### Scenario: Preflight network error fails closed
- **WHEN** the preflight `fetch()` throws (e.g., offline)
- **THEN** the page SHALL surface "預檢典籍失敗：<error message>" inline, and SHALL NOT issue any subsequent request

#### Scenario: Filename change after acknowledgement re-runs preflight
- **WHEN** the user acknowledged a collision for `Hero.md`, then edits 角色檔案名稱 to `Other.md`, then clicks 匯入
- **THEN** the prior acknowledgement SHALL be cleared, the page SHALL re-run the preflight against `Other.md`, and SHALL re-block submission with a fresh unchecked 覆寫現有典籍 checkbox if `Other.md` also collides

#### Scenario: Retry after world_info PUT failure does not re-write the character file
- **WHEN** the character PUT succeeded but the world_info PUT failed in the same submission, and the user clicks 匯入 again without changing the character filename
- **THEN** the page SHALL skip the character preflight and the character PUT entirely, and SHALL retry only the world_info preflight + PUT

### Requirement: Series and story name validation

The page SHALL validate `seriesName` and `storyName` against the same rules the backend `isValidParam` enforces in `writer/lib/middleware.ts`:

- The trimmed value SHALL NOT be empty.
- It SHALL NOT contain `..`, `/`, `\`, or NUL.
- It SHALL NOT start with `_`.
- It SHALL NOT match any reserved platform directory name: `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`.

If either field fails validation, the page SHALL block submission with "系列名稱無效" or "故事名稱無效" beside the offending field, and SHALL NOT issue any backend request.

#### Scenario: Underscore-prefixed series name is rejected client-side
- **WHEN** the user enters `_bad` in 系列名稱 and clicks 匯入
- **THEN** the page SHALL block submission with "系列名稱無效" and SHALL NOT issue any backend request

### Requirement: Dirty-form guard on subsequent file pick

The page SHALL maintain a *hydration snapshot* whenever `parseCharacterCard` succeeds — capturing both (a) a deep clone of the structured form state and (b) a scalar snapshot of the per-import scalar fields: `seriesName`, `storyName`, `characterFilename`, `worldInfoName`, `worldInfoFilename`. When the user picks a *different* file (drag-drop or file input) while the form is visible, the page SHALL compare the current form state and current scalar fields to the snapshot.

- If both are deeply equal (form is *clean*), the page SHALL parse the new file and replace the form state without prompting.
- If either differs in any field (form is *dirty*), the page SHALL display a confirmation prompt "丟棄目前編輯並載入新檔案？" before parsing. On cancel the file pick SHALL be discarded and the current form state and scalar fields SHALL be preserved. On confirm the page SHALL parse the new file, replace the form state, reset the scalar fields, and capture a fresh hydration snapshot.

#### Scenario: Clean form replaces silently on second pick
- **WHEN** the user has parsed a card and not edited any field, then picks a different PNG
- **THEN** the page SHALL parse the new file and replace the form state without showing the discard prompt

#### Scenario: Dirty form prompts for confirmation
- **WHEN** the user has parsed a card, edited the description textarea, then picks a different PNG
- **THEN** the page SHALL display the prompt "丟棄目前編輯並載入新檔案？" and SHALL NOT touch the form state until the user responds

#### Scenario: Cancel preserves form state
- **WHEN** the dirty-form prompt is displayed and the user clicks cancel
- **THEN** the form state SHALL remain exactly as it was before the file pick, and the new file SHALL NOT be parsed

#### Scenario: Edit to a scalar field alone is dirty
- **WHEN** the user has parsed a card and edited only one of `seriesName` / `storyName` / `characterFilename` / `worldInfoName` / `worldInfoFilename` (and no structured form field), then picks a different PNG
- **THEN** the page SHALL display the discard confirmation prompt before parsing the new file


### Requirement: Filename derivation and validation

The character filename input SHALL be pre-filled, on each successful parse, with a CJK-preserving slug derived from `parsed.name`:

- NFC-normalise the string.
- Replace each character matching `[\\/:*?"<>|\u0000-\u001F]` with `-`.
- Collapse runs of whitespace to a single `-`.
- Trim leading/trailing `-` and `.`.
- Append `.md`.
- CJK Unified Ideographs (`\u3400-\u9FFF`, `\u4E00-\u9FFF`), Hiragana, Katakana, Hangul, and other non-ASCII letters SHALL be preserved verbatim — no transliteration, no romanisation.
- If the result before appending `.md` is empty, the pre-fill SHALL fall back to `character.md`.

The user MAY override the pre-filled value at any time. The world_info filename input SHALL be pre-filled with `world_info.md`.

The resolved filenames (after any user edits, with `.md` appended if missing) SHALL be validated as follows before any network call:

- They SHALL match `^[^\\/:*?"<>|\u0000-\u001F]+\.md$` (no path separators, no Windows-reserved characters, no control characters; CJK and other non-ASCII letters allowed).
- They SHALL NOT contain `..` as a substring.
- They SHALL NOT start with `.` or `_` (matching the backend's reserved-name rule).
- Their UTF-8 byte length SHALL NOT exceed 255 bytes.

If validation fails the form SHALL block 匯入 and display "檔案名稱無效" beside the offending input.

#### Scenario: CJK character name yields a CJK filename
- **WHEN** the parsed card's `name` is `林小美`
- **THEN** the character filename input SHALL pre-fill with `林小美.md` (CJK preserved verbatim)

#### Scenario: Empty derivation falls back to character.md
- **WHEN** the parsed card's `name` is empty or contains only whitespace and forbidden characters
- **THEN** the character filename input SHALL pre-fill with `character.md`

#### Scenario: Path traversal in filename is rejected
- **WHEN** the user replaces the pre-filled character filename with `../foo.md` and clicks 匯入
- **THEN** the form SHALL block submission with the validation error and SHALL NOT issue the lore PUT

### Requirement: Source file bytes are never sent to the backend

The PNG bytes of the selected file SHALL never be uploaded to the backend through any endpoint. Only the JSON-shaped lore PUT bodies derived from the form state SHALL be transmitted.

#### Scenario: No multipart upload to the backend
- **WHEN** the user picks a PNG and clicks 匯入
- **THEN** no request body of `multipart/form-data` content type containing the PNG SHALL be issued to the server, and the only outgoing requests SHALL be the documented JSON POST/PUT calls
