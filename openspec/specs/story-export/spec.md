# story-export Specification

## Purpose
Provide an authenticated mechanism for exporting a complete story — all of its non-empty chapters — as a single downloadable document in Markdown, JSON, or plain-text format, with plugin-declared tags stripped so the output matches what the reader sees. The capability is exposed as a backend HTTP endpoint and surfaced in the reader frontend through export controls in the story selector.

## Requirements

### Requirement: Story export endpoint
The system SHALL expose an authenticated HTTP endpoint `GET /api/stories/:series/:name/export` that returns the complete content of a story as a single downloadable file.

#### Scenario: Default format is Markdown
- **WHEN** an authenticated client requests `/api/stories/demo/myStory/export` without a `format` query parameter
- **THEN** the response status is `200` with `Content-Type: text/markdown; charset=utf-8` and the body is a Markdown document containing every non-empty chapter

#### Scenario: Explicit Markdown format
- **WHEN** an authenticated client requests `/api/stories/demo/myStory/export?format=md`
- **THEN** the response is a Markdown document whose content equals the default-format response

#### Scenario: JSON format
- **WHEN** an authenticated client requests `/api/stories/demo/myStory/export?format=json`
- **THEN** the response status is `200` with `Content-Type: application/json; charset=utf-8`
- **AND** the body is an object of shape `{ series, name, exportedAt, chapters: [{ number, content }] }` where `chapters` is sorted ascending by `number`

#### Scenario: Plain-text format
- **WHEN** an authenticated client requests `/api/stories/demo/myStory/export?format=txt`
- **THEN** the response status is `200` with `Content-Type: text/plain; charset=utf-8`
- **AND** the body contains chapter text with Markdown syntax (headings, emphasis, links, code fences, HTML tags) removed

#### Scenario: Unknown format rejected
- **WHEN** an authenticated client requests the export endpoint with `?format=pdf`
- **THEN** the response status is `400` with an RFC 9457 Problem Details body whose `detail` indicates the format is not supported

### Requirement: Export authentication
The export endpoint SHALL require the same passphrase authentication enforced on other `/api/*` routes.

#### Scenario: Missing passphrase
- **WHEN** a client requests the export endpoint without the `X-Passphrase` header
- **THEN** the response status is `401` with an RFC 9457 Problem Details body

#### Scenario: Invalid passphrase
- **WHEN** a client requests the export endpoint with an incorrect `X-Passphrase` header
- **THEN** the response status is `401` with an RFC 9457 Problem Details body

### Requirement: Tag stripping on export
The exported content SHALL have all plugin-declared tags removed, including BOTH `promptStripTags` and `displayStripTags` declarations across all loaded plugin manifests. The system SHALL provide a combined accessor (e.g., `PluginManager.getCombinedStripTagPatterns()`) that merges the patterns from both fields and returns a single regex used by the export route. The existing `getStripTagPatterns()` helper (which reads only `promptStripTags`) SHALL remain unchanged so prompt-assembly behaviour is preserved.

#### Scenario: Prompt-strip tags removed
- **WHEN** a chapter contains `<thinking>inner monologue</thinking>` content (a `promptStripTags` tag)
- **THEN** the exported output in any format does not contain the `<thinking>` element or its inner text

#### Scenario: Display-strip tags removed
- **WHEN** a chapter contains `<imgthink>...</imgthink>` content (a `displayStripTags` tag declared by the imgthink plugin)
- **THEN** the exported output in any format does not contain the `<imgthink>` element or its inner text, matching what the reader sees in the browser

#### Scenario: User message tags removed
- **WHEN** a chapter contains `<user_message>...</user_message>` content
- **THEN** the exported output in any format does not contain the `<user_message>` element or its inner text

#### Scenario: Regex-declared tags removed
- **WHEN** a plugin declares a regex strip pattern in either `promptStripTags` or `displayStripTags`, and a chapter contains matching content
- **THEN** the exported output does not contain text matched by that pattern

### Requirement: Chapter selection and ordering
The export SHALL include only files in the story directory whose names match the regular expression `^\d+\.md$`, sorted by ascending numeric value, and SHALL exclude chapters whose content is empty after trimming whitespace.

#### Scenario: System-reserved directories excluded
- **WHEN** the story directory contains an `_lore/` subdirectory with Markdown files
- **THEN** those files are not included in the export

#### Scenario: Non-chapter files excluded
- **WHEN** the story directory contains files not matching `^\d+\.md$` (e.g., `notes.md`, `.DS_Store`)
- **THEN** those files are not included in the export

#### Scenario: Empty chapters omitted
- **WHEN** chapter `002.md` is empty or contains only whitespace
- **THEN** the export skips chapter 2 and does not emit a heading or entry for it

### Requirement: Download filename
The export response SHALL set a `Content-Disposition: attachment` header with a filename of the form `<series>-<name>.<ext>` where `<ext>` is `md`, `json`, or `txt` matching the selected format.

#### Scenario: ASCII filename
- **WHEN** an authenticated client exports `demo/myStory` as JSON
- **THEN** the response `Content-Disposition` header contains `attachment; filename="demo-myStory.json"`

#### Scenario: Non-ASCII filename
- **WHEN** an authenticated client exports a story whose series or name contains non-ASCII characters
- **THEN** the response `Content-Disposition` header includes an RFC 5987 `filename*=UTF-8''<percent-encoded>` parameter in addition to an ASCII-safe `filename=` fallback

### Requirement: Error handling for missing or invalid stories
The endpoint SHALL return RFC 9457 Problem Details responses for invalid parameters, path-traversal attempts, missing stories, and read failures.

#### Scenario: Story does not exist
- **WHEN** an authenticated client requests the export endpoint for a `series/name` pair that does not map to an existing directory
- **THEN** the response status is `404` with a Problem Details body

#### Scenario: Path traversal rejected
- **WHEN** a client requests the export endpoint with a series or name that contains path-traversal segments (e.g., `..`)
- **THEN** the response status is `400` with a Problem Details body and no filesystem access is attempted outside the playground directory

#### Scenario: Story directory contains no chapters
- **WHEN** the story directory exists but contains no files matching `^\d+\.md$` with non-empty content
- **THEN** the response status is `200` and the body is a valid but empty document for the requested format (empty Markdown string, empty `chapters` array in JSON, empty text)

### Requirement: Frontend export control
The reader frontend SHALL provide a user-visible control within the story selector that triggers a browser download of the currently selected story in a chosen format.

#### Scenario: Export buttons visible when a story is selected
- **WHEN** the user has selected a series and story in the story selector dropdown
- **THEN** export controls for Markdown, JSON, and plain-text formats are displayed

#### Scenario: Clicking an export button downloads the file
- **WHEN** the user clicks the Markdown export button for the currently selected story
- **THEN** the browser saves a file whose name is `<series>-<name>.md` and whose contents are the Markdown export returned by the backend

#### Scenario: Export request includes authentication
- **WHEN** the frontend issues an export request
- **THEN** the request includes the `X-Passphrase` header obtained from the authenticated session
