# numbered-paragraph-variable Specification

## Purpose

Defines the canonical chapter paragraph-segmentation function and the reserved `numbered_paragraphs` Vento variable. The segmentation is the SOLE source of truth shared by the prompt-side variable shown to the LLM and the `insertAfterParagraph` resolution used by the insert write mode (capability `chapter-paragraph-insertion`), guaranteeing that the indices the model sees match the indices the splice resolves against.

## Requirements

### Requirement: Canonical chapter paragraph segmentation

The engine SHALL provide a single, deterministic paragraph-segmentation function (e.g. `splitChapterParagraphs`) used as the SOLE source of truth for both the `numbered_paragraphs` Vento variable and `insertAfterParagraph` resolution (capability `chapter-paragraph-insertion`).

The function SHALL operate on a chapter content string and:
1. Produce a **position-preserving masked view** of the raw content: every span matched by the combined `promptStripTags` patterns returned by `pluginManager.getStripTagPatterns()` (the same patterns used for chapter history and the `draft` variable) SHALL be replaced with whitespace of **identical length in UTF-16 code units** (the unit JavaScript string indexing/slicing operates on — each stripped UTF-16 code unit replaced by a space, except newline code units which MAY be preserved as newlines to keep line structure; an astral character occupying two UTF-16 code units SHALL be replaced by two spaces). The masked view SHALL therefore have the SAME `.length` as the raw content, and every offset in the masked view SHALL correspond 1:1 to the same offset in the raw content. Free-form length-changing stripping (or per-code-point replacement that collapses surrogate pairs) SHALL NOT be used, because raw-offset mapping depends on exact UTF-16-length preservation.
2. Segment the masked view on runs of two-or-more newlines (blank-line-delimited paragraphs), treating a Windows `\r\n` as a newline. Because masked stripped content is whitespace, a stripped block surrounded by blank lines does not split a visible paragraph, and a stripped-only region between two visible paragraphs collapses into inter-paragraph whitespace.
3. For each candidate segment, compute its trimmed visible text from the masked view; DROP segments whose masked text is empty after trimming (these are stripped-only or whitespace-only regions).
4. Number the surviving segments with a 1-based sequence (`1..N`).

For each surviving paragraph the function SHALL return its 1-based `index`, its trimmed visible `text` (for display; sourced from the masked view so stripped markup is absent), and the source span (`start`/`end` offsets). Because the masked view is length-identical to the raw content, these offsets index the ORIGINAL (raw, unscrubbed) chapter string directly: slicing the RAW string by `[start, end)` yields that paragraph's raw source span (which MAY still contain stripped markup if a stripped tag sat inside the visible paragraph's bounds — that is acceptable; the splice point is paragraph `end`, never inside a stripped span between paragraphs). An "after paragraph N" splice SHALL use paragraph N's `end` offset. A chapter whose masked content has no non-empty paragraphs SHALL yield an empty list (count 0).

The segmentation SHALL be stable: numbering the same content twice SHALL yield identical indices, texts, and offsets.

#### Scenario: blank-line-delimited paragraphs are numbered 1..N

- **WHEN** a chapter's scrubbed content is `段落一。\n\n段落二。\n\n段落三。`
- **THEN** the function SHALL return three paragraphs numbered 1, 2, 3 with texts `段落一。`, `段落二。`, `段落三。`

#### Scenario: stripped tags are excluded from numbering

- **WHEN** a chapter contains `<user_message>玩家輸入</user_message>\n\n正文段落。` and the loaded plugin set declares `promptStripTags: ["user_message"]`
- **THEN** the `<user_message>` block SHALL be masked (replaced by equal-length whitespace) and SHALL NOT be counted as a paragraph
- **AND** `正文段落。` SHALL be numbered paragraph 1

#### Scenario: stripped tag between two paragraphs does not merge or split them

- **WHEN** a chapter contains `第一段。\n\n<image>…### … ###…</image>\n\n第二段。` and `image` is among the masked patterns
- **THEN** the function SHALL return exactly two visible paragraphs (`第一段。`, `第二段。`) numbered 1 and 2
- **AND** the masked `<image>` region SHALL collapse into inter-paragraph whitespace, so an `insertAfterParagraph: 1` splice SHALL resolve to paragraph 1's `end` offset (before the masked region), never inside the stripped block

#### Scenario: mask preserves length so raw offsets are exact

- **WHEN** a chapter mixes stripped tags and prose
- **THEN** the masked view SHALL have the same byte length as the raw content
- **AND** every returned paragraph's `start`/`end` offsets SHALL index the raw string such that slicing `[start, end)` yields that paragraph's raw source span

#### Scenario: leading/trailing blank lines do not create empty paragraphs

- **WHEN** a chapter's scrubbed content is `\n\n  \n第一段。\n\n\n\n第二段。\n\n`
- **THEN** the function SHALL return exactly two paragraphs (`第一段。`, `第二段。`) numbered 1 and 2

#### Scenario: raw offsets address the original string

- **WHEN** a chapter raw string contains stripped tags interleaved with prose
- **THEN** each returned paragraph's `start`/`end` offsets SHALL index into the ORIGINAL raw string such that slicing `[start, end)` yields that paragraph's source span
- **AND** an insertion resolved "after paragraph N" SHALL use paragraph N's `end` offset (skipping into the inter-paragraph gap) as the splice point

#### Scenario: empty chapter yields zero paragraphs

- **WHEN** a chapter's scrubbed content is empty or whitespace-only
- **THEN** the function SHALL return an empty list with count 0

### Requirement: numbered_paragraphs reserved Vento variable

The engine SHALL inject a reserved Vento variable `numbered_paragraphs` into the prompt variable map for plugin-action runs. In `insert` mode the variable SHALL be a pre-rendered string derived deterministically from the canonical segmentation of the highest-numbered chapter (read inside the generation lock), with one entry per numbered paragraph showing the paragraph's sequence number and its display text, entries separated by blank lines. In all non-insert modes `numbered_paragraphs` SHALL be the empty string.

`numbered_paragraphs` SHALL be a RESERVED variable name: a request whose `extraVariables` includes `numbered_paragraphs` SHALL be rejected with HTTP 400 `type` slug `plugin-action:extra-variables-collision`, and SHALL NOT load any chapter content. The rendered string SHALL be derived from the SAME snapshot and SAME segmentation used for `insertAfterParagraph` resolution, so the indices shown to the LLM match the indices the splice resolves against.

#### Scenario: numbered_paragraphs is populated in insert mode

- **WHEN** an insert-mode run is dispatched against a chapter with three numbered paragraphs
- **THEN** the rendered prompt SHALL receive `numbered_paragraphs` as a non-empty string containing each paragraph's 1-based sequence number alongside its text, separated by blank lines

#### Scenario: numbered_paragraphs is empty outside insert mode

- **WHEN** an append-, replace-, or discard-mode run is dispatched
- **THEN** `numbered_paragraphs` SHALL be the empty string

#### Scenario: numbered_paragraphs override is rejected

- **WHEN** a request sends `"extraVariables": { "numbered_paragraphs": "fake" }`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:extra-variables-collision` and SHALL NOT load any chapter content

#### Scenario: shown indices match splice resolution

- **WHEN** the LLM is shown `numbered_paragraphs` with paragraph index 2 reading `他轉過身。` and returns an insertion `insertAfterParagraph: 2`
- **THEN** the engine SHALL splice that insertion immediately after the same `他轉過身。` paragraph in the chapter file
