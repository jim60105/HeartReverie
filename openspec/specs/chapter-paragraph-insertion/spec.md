# chapter-paragraph-insertion Specification

## Purpose

Defines the `insert` write mode of the plugin run-prompt route: a paragraph-addressed, atomic mechanism that splices LLM-produced content into the highest-numbered chapter of a story. The mode parses a JSON insertion envelope (optionally produced by an `insert-transform` backend hook from a plugin-specific response shape), resolves each insertion against the canonical chapter paragraph segmentation (capability `numbered-paragraph-variable`), and applies the splice atomically under the per-story generation lock.

## Requirements

### Requirement: Insert write mode request contract

The `POST /api/plugins/:pluginName/run-prompt` route SHALL accept an optional boolean request field `insert` (default `false`). When `insert: true`, the route SHALL run the plugin prompt through the standard LLM pipeline and persist the result by splicing content into the highest-numbered chapter file of `storyDir`, addressed by paragraph (see capability `numbered-paragraph-variable`).

`insert` SHALL be mutually exclusive with `append` and `replace`, and SHALL NOT be combined with `appendTag`. A request that sets `insert: true` together with any of `append: true`, `replace: true`, or a non-`undefined` `appendTag` (including an explicit JSON `null`) SHALL be rejected with HTTP 400 and `type` slug `plugin-action:invalid-insert-combo`, and SHALL NOT touch the file system. When `insert`, `append`, and `replace` are all absent or `false`, the route SHALL behave as the existing `discard` mode.

When `insert: true` and `storyDir` contains no chapter files, the route SHALL respond HTTP 400 with `type` slug `plugin-action:no-chapter` and SHALL NOT touch the file system.

#### Scenario: insert flag selects the insert write mode

- **WHEN** a request sends `"insert": true` against a story whose highest-numbered chapter file exists
- **THEN** the route SHALL render the prompt, stream the LLM response, parse it as a JSON insertion envelope, and atomically splice the insertions into that chapter file
- **AND** the route SHALL NOT append to or replace the chapter as a whole

#### Scenario: insert combined with append is rejected

- **WHEN** a request sends `"insert": true, "append": true`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-insert-combo` and SHALL NOT touch the chapter file

#### Scenario: insert combined with replace is rejected

- **WHEN** a request sends `"insert": true, "replace": true`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-insert-combo` and SHALL NOT touch the chapter file

#### Scenario: insert combined with appendTag is rejected

- **WHEN** a request sends `"insert": true, "appendTag": "image"`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-insert-combo` and SHALL NOT touch the chapter file

#### Scenario: insert against a chapterless story is rejected

- **WHEN** a request sends `"insert": true` against a story directory that contains no chapter files
- **THEN** the route SHALL respond with HTTP 400 `plugin-action:no-chapter` and SHALL NOT write any file

### Requirement: Insert-transform hook

Before parsing the insertion envelope, and INSIDE the per-story generation lock, the engine SHALL dispatch a backend hook stage `insert-transform` whose context carries at least:
- `correlationId`: the per-request correlation id.
- `pluginName`: the name of the plugin that initiated the insert run (the owning plugin).
- `rawResponse`: the full accumulated LLM response string (NOT normalised — exactly as streamed/accumulated).
- `numberedParagraphs`: the rendered `numbered_paragraphs` string the LLM was shown (for the handler's reference).
- `series`, `name`, `storyDir`: the story coordinates.
- `envelope`: a mutable output slot, initially `null`.

`insert-transform` SHALL be a SERIAL (non-parallel), mutating backend stage: it SHALL NOT be added to the parallel allowlist, and the dispatched context SHALL NOT be deep-frozen, so a handler can write `envelope`. A handler SHALL act only when `context.pluginName` equals its own plugin name (origin self-filtering), so one plugin's handler never transforms another plugin's insert run.

After dispatch, the engine SHALL read back `context.envelope`. If it is a non-empty string, the engine SHALL use THAT string as the canonical insertion envelope to normalise + parse (per "JSON insertion envelope contract"). If `context.envelope` is `null`/absent/not a string, the engine SHALL fall back to using `rawResponse` as the canonical envelope (so a plugin that instructs its LLM to emit the canonical envelope directly works with no transform handler).

A handler that cannot produce a valid envelope SHALL leave `envelope` as `null`. The engine then falls back to parsing the raw response, which (for a domain-specific response shape) will fail normalisation/validation and surface `plugin-action:invalid-insert-payload` with the chapter left byte-for-byte unchanged. NOTE: serial backend-hook handler exceptions are caught and logged by the dispatcher (they do NOT propagate), so a handler MUST signal failure by leaving `envelope` unset rather than relying on `throw` to abort the run — the safety guarantee (no chapter write) holds either way because the resulting raw-response parse fails before any write. The engine SHALL NOT itself inspect the domain-specific shape the handler consumed.

#### Scenario: transform hook produces the canonical envelope from a plugin-specific response

- **WHEN** a plugin registers an `insert-transform` handler and the LLM returns the plugin's own flat schema (e.g. an array of `{ insertAfterParagraph, imgthink, title, prompt, negativePrompt, nlPrompt }` objects)
- **THEN** the engine SHALL dispatch `insert-transform` with `rawResponse` set to that response and `pluginName` set to the calling plugin
- **AND** the handler SHALL assemble `{ "insertions": [ { "insertAfterParagraph", "text" } … ] }` and set `context.envelope` to its JSON string
- **AND** the engine SHALL parse `context.envelope` (not `rawResponse`) and splice the resulting insertions

#### Scenario: no transform handler falls back to the raw response

- **WHEN** no `insert-transform` handler sets `context.envelope`
- **THEN** the engine SHALL parse the raw accumulated response directly as the canonical insertion envelope

#### Scenario: transform hook runs under the lock before any write

- **WHEN** an insert run dispatches `insert-transform`
- **THEN** the dispatch SHALL occur inside the per-story generation lock and BEFORE `atomicWriteChapter`
- **AND** a handler that fails to set a valid `envelope` (whether it throws — caught/logged by the dispatcher — or simply leaves `envelope` unset) SHALL result in the raw response being parsed, which fails before any write, leaving the chapter byte-for-byte unchanged and dispatching no `post-response`

#### Scenario: transform handler is origin-filtered

- **WHEN** an `insert-transform` handler owned by plugin A receives a context whose `pluginName` is plugin B
- **THEN** the handler SHALL NOT modify `context.envelope` (it acts only on its own plugin's runs)

### Requirement: JSON insertion envelope contract

In insert mode the engine SHALL treat the **canonical insertion-envelope string** (the `insert-transform` hook's `envelope` output when set, otherwise the entire accumulated LLM response) as a single JSON insertion envelope after normalisation, NOT as chapter prose. Normalisation SHALL: (1) `trim()` the content; (2) strip at most ONE surrounding Markdown code fence (` ```json … ``` ` or ` ``` … ``` `) when the trimmed content begins with a fence and ends with a closing fence; (3) `JSON.parse` the result.

The parsed value SHALL be an object with an `insertions` property that is an array. Each array element SHALL be an object with:
- `insertAfterParagraph`: a safe non-negative integer.
- `text`: a non-empty string (the opaque content to splice; the engine SHALL NOT inspect or validate its internal markup).

If normalisation/parsing fails, or the parsed value is not an object with an `insertions` array, or any element is not a well-formed `{ insertAfterParagraph, text }` object, the route SHALL respond HTTP 422 with `type` slug `plugin-action:invalid-insert-payload` and SHALL NOT modify the chapter file. The engine SHALL NOT perform heuristic scavenging (e.g. extracting the first `{...}`) beyond the single-fence strip.

An empty `insertions` array (`[]`) SHALL be accepted as a no-op: the route SHALL write nothing, SHALL NOT dispatch `post-response`, and SHALL return success with `insertedCount: 0`.

#### Scenario: well-formed envelope is parsed

- **WHEN** the accumulated response is `{"insertions":[{"insertAfterParagraph":2,"text":"<imgthink>…</imgthink>\n<image>【A】### prompt ### negativePrompt ### nlPrompt ###</image>"}]}`
- **THEN** the engine SHALL parse one insertion targeting paragraph 2 and SHALL splice its `text` after paragraph 2

#### Scenario: response wrapped in a json code fence is accepted

- **WHEN** the accumulated response is a ` ```json ` … ` ``` ` fenced block whose body is a valid insertion envelope
- **THEN** the engine SHALL strip the single outer fence and parse the inner JSON successfully

#### Scenario: non-JSON response is rejected

- **WHEN** the accumulated response is prose such as `對不起，我無法完成此任務。`
- **THEN** the route SHALL respond HTTP 422 `plugin-action:invalid-insert-payload` and SHALL NOT modify the chapter file

#### Scenario: malformed entry is rejected

- **WHEN** the envelope parses but an element is `{"insertAfterParagraph":"two","text":"x"}` (non-integer index)
- **THEN** the route SHALL respond HTTP 422 `plugin-action:invalid-insert-payload` and SHALL NOT modify the chapter file

#### Scenario: empty text is rejected

- **WHEN** an element is `{"insertAfterParagraph":1,"text":""}`
- **THEN** the route SHALL respond HTTP 422 `plugin-action:invalid-insert-payload` and SHALL NOT modify the chapter file

#### Scenario: empty insertions array is an accepted no-op

- **WHEN** the envelope is `{"insertions":[]}`
- **THEN** the route SHALL write nothing, SHALL NOT dispatch `post-response`, and SHALL return success with `insertedCount: 0`

### Requirement: Paragraph-addressed atomic splice

The route SHALL resolve and apply insertions against a single chapter snapshot read **inside the per-story generation lock**, using the canonical paragraph model from capability `numbered-paragraph-variable`. Resolution rules for each `insertAfterParagraph` value `K` against a chapter with `count` numbered paragraphs:

- `K` in `1..count` → the `text` SHALL be spliced immediately after paragraph `K` (between paragraph `K` and paragraph `K+1`).
- `K === 0` → the `text` SHALL be spliced at the very top of the chapter, before paragraph 1.
- `K < 0` or `K > count` → the ENTIRE run SHALL be rejected with HTTP 422 `type` slug `plugin-action:insert-paragraph-out-of-range`; NO insertion (not even in-range ones) SHALL be applied, and the chapter file SHALL remain byte-for-byte unchanged.

- `K === 0` against a chapter with `count === 0` numbered paragraphs (an existing chapter whose scrubbed content has no paragraphs) → the `text` SHALL be spliced at the raw start of the chapter (offset 0). Any `K > 0` against a zero-paragraph chapter SHALL be rejected with `plugin-action:insert-paragraph-out-of-range`.

**`text` is spliced byte-for-byte.** The engine SHALL splice the JSON-decoded `text` value EXACTLY as decoded — NO `trim()`, NO internal newline normalisation, NO collapsing of blank lines INSIDE `text`. The ONLY bytes the engine MAY add are the OUTER separators that make the spliced chunk its own Markdown paragraph block: at most one blank line (`\n\n`) before and after the chunk, and the engine SHALL collapse only the boundary between an existing separator and the added separator so that no more than two consecutive newlines appear at the join. This guarantees that markup the plugin embedded in `text` (e.g. `<imgthink>…</imgthink>\n<image>…### … ###…</image>`) survives intact for the downstream `post-response` consumer's parser.

**`K === 0` raw insertion point.** "Before paragraph 1" SHALL resolve to the RAW `start` offset of the FIRST numbered (visible) paragraph — NOT necessarily byte 0 — so that any leading stripped-tag content (e.g. a chapter beginning with a hidden block) remains before the spliced `text`. Only the zero-paragraph chapter case (above) uses offset 0.

**Multi-insertion application.** When multiple insertions resolve to positions in the same chapter, they SHALL be applied so that earlier splices do not shift the resolved positions of later ones (e.g. applied in descending resolved-offset order). Two or more insertions resolving to the SAME offset (e.g. the same `insertAfterParagraph`) SHALL be grouped and their `text` values concatenated (each as its own paragraph block) in the order they appear in the `insertions` array, then the group SHALL be applied as a single splice at that offset — so same-offset insertions are NOT reversed.

The final spliced content SHALL be written with `atomicWriteChapter` (write-to-temp + `Deno.rename`). On abort or any error before the rename, the route SHALL NOT call `atomicWriteChapter`, the chapter file SHALL remain byte-for-byte unchanged, and `post-response` SHALL NOT be dispatched.

#### Scenario: insert after a middle paragraph

- **WHEN** the latest chapter has 4 numbered paragraphs and an insertion targets `insertAfterParagraph: 2`
- **THEN** the spliced `text` SHALL appear between paragraph 2 and paragraph 3 as its own paragraph block
- **AND** paragraphs 1, 3, and 4 SHALL retain their original text

#### Scenario: insert at the top of the chapter

- **WHEN** an insertion targets `insertAfterParagraph: 0`
- **THEN** the spliced `text` SHALL appear before the original (visible) paragraph 1

#### Scenario: top insert preserves leading stripped-tag content

- **WHEN** the chapter raw content begins with a stripped block (e.g. `<imgthink>…</imgthink>`) followed by visible paragraph 1, and an insertion targets `insertAfterParagraph: 0`
- **THEN** the spliced `text` SHALL be placed at the raw `start` offset of visible paragraph 1 (AFTER the leading stripped block), NOT at byte 0

#### Scenario: text is spliced byte-for-byte with only outer separators added

- **WHEN** an insertion `text` is the multi-line string `<imgthink>line1\nline2</imgthink>\n<image>【A】### prompt ### negativePrompt ### nlPrompt ###</image>`
- **THEN** the spliced chapter region SHALL contain that exact substring (internal newlines and the `### … ###` body preserved verbatim, no trim, no blank-line collapsing INSIDE the text)
- **AND** the engine SHALL add only outer blank-line separators so the chunk is its own paragraph block, with no more than two consecutive newlines at either join

#### Scenario: zero-paragraph chapter accepts only top insert

- **WHEN** the latest chapter file exists but its scrubbed content has zero numbered paragraphs (e.g. only stripped tags / whitespace)
- **THEN** an insertion with `insertAfterParagraph: 0` SHALL be spliced at raw offset 0
- **AND** any insertion with `insertAfterParagraph > 0` SHALL be rejected with `plugin-action:insert-paragraph-out-of-range`

#### Scenario: same-paragraph insertions keep array order (not reversed)

- **WHEN** the envelope contains two insertions both targeting `insertAfterParagraph: 2`, with `text` values `A` then `B` in array order
- **THEN** the chapter after the splice SHALL contain `A` before `B`, both after paragraph 2

#### Scenario: out-of-range index aborts the whole run

- **WHEN** the latest chapter has 4 numbered paragraphs and any insertion targets `insertAfterParagraph: 9`
- **THEN** the route SHALL respond HTTP 422 `plugin-action:insert-paragraph-out-of-range`
- **AND** no insertion (including in-range entries in the same envelope) SHALL be written
- **AND** the chapter file SHALL remain byte-for-byte unchanged

#### Scenario: multiple insertions do not corrupt each other's positions

- **WHEN** the envelope contains insertions after paragraphs 1, 2, and 3 of a 4-paragraph chapter
- **THEN** all three `text` blocks SHALL land at their addressed positions relative to the ORIGINAL paragraph numbering, not shifted by sibling insertions

#### Scenario: atomic swap visible to readers

- **WHEN** an insert run completes successfully and a concurrent reader reads the chapter file at the same moment
- **THEN** the reader SHALL observe either the full pre-insert content or the full post-insert content, never a partial overwrite

#### Scenario: abort preserves the original chapter

- **WHEN** the client cancels an insert run while the LLM stream is still flowing
- **THEN** the route SHALL NOT call `atomicWriteChapter`, the chapter file SHALL remain byte-for-byte identical to its pre-request content, SHALL emit `plugin-action:aborted` over WebSocket if connected, SHALL NOT dispatch `post-response`, and SHALL release the generation lock

### Requirement: Insert mode post-response and result envelope

After a successful non-empty insert, the route SHALL re-read the full chapter file and dispatch the `post-response` hook with `{ content: <full chapter content after insert>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName }`. The `pre-write` and `response-stream` hooks SHALL NOT be dispatched in insert mode (matching `append`/`replace`).

The route's result (both the HTTP JSON body and the `plugin-action:done` WebSocket envelope) SHALL include `chapterInserted: boolean` and `insertedCount: number`, in addition to the existing `content`, `usage`, `chapterUpdated`, `chapterReplaced`, and `appendedTag` fields. The insert-mode error slugs (`plugin-action:invalid-insert-combo`, `plugin-action:invalid-insert-payload`, `plugin-action:insert-paragraph-out-of-range`, `plugin-action:no-chapter`, `plugin-action:concurrent-generation`) and their HTTP status codes SHALL surface identically across transports: as the HTTP response body for the plain-HTTP path and as the `plugin-action:error` terminal WebSocket envelope's `problem` for the WebSocket path. For a successful insert: `chapterInserted` SHALL be `true`, `insertedCount` SHALL equal the number of applied insertions, `chapterUpdated` SHALL be `true` (the chapter file changed), `chapterReplaced` SHALL be `false`, and `appendedTag` SHALL be `null`. For a no-op empty-array insert: `chapterInserted` SHALL be `false`, `insertedCount` SHALL be `0`, and `chapterUpdated` SHALL be `false`. For non-insert modes, `chapterInserted` SHALL be `false` and `insertedCount` SHALL be `0`.

`content` in the insert-mode result SHALL be the full chapter content after the insert (matching the append/replace convention of returning post-write chapter content).

#### Scenario: successful insert dispatches post-response with full chapter

- **WHEN** an insert run applies two insertions successfully
- **THEN** the route SHALL re-read the chapter and dispatch `post-response` with `content` equal to the full post-insert chapter, `source: "plugin-action"`, and `pluginName` set to the calling plugin
- **AND** the result SHALL be `{ chapterInserted: true, insertedCount: 2, chapterUpdated: true, chapterReplaced: false, appendedTag: null, content: <full chapter>, usage }`

#### Scenario: insert mode does not dispatch pre-write or response-stream

- **WHEN** an insert run executes
- **THEN** the `pre-write` and `response-stream` hooks SHALL NOT be dispatched

#### Scenario: empty insert reports no change

- **WHEN** the envelope is `{"insertions":[]}`
- **THEN** the result SHALL be `{ chapterInserted: false, insertedCount: 0, chapterUpdated: false, chapterReplaced: false }`
- **AND** `post-response` SHALL NOT be dispatched

#### Scenario: insert errors surface identically over HTTP and WebSocket

- **WHEN** an insert run fails with any insert-mode error slug (e.g. `plugin-action:invalid-insert-payload`)
- **THEN** the plain-HTTP path SHALL return that slug + status code in the response body
- **AND** the WebSocket path SHALL emit `plugin-action:error` whose `problem` carries the same slug + status code

### Requirement: Insert mode single-snapshot, lock-held ordering

In insert mode the route SHALL execute the following steps in this order, ALL within a SINGLE acquisition of the per-story generation lock, against ONE chapter snapshot:

1. Acquire the per-story generation lock via `tryMarkGenerationActive(series, name)`. If already held → HTTP 409 `plugin-action:concurrent-generation`, no file touch.
2. Read the highest-numbered chapter file ONCE (the "insert snapshot").
3. Compute the canonical paragraph segmentation (capability `numbered-paragraph-variable`) from that snapshot, and render the prompt with `numbered_paragraphs` derived from it.
4. Run the LLM and accumulate the full response.
5. Dispatch the `insert-transform` hook (capability requirement "Insert-transform hook") with the raw accumulated response; read back `context.envelope` to obtain the canonical envelope string (falling back to the raw response when unset).
6. Parse the canonical JSON envelope and resolve every `insertAfterParagraph` against the SAME paragraph segmentation computed in step 3 (NOT a re-read of the file).
7. Apply the splice to the snapshot's raw bytes and write via `atomicWriteChapter`; re-read and dispatch `post-response`.
8. Release the lock in a `finally` block — on success, error, or abort.

The paragraph numbering the LLM is shown (`numbered_paragraphs`) and the indices `insertAfterParagraph` resolves against SHALL therefore be derived from the identical snapshot, so a valid model response can never be mis-resolved by a concurrent edit. The lock SHALL be held for the entire render→stream→splice sequence (this intentionally serialises insert runs against other generation on the same story).

#### Scenario: concurrent generation is rejected

- **WHEN** an insert request arrives while the per-story generation lock is already held (e.g. an active chat generation)
- **THEN** the route SHALL respond HTTP 409 `plugin-action:concurrent-generation` and SHALL NOT read or write the chapter file

#### Scenario: numbered_paragraphs and splice resolution share one snapshot

- **WHEN** an insert run renders `numbered_paragraphs` showing 4 paragraphs and the LLM returns `insertAfterParagraph: 4`
- **THEN** resolution SHALL use the SAME 4-paragraph segmentation rendered into the prompt (read once inside the lock), NOT a fresh re-read
- **AND** the index `4` SHALL resolve in-range even though no file re-read occurs between render and splice

#### Scenario: lock released on success, error, and abort

- **WHEN** an insert run completes, fails, or is aborted
- **THEN** the per-story generation lock SHALL be released in all three cases
