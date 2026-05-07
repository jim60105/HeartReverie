## MODIFIED Requirements

### Requirement: Branch a story at a chosen chapter

The server SHALL expose `POST /api/stories/:series/:name/branch` that forks the target story by copying chapters `001.md` through `NNN.md` (inclusive, where `N = fromChapter`) into a new story directory within the same series. The request body SHALL be valid JSON matching `{ fromChapter: number, newName?: string }`; a malformed JSON body, a missing `fromChapter`, a non-numeric `fromChapter`, or a non-string `newName` SHALL cause the server to return HTTP 400 with an RFC 9457 Problem Details body and SHALL NOT create any directory. `fromChapter` SHALL be a positive integer (greater than or equal to 1) less than or equal to the current highest chapter number; a value of `0`, a negative value, or a non-integer number SHALL cause the server to return HTTP 400. If the source story directory `playground/:series/:name/` does not exist, the server SHALL return HTTP 404 with an RFC 9457 Problem Details body and SHALL NOT create any directory. When `newName` is omitted, the server SHALL generate it as `<originalName>-branch-<unixMillis>`. `newName` SHALL be validated with `isValidParam()` — reserved prefixes (leading `_` or `.`), path traversal segments, and empty strings SHALL be rejected with HTTP 400. The destination directory SHALL be created with `Deno.mkdir(..., { recursive: false })`; if it already exists the server SHALL return HTTP 409. Each copied chapter SHALL be written atomically (temp file + `Deno.rename` in the destination directory). If a story-scoped `_lore/` subdirectory exists in the source, it SHALL be recursively copied into the destination so the branch is self-contained for story-level lore; series-level and global lore SHALL remain shared by reference (not copied). If the source story contains a `_config.json` file, it SHALL be copied to the destination directory (best-effort; a missing file SHALL be silently skipped). If the source story contains an `_images/_metadata.json` file, the server SHALL read it and filter entries to those satisfying `entry.chapter <= fromChapter AND entry.status !== "generating"`; entries with `status: "generating"` SHALL be excluded because no generation worker exists in the branched story and copying them would leave permanently stuck UI spinners. The server SHALL write the filtered metadata to `<destDir>/_images/_metadata.json` only if at least one entry passes the filter. The server SHALL copy image files from `<srcDir>/_images/` using the `filename` field of each filtered metadata entry; files that do not exist on disk SHALL be silently skipped. The `_images/` directory in the destination SHALL only be created if at least one metadata entry is written or at least one image file is successfully copied. All image and config copy operations SHALL be best-effort: `Deno.errors.NotFound` SHALL be silently ignored (images/config may not exist), and other errors SHALL be logged at warn level but SHALL NOT fail the branch operation. If any step fails after `Deno.mkdir` succeeds, the server SHALL make a best-effort recursive removal of the destination directory before returning an error response. On success the server SHALL return HTTP 201 with `{ series, name, copiedChapters }` where `copiedChapters` is an array of copied chapter numbers.

#### Scenario: Branch creates a new story with chapters up to the branch point
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with body `{ "fromChapter": 2, "newName": "tale-alt" }` and `tale/` contains `001.md`..`004.md`
- **THEN** the server SHALL create `playground/alpha/tale-alt/` containing exact copies of `001.md` and `002.md`, SHALL NOT copy `003.md` or `004.md`, and SHALL return HTTP 201 with `{ "series": "alpha", "name": "tale-alt", "copiedChapters": [1, 2] }`

#### Scenario: Branch auto-generates a name when newName is omitted
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with body `{ "fromChapter": 1 }`
- **THEN** the server SHALL create a new story directory named `tale-branch-<timestamp>` where `<timestamp>` is a positive integer, copy `001.md` into it, and return the generated name in the response

#### Scenario: Branch copies story-scoped lore only
- **WHEN** a client branches a story that contains `tale/_lore/world.md` and the series also has `playground/alpha/_lore/people.md`
- **THEN** the new story directory SHALL contain `_lore/world.md` and SHALL NOT contain `people.md`; the series-level `_lore/` directory SHALL be unchanged

#### Scenario: Branch copies _config.json
- **WHEN** a client branches a story that contains `_config.json` with LLM overrides
- **THEN** the destination story SHALL contain an identical `_config.json`

#### Scenario: Branch copies _config.json best-effort
- **WHEN** a client branches a story that does NOT contain `_config.json`
- **THEN** the branch operation SHALL succeed without error and the destination SHALL not contain `_config.json`

#### Scenario: Branch copies filtered image metadata excluding generating entries
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with `{ "fromChapter": 2 }` and `_images/_metadata.json` contains entries for chapters 1 (status: ready), 2 (status: generating), and 2 (status: ready)
- **THEN** the destination `_images/_metadata.json` SHALL contain the chapter 1 ready entry and the chapter 2 ready entry, but SHALL NOT contain the chapter 2 generating entry

#### Scenario: Branch copies image files referenced by filtered metadata
- **WHEN** a client branches at `fromChapter: 2` and filtered metadata contains entries with filenames `001-001.avif` and `002-001.avif`
- **THEN** the destination `_images/` SHALL contain `001-001.avif` and `002-001.avif` copied from the source

#### Scenario: Branch skips image file that does not exist on disk
- **WHEN** filtered metadata references `001-001.avif` but that file does not exist in `_images/`
- **THEN** the branch operation SHALL skip that file silently and continue copying other referenced files

#### Scenario: Branch skips images when _images directory does not exist
- **WHEN** a client branches a story that has no `_images/` directory
- **THEN** the branch operation SHALL succeed without error and the destination SHALL not contain an `_images/` directory

#### Scenario: Branch does not create _images when no entries qualify
- **WHEN** a client branches at `fromChapter: 1` but all image metadata entries either have `chapter > 1` or `status: "generating"`
- **THEN** the destination SHALL NOT contain an `_images/` directory

#### Scenario: Branch fails when destination already exists
- **WHEN** a client sends `POST /api/stories/alpha/tale/branch` with `newName: "existing"` and `playground/alpha/existing/` already exists
- **THEN** the server SHALL return HTTP 409 and SHALL NOT modify the existing directory

#### Scenario: Branch rejects reserved or invalid new names
- **WHEN** the request body contains `newName` equal to `_hidden`, `.secret`, `..`, an empty string, or a name containing path separators
- **THEN** the server SHALL return HTTP 400 and SHALL NOT create any directory

#### Scenario: Branch rejects fromChapter exceeding the highest existing chapter
- **WHEN** the client sends `{ "fromChapter": 10 }` but the story only has `001.md`..`003.md`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body describing the out-of-range value

#### Scenario: Branch rejects non-positive fromChapter
- **WHEN** the client sends `{ "fromChapter": 0 }`, `{ "fromChapter": -1 }`, or a non-integer `fromChapter`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch rejects malformed JSON body
- **WHEN** the client sends a request body that is not valid JSON, omits `fromChapter`, or supplies a non-string `newName`
- **THEN** the server SHALL return HTTP 400 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch returns 404 when the source story does not exist
- **WHEN** a client sends `POST /api/stories/alpha/missing/branch` with a valid body but `playground/alpha/missing/` does not exist
- **THEN** the server SHALL return HTTP 404 with a Problem Details body and SHALL NOT create any directory

#### Scenario: Branch cleans up on partial failure
- **WHEN** the destination directory is created but copying the second chapter fails (e.g., I/O error)
- **THEN** the server SHALL recursively remove the destination directory and return HTTP 500 with a Problem Details body
