# Quick Add Tool

## Purpose

Single-form `/tools/new-series` page that bootstraps a new series + story folder pair in one submission, optionally seeding it with a character lore file and a world_info lore file under the story scope.

## Requirements

### Requirement: Quick-Add page route and form

The application SHALL provide a `QuickAddPage.vue` component mounted at `/tools/new-series` (route name `tools-new-series`, registered through `toolsChildren`). The page SHALL render a single `<form>` with the following input controls in this order:

1. **系列名稱** — text input, required, bound to a `seriesName` ref.
2. **故事名稱** — text input, required, bound to a `storyName` ref.
3. **角色名稱** — text input, optional, bound to `characterName` (rendered as the H1 of the character lore body and used to derive the default filename).
4. **角色檔案名稱** — text input, optional, bound to `characterFilename` (the `.md` filename written under the story's lore scope; auto-derived from `characterName` when blank).
5. **角色設定內容** — textarea, optional, bound to `characterContent` (the markdown body of the character lore file).
6. **世界典籍名稱** — text input, optional, bound to `worldInfoName`.
7. **世界典籍檔案名稱** — text input, optional, bound to `worldInfoFilename` and pre-filled with the literal string `world_info.md` (treated as a placeholder/default — see *All-or-skipped rule* below; the user is NOT required to clear it to opt out of the world_info group).
8. **世界典籍內容** — textarea, optional, bound to `worldInfoContent`.

Below the inputs the page SHALL render exactly one submit button labelled **建立** (Create) and a status region for progress and errors.

#### Scenario: Page is reachable through the tools registry
- **WHEN** the user clicks "快速新增" in the header tools dropdown or the tools sidebar
- **THEN** the router SHALL navigate to `/tools/new-series` and `QuickAddPage.vue` SHALL render

#### Scenario: All form fields are present and labelled
- **WHEN** `QuickAddPage.vue` is rendered
- **THEN** all eight controls SHALL be present, each with a `<label>` whose text matches the Chinese label specified above

### Requirement: Required fields enforcement

The form SHALL require non-empty trimmed values for **系列名稱** and **故事名稱**. The submit button SHALL be disabled while either of these required values is empty, and submission SHALL also be guarded server-side by the existing `/api/stories/:series/:name/init` validation. Series and story name validation SHALL reject reserved directory names per the existing backend rule (filenames starting with `.` or `_`, plus the existing reserved literals).

#### Scenario: Submit disabled until required fields are filled
- **WHEN** the user has entered only the series name and the story name field is empty
- **THEN** the **建立** button SHALL be disabled

#### Scenario: Series name is required
- **WHEN** the user submits with an empty series name
- **THEN** the form SHALL block submission and display "系列名稱為必填" inline next to the field

#### Scenario: Story name is required
- **WHEN** the user submits with an empty story name
- **THEN** the form SHALL block submission and display "故事名稱為必填" inline next to the field

### Requirement: All-or-skipped rule for optional lore groups

For each optional lore group, *activity* is determined by the display name and body fields only. The filename field is treated as a placeholder/derived value and SHALL NOT participate in the activity test.

- **Character group**: active iff `characterName.trim() !== ""` AND `characterContent.trim() !== ""`. When inactive, no character lore PUT is issued (regardless of any value the user typed in the filename field).
- **World_info group**: active iff `worldInfoName.trim() !== ""` AND `worldInfoContent.trim() !== ""`. When inactive, no world_info lore PUT is issued — the pre-filled `world_info.md` filename does NOT make the group active by itself.
- If exactly one of `{display name, body}` for a group is empty after trim, the form SHALL block submission and display "請填寫名稱與內容，或將兩者都留空" inline beside the partially filled group.

When a group is active, its filename is required and SHALL be auto-filled if blank: the character filename derives from `characterName` (see *Filename derivation* below); the world_info filename uses the existing pre-fill `world_info.md`. The user MAY override either filename, in which case the user's value is used after `.md` auto-extension.

#### Scenario: Both groups inactive submits with story-only
- **WHEN** all four name+body fields (角色名稱, 角色設定內容, 世界典籍名稱, 世界典籍內容) are empty after trimming and the user clicks 建立 — even if the world_info filename still shows its default `world_info.md`
- **THEN** the form SHALL submit, the backend SHALL receive only the story-init call, and no lore PUT calls SHALL be issued

#### Scenario: Character group active triggers character lore PUT
- **WHEN** the user fills 角色名稱 and 角色設定內容 (filename left blank), leaves world_info name+body empty, and clicks 建立
- **THEN** the form SHALL issue exactly one story-init call and one character lore PUT, the lore PUT URL SHALL use the auto-derived character filename, and SHALL NOT issue a world_info lore PUT

#### Scenario: World_info group active triggers world_info lore PUT
- **WHEN** the user fills 世界典籍名稱 and 世界典籍內容, leaves character name+body empty, and clicks 建立
- **THEN** the form SHALL issue exactly one story-init call and one world_info lore PUT, and SHALL NOT issue a character lore PUT

#### Scenario: Default world_info filename alone does not activate the group
- **WHEN** the user has entered series + story names, has not touched any character or world_info field, and the world_info filename input still shows its placeholder `world_info.md`
- **THEN** the world_info group SHALL be considered inactive and no world_info lore PUT SHALL be issued

#### Scenario: Partial character group blocks submission
- **WHEN** the user fills 角色名稱 but leaves 角色設定內容 empty
- **THEN** the form SHALL block submission, display "請填寫名稱與內容，或將兩者都留空" beside the character group, and issue no network calls

#### Scenario: Partial world_info group blocks submission
- **WHEN** the user enters 世界典籍名稱 but leaves 世界典籍內容 empty
- **THEN** the form SHALL block submission, display the same message beside the world_info group, and issue no network calls

### Requirement: Submission orchestration and call sequence

On a successful submit, the page SHALL execute the following calls sequentially through `fetch` with the existing `X-Passphrase` auth header (via `useAuth().getAuthHeaders()`), stopping at the first failure. All lore URLs SHALL be **scope-relative**: the path segment after `/api/lore/story/:series/:story/` is the bare filename. The page MUST NOT include a `_lore/` segment in the URL — the backend (`writer/routes/lore.ts` `scopeSegments`) prepends `_lore/` internally; including it client-side would produce a duplicated `_lore/_lore/` directory.

1. `POST /api/stories/:seriesName/:storyName/init` (story directory + empty `001.md`).
2. If the character group is active: `PUT /api/lore/story/:seriesName/:storyName/<characterFilename>` with body `{ frontmatter: { enabled: true, priority: 0 }, content: "# <characterName>\n\n<characterContent>" }`. If `characterFilename` does not end in `.md` after trimming, the form SHALL append `.md` before issuing the request.
3. If the world_info group is active: `PUT /api/lore/story/:seriesName/:storyName/<worldInfoFilename>` with body `{ frontmatter: { enabled: true, priority: 0 }, content: "# <worldInfoName>\n\n<worldInfoContent>" }`. The same `.md` extension rule SHALL apply.

Frontmatter SHALL contain ONLY `enabled` and `priority` (both `tags` is intentionally omitted so the lore-storage implicit tag rules supply retrieval keys; the human display name is intentionally NOT in frontmatter because the backend frontmatter validator at `writer/routes/lore.ts` accepts only `tags`/`priority`/`enabled` and silently drops every other key — the display name is preserved in the body H1 and the filename instead).

While the calls are in flight, the submit button SHALL be disabled and the status region SHALL display "建立中…" plus the current step name. On full success the page SHALL navigate to the newly-created story route via `router.push({ name: "story", params: { series: seriesName, story: storyName } })`. On failure the page SHALL display the failed step's name plus the response error text and SHALL NOT navigate; the user SHALL be able to retry by clicking 建立 again (the story directory may already exist — the init endpoint is idempotent and returns 200 in that case, which the form SHALL treat as success but SHALL surface as a non-blocking notice "已沿用現有故事資料夾").

#### Scenario: Successful create-only submission (no lore)
- **WHEN** the user submits with only series and story names
- **THEN** the page SHALL issue exactly one POST to `/api/stories/<series>/<story>/init`, on 201 or 200 SHALL navigate to `/<series>/<story>`, and SHALL NOT issue any lore PUT

#### Scenario: Successful submission with character only
- **WHEN** the user submits with the character group active and the world_info group skipped
- **THEN** the page SHALL issue the init POST followed by a single PUT whose URL is exactly `/api/lore/story/<series>/<story>/<characterFilename>` (no `_lore/` segment), with the documented body shape, then navigate to the story route

#### Scenario: Lore PUT URL does not contain a _lore segment
- **WHEN** the form issues a character or world_info lore PUT for any submission
- **THEN** the request URL SHALL NOT contain the substring `/_lore/` anywhere in its pathname

#### Scenario: Frontmatter contains only enabled and priority
- **WHEN** the form issues either lore PUT
- **THEN** the JSON body's `frontmatter` object SHALL contain exactly the keys `enabled` and `priority`, SHALL NOT contain a `name` key, and SHALL NOT contain a `tags` key

#### Scenario: Successful submission with both lore groups
- **WHEN** the user submits with both groups active
- **THEN** the page SHALL issue the init POST, then the character PUT, then the world_info PUT in that order, and SHALL NOT issue the world_info PUT before the character PUT

#### Scenario: Init failure halts the sequence
- **WHEN** the init POST returns a non-2xx response
- **THEN** the page SHALL NOT issue any lore PUT, SHALL surface the error inline with the message "建立故事失敗：<server message>", and SHALL NOT navigate

#### Scenario: Character PUT failure halts before world_info
- **WHEN** the character PUT returns a non-2xx response
- **THEN** the page SHALL NOT issue the world_info PUT, SHALL surface the error inline with the message "建立角色典籍失敗：<server message>", and SHALL NOT navigate

#### Scenario: World_info PUT failure does not roll back prior writes
- **WHEN** the world_info PUT returns a non-2xx response after the character PUT succeeded
- **THEN** the page SHALL surface the error inline with the message "建立世界典籍失敗：<server message>", SHALL NOT navigate, SHALL NOT delete the already-written character lore file, and SHALL allow the user to fix the world_info fields and retry; on retry the previously-successful steps MAY be re-issued because both the init endpoint and lore PUT are idempotent

#### Scenario: Existing story shows a non-blocking notice and proceeds
- **WHEN** the init POST returns HTTP 200 because the story directory already exists
- **THEN** the page SHALL display the non-blocking notice "已沿用現有故事資料夾" and SHALL proceed to the lore writes (if any) exactly as it does after a 201 response

#### Scenario: Filename auto-extends to .md
- **WHEN** the user types `hero` into 角色檔案名稱 (no extension) and submits with the character group active
- **THEN** the request URL SHALL be `/api/lore/story/<series>/<story>/hero.md` (the form appends `.md`)

### Requirement: Lore-file collision detection (preflight)

Because the lore PUT endpoint silently overwrites any existing file at the same path (`writer/routes/lore.ts` `handleWritePassage` does no preflight and returns 200 on overwrite), Quick-Add SHALL itself perform a preflight before each active lore group's PUT.

The preflight is a `GET /api/lore/story/:series/:story/<filename>` against the *same scope-relative path* the PUT would use (no `_lore/` segment). A 200 response means the file already exists; a 404 means it does not. **Any other response status (e.g., 401, 403, 500) and any thrown network error SHALL be treated as a preflight failure**: the form SHALL surface an inline error "預檢典籍失敗：<reason>" beside the submit area, SHALL abort the submission immediately, and SHALL NOT issue any `POST /init` or lore PUT request.

Acknowledgement is **per-resolved-filename**: the form SHALL track, for each lore group, the exact filename that the user explicitly acknowledged via the 覆寫現有典籍 checkbox. Whenever the resolved filename for a group changes (because the user edited the filename input or the source name used for derivation), any prior acknowledgement for that group SHALL be cleared and the form SHALL re-run preflight on the next submit.

When the preflight returns 200 for a group, the form SHALL:

- Surface an inline warning beside the group: "已存在同名典籍：<filename>".
- Render an "覆寫現有典籍" checkbox (unchecked by default) beside the warning.
- Disable the 建立 button until either (a) the user toggles the overwrite checkbox on for the *current* resolved filename of every colliding group, or (b) the user changes the offending filename to one that no longer collides (re-running the preflight).

Once all colliding groups are explicitly acknowledged via the checkbox for their current resolved filename, the form SHALL proceed with the PUT(s) as normal.

#### Scenario: Preflight detects an existing character file
- **WHEN** the user submits with the character group active and the preflight GET returns 200
- **THEN** the form SHALL NOT issue the character PUT, SHALL surface "已存在同名典籍：<filename>" beside the character group, SHALL render an unchecked 覆寫現有典籍 checkbox, and SHALL disable the 建立 button

#### Scenario: Overwrite checkbox unblocks the write
- **WHEN** a collision was surfaced for a group and the user toggles the 覆寫現有典籍 checkbox on, then clicks 建立
- **THEN** the form SHALL re-run the preflight (still returns 200) and SHALL proceed with the PUT for that group, treating the overwrite as confirmed

#### Scenario: Preflight 404 proceeds without prompting
- **WHEN** the preflight GET returns 404 for an active group
- **THEN** the form SHALL proceed directly to the PUT for that group without surfacing the warning or rendering an overwrite checkbox

#### Scenario: Preflight non-200/non-404 status fails closed
- **WHEN** the preflight GET returns 401, 403, 500, or any status other than 200/404
- **THEN** the form SHALL surface "預檢典籍失敗：<status>" inline, SHALL NOT issue the `POST /init` request, and SHALL NOT issue any lore PUT

#### Scenario: Preflight network error fails closed
- **WHEN** the preflight `fetch()` throws (e.g., offline, DNS failure)
- **THEN** the form SHALL surface "預檢典籍失敗：<error message>" inline, and SHALL NOT issue any subsequent request

#### Scenario: Filename change after acknowledgement re-runs preflight
- **WHEN** the user acknowledged a collision for `Hero.md`, then edits 角色檔案名稱 to `Other.md`, then clicks 建立
- **THEN** the prior acknowledgement SHALL be cleared, the form SHALL re-run the preflight against `Other.md`, and SHALL re-block submission with a fresh unchecked 覆寫現有典籍 checkbox if `Other.md` also collides

#### Scenario: Retry after a partial failure does not re-write previously-successful files
- **WHEN** the character PUT succeeded but the world_info PUT failed in the same submission, and the user fixes the world_info field and clicks 建立 again
- **THEN** the form SHALL skip the character preflight and the character PUT for the already-written filename, SHALL proceed directly to the world_info preflight + PUT, and SHALL surface no fresh collision prompt for the character file

### Requirement: Filename derivation and validation

For each active lore group, the resolved filename SHALL be derived (when blank) and validated as follows.

**Derivation** (only when the user-entered filename is empty after trim):

- **Character group**: derive from `characterName` by (a) NFC-normalising the string, (b) replacing each character matching `[\\/:*?"<>|\u0000-\u001F]` with `-`, (c) collapsing runs of whitespace to a single `-`, (d) trimming leading/trailing `-` and `.`, (e) appending `.md`. CJK Unified Ideographs (`\u3400-\u9FFF`, `\u4E00-\u9FFF`), Hiragana, Katakana, Hangul, and other non-ASCII letters SHALL be preserved verbatim — no transliteration, no romanisation. If the result before appending `.md` is empty, the derived filename SHALL fall back to `character.md`.
- **World_info group**: derive (only if the placeholder was cleared by the user) using the same rule applied to `worldInfoName`, with fallback `world_info.md`.

**Validation** (after `.md` auto-extension and any derivation):

- The filename SHALL match `^[^\\/:*?"<>|\u0000-\u001F]+\.md$` (no path separators, no Windows-reserved characters, no control characters; CJK and other non-ASCII letters allowed).
- It SHALL NOT contain `..` as a substring.
- It SHALL NOT start with `.` or `_` (matching the backend's reserved-name rule).
- Its byte length SHALL NOT exceed 255 bytes when UTF-8 encoded.

If the resolved filename fails validation, the form SHALL block submission and display "檔案名稱無效" beside the offending field.

#### Scenario: CJK character name yields a CJK filename
- **WHEN** the user enters `林小美` in 角色名稱, leaves 角色檔案名稱 blank, fills 角色設定內容, and submits
- **THEN** the derived filename SHALL be `林小美.md` (CJK preserved verbatim) and the PUT URL SHALL be `/api/lore/story/<series>/<story>/林小美.md` (subject to standard URL encoding)

#### Scenario: Empty derivation falls back to character.md
- **WHEN** the user enters only whitespace and forbidden characters in 角色名稱 (e.g. `///`), leaves 角色檔案名稱 blank, fills 角色設定內容, and submits
- **THEN** the derived filename SHALL be `character.md`

#### Scenario: Path traversal in filename is rejected
- **WHEN** the user enters `../foo.md` in 角色檔案名稱
- **THEN** the form SHALL block submission with the validation error and SHALL NOT issue the lore PUT

#### Scenario: Underscore-prefixed filename is rejected
- **WHEN** the user enters `_hidden.md` in 世界典籍檔案名稱
- **THEN** the form SHALL block submission with the validation error

### Requirement: Series and story name validation

The form SHALL validate `seriesName` and `storyName` against the same rules the backend `isValidParam` enforces in `writer/lib/middleware.ts`:

- The trimmed value SHALL NOT be empty.
- It SHALL NOT contain `..`, `/`, `\`, or NUL.
- It SHALL NOT start with `_`.
- It SHALL NOT match any reserved platform directory name: `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`.

If either field fails validation, the form SHALL block submission, display "系列名稱無效" or "故事名稱無效" beside the offending field, and SHALL NOT issue any `POST /init` or lore PUT.

#### Scenario: Underscore-prefixed series name is rejected client-side
- **WHEN** the user enters `_secret` in 系列名稱 and submits
- **THEN** the form SHALL block submission with "系列名稱無效" and SHALL NOT issue any backend request

#### Scenario: Reserved platform directory name as story is rejected
- **WHEN** the user enters `lost+found` in 故事名稱 and submits
- **THEN** the form SHALL block submission with "故事名稱無效"
