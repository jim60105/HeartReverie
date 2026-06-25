## MODIFIED Requirements

### Requirement: Plugin run-prompt backend route

The server SHALL expose an authenticated `POST /api/plugins/:pluginName/run-prompt` endpoint, gated by the same passphrase middleware as other authed routes AND by a route-specific 30-requests-per-minute rate limiter (in addition to the global 300/min limiter). The request body SHALL contain `series` (string), `name` (story name, string), `promptFile` (string, relative to plugin directory), and the optional `append` (boolean, default `false`), `replace` (boolean, default `false`), `appendTag` (string, OPTIONAL even when `append` is `true`; when supplied it MUST be a string matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$` — an explicit JSON `null` is NOT a valid way to request a tagless append), and `extraVariables` (object whose values are `string | number | boolean` only). `append` and `replace` SHALL be mutually exclusive: a request that sets both to `true` SHALL be rejected with HTTP 400 `plugin-action:invalid-replace-combo`. A request that sets `replace: true` together with a non-`undefined` `appendTag` (including an explicit JSON `null`) SHALL be rejected with the same `plugin-action:invalid-replace-combo` slug.

When `append: true`, the route SHALL resolve `appendTag` as follows: an omitted/`undefined` `appendTag` SHALL resolve to a tagless append (`appendTag: null`); a string matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$` SHALL resolve to that tag; any other value — including an explicit JSON `null`, a non-string value, or a string failing the regex (such as the empty string) — SHALL be rejected with HTTP 400 `plugin-action:invalid-append-tag`. Only total omission opts into tagless append; this is symmetric with `replace` mode, which rejects any non-`undefined` `appendTag` (including `null`).

The route SHALL validate `pluginName` against `isValidPluginName()` (HTTP 400 on syntactic violation, with `type` slug `plugin-action:invalid-plugin-name`) and against the loaded-plugin registry (HTTP 404 with `type` slug `plugin-action:unknown-plugin` when the name is syntactically valid but no plugin with that name is loaded). The route SHALL validate `series`/`name` via the existing `isValidParam` rules, resolve `storyDir` via `safePath(playgroundDir, series, name)`, and require the directory to exist (HTTP 404 otherwise).

The route SHALL acquire the per-story generation lock atomically via a `tryMarkGenerationActive(series, name)` helper before any LLM call begins; if the lock is already held the route SHALL respond HTTP 409 with `type` slug `plugin-action:concurrent-generation` and SHALL NOT touch the chapter file. The lock SHALL be released in a `finally` block whether the run succeeds, errors, or aborts. The same atomic-acquire helper SHALL be used by the normal chat path (replacing the existing check-then-mark sequence).

The route SHALL resolve the prompt file path with `safePath` followed by `Deno.realPath()` canonicalisation of both the plugin directory and the resolved prompt path before applying `isPathContained` against the canonicalised plugin directory; reject anything outside it with HTTP 400 and `type` slug `plugin-action:invalid-prompt-path`; reject prompt files whose extension is not `.md` (HTTP 400, `plugin-action:non-md-prompt`); reject paths whose target is not a regular file or does not exist (HTTP 400, `plugin-action:prompt-file-not-found`).

The route SHALL render the file with the same Vento setup `system.md` uses (including dynamic variables, lore variables, and the `{{ message }}` tag) plus any `extraVariables` merged into the variable map. `extraVariables` keys that collide with reserved system-prompt variable names (`previousContext`, `previous_context`, `user_input`, `userInput`, `status_data`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`, `draft`, or any `lore_*`) SHALL cause HTTP 400 `plugin-action:extra-variables-collision`. `extraVariables` values that are not scalar strings/numbers/booleans SHALL cause HTTP 400 `plugin-action:invalid-extra-variables`. The variable `user_input` SHALL default to the empty string for plugin-action runs.

When `replace: true`, the route SHALL — after successfully acquiring the generation lock and BEFORE rendering the prompt — load the highest-numbered chapter file's full content from `storyDir`, run it through the combined `promptStripTags` regex returned by `pluginManager.getStripTagPatterns()` (the same scrub `chat-shared.ts`/`story.ts::stripPromptTags` apply to chapter history), and inject the stripped string into the Vento variable map as `draft`. When `replace` is not `true`, `draft` SHALL be the empty string. Callers SHALL NOT be able to override the server-supplied `draft` because `draft` is a reserved name (see above).

This preserved-prefix behaviour SHALL be a property of `replace-last-chapter` mode itself, applied by the run-prompt route for EVERY `replace: true` run regardless of which plugin dispatched it (it is NOT specific to the `polish` plugin). Any current or future plugin that runs in replace mode SHALL receive identical `<user_message>` preservation.

When `replace: true`, the route SHALL — at the SAME point it reads the raw chapter content (before the strip pass that produces `draft`) — capture the chapter's **leading `<user_message>…</user_message>` block** as an opaque preserved prefix. The captured prefix SHALL be the substring of the raw chapter content beginning at byte 0 (the block MUST be anchored at the very start of the chapter, with NO leading whitespace consumed) through the end of the first `</user_message>` close tag, together with at most two immediately-following line breaks (the `\n\n` separator the `user-message` `pre-write` hook emits, tolerant of a single `\n` or `\r\n`). The trailing-separator capture SHALL be bounded to ≤2 line breaks and SHALL NOT greedily consume blank lines or indentation that belong to the prose body. The capture SHALL be case-sensitive (matching the engine's lowercase `<user_message>` emission) and SHALL be limited to a single block anchored at the start of the chapter; a `<user_message>` block that does not begin at byte 0 (e.g. preceded by other content or appearing mid-body) SHALL NOT be captured (it is treated as ordinary stripped content and is NOT preserved). An unterminated/malformed `<user_message>` block (no matching `</user_message>`) SHALL NOT be captured (preserved prefix is the empty string). When the chapter has no leading `<user_message>` block the preserved prefix SHALL be the empty string. The preserved prefix SHALL NOT be exposed to the LLM (it remains stripped out of `draft`) and SHALL NOT be re-stripped, re-wrapped, or otherwise transformed before being written back. The capture SHALL operate on the raw chapter bytes directly and SHALL NOT depend on `getStripTagPatterns()` returning a non-null regex.

Plugin prompt templates SHALL be required to emit at least one `{{ message "user" }}…{{ /message }}` block; the existing `assertHasUserMessage` guard SHALL surface a missing user-role message as HTTP 422 with `type` slug `multi-message:no-user-message`.

The route SHALL execute the LLM call through the shared `streamLlmAndPersist` helper extracted from `executeChat`, supplying a discriminated `writeMode`:
- `{ kind: "append-to-existing-chapter", appendTag, pluginName }` when `append: true`, where `appendTag` is `string | null` (`null` for the tagless append). In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. After successful stream completion the route SHALL produce the appended payload as follows:
  - **Tagged append (`appendTag` is a string):** normalise the accumulated content (see "Append wrapper normalisation"), then atomically append `\n<{appendTag}>\n{normalised content}\n</{appendTag}>\n` to the highest-numbered chapter file in `storyDir`.
  - **Tagless append (`appendTag` is `null`):** `trim()` the accumulated content WITHOUT any wrapper-stripping pass, then atomically append `\n{trimmed content}\n` to the highest-numbered chapter file in `storyDir` — NO synthetic wrapper element SHALL be added, so any XML tags the model emitted (e.g. multiple `<image>` blocks) are preserved exactly as produced.

  In both cases the route SHALL re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }`, where `appendedTag` SHALL equal the resolved `appendTag` (the string for tagged append, `null` for tagless append). On abort the append step SHALL be skipped and `post-response` SHALL NOT be dispatched.
- `{ kind: "replace-last-chapter", pluginName, preservedPrefix }` when `replace: true`, where `preservedPrefix` is a REQUIRED string field equal to the captured leading `<user_message>` block (or the empty string when absent). In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. The route SHALL accumulate the entire stream in memory and, on successful completion only, atomically replace the highest-numbered chapter file in `storyDir` with `preservedPrefix` concatenated ahead of the trimmed accumulated content (followed by a single trailing newline) via `atomicWriteChapter` (write-to-temp + `Deno.rename`). When `preservedPrefix` is the empty string the written bytes are exactly the trimmed accumulated content plus the trailing newline (unchanged from prior behaviour). When the accumulated content trims to the empty string and `preservedPrefix` is non-empty, the written bytes SHALL be `preservedPrefix + "\n"` (the user's message is preserved even when the model returns nothing). The route SHALL re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after replace>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName }`. On abort or any error before the rename, the route SHALL NOT call `atomicWriteChapter`, the original chapter file SHALL remain byte-for-byte unchanged, and `post-response` SHALL NOT be dispatched. If `storyDir` contains no chapter files, the route SHALL respond HTTP 400 `plugin-action:no-chapter` and SHALL NOT touch the file system.
- `{ kind: "discard" }` when both `append` and `replace` are `false`. In this mode no chapter file is written, and `pre-write`, `response-stream`, and `post-response` hooks SHALL NOT be dispatched.

The route SHALL stream live progress over WebSocket using the typed envelopes `plugin-action:delta` (`{ correlationId, chunk }`), `plugin-action:done` (`{ correlationId, content, usage, chapterUpdated, chapterReplaced, appendedTag }`), `plugin-action:error` (`{ correlationId, problem }`), and `plugin-action:aborted` (`{ correlationId }`). The `appendedTag` field SHALL be the resolved append tag string for a tagged append and `null` for a tagless append, a `replace` run, or a `discard` run. The `chapterReplaced` boolean SHALL be `true` when the request used `replace: true` and the rename succeeded, and `false` otherwise. When the client invokes the route over plain HTTP without an active WebSocket the route SHALL NOT emit per-delta progress and SHALL return only the final JSON response body `{ content, usage, chapterUpdated, chapterReplaced, appendedTag }`.

**Append wrapper normalisation (tagged append only):** before wrapping, the route SHALL trim the accumulated content; if the trimmed content matches `^<{escaped appendTag}\b[^>]*>([\s\S]*)</{escaped appendTag}>\s*$` (one matching outer wrapper) it SHALL strip exactly that one outer layer and re-trim. The route SHALL strip at most ONE outer wrapper layer so legitimately nested same-name elements are preserved. This normalisation SHALL NOT run for a tagless append, where the content is trimmed but otherwise appended verbatim.

**Replace finalisation:** after the upstream stream completes successfully, the route SHALL trim the accumulated content (`trimEnd()`), prepend the carried `preservedPrefix` (the empty string when no leading `<user_message>` block was captured), append a single `"\n"`, and pass the result to `atomicWriteChapter(storyDir, "<padded-target>.md", content)`. The atomic-write helper SHALL write to a `*.tmp-<uuid>` sibling and then `Deno.rename` into place; on any error before the rename the temp file SHALL be best-effort removed and the original chapter file SHALL remain unchanged.

**De-duplication guard:** the LLM never receives the `<user_message>` bytes (they are stripped out of `draft`), so it SHOULD NOT emit a `<user_message>` block. As a defensive measure, when a non-empty `preservedPrefix` is being re-prepended AND the trimmed accumulated content ITSELF begins with a leading `<user_message>` block (per the same anchored capture used for the chapter), the route SHALL drop that model-emitted leading block before prepending the preserved prefix, so the written chapter never contains two leading `<user_message>` blocks. When `preservedPrefix` is empty, a model-emitted leading block is left untouched (consistent with the no-block-unchanged behaviour).

#### Scenario: Successful run with append
- **WHEN** the action bar dispatches `runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" })` for the `state` plugin against an existing story
- **THEN** the route SHALL render `state-recompute.md` from the `state` plugin directory through the system-prompt pipeline, stream the LLM response over WebSocket as `plugin-action:delta` envelopes, normalise the accumulated content (stripping any single outer `<UpdateVariable>` wrapper the model emitted), atomically append `\n<UpdateVariable>\n{normalised content}\n</UpdateVariable>\n` to the last chapter file, re-read the chapter file and dispatch `post-response` with the full chapter content and `source: "plugin-action"`, and return `{ content, usage, chapterUpdated: true, chapterReplaced: false, appendedTag: "UpdateVariable" }`

#### Scenario: Successful run with tagless append
- **WHEN** the action bar dispatches `runPluginPrompt("image-design.md", { append: true })` (no `appendTag`) for the `sd-webui-image-gen` plugin against an existing story, and the model output contains several `<image>…</image>` blocks interleaved with narrative prose
- **THEN** the route SHALL resolve the mode to a tagless append (`appendTag: null`), `trim()` the accumulated content WITHOUT any wrapper-stripping pass, and atomically append exactly the bytes `\n{trimmed content}\n` (a single leading newline, the trimmed content verbatim, a single trailing newline) to the last chapter file with NO added wrapper element so every `<image>` block survives verbatim, re-read the chapter file and dispatch `post-response` with the full chapter content, `source: "plugin-action"`, and `appendedTag: null`, and return `{ content, usage, chapterUpdated: true, chapterReplaced: false, appendedTag: null }`

#### Scenario: Tagless append does not strip a leading XML block
- **WHEN** a tagless append (`append: true`, no `appendTag`) completes with accumulated content whose trimmed form happens to begin with `<image>` and end with `</image>` (a single block)
- **THEN** the route SHALL append that block verbatim (only trimmed) and SHALL NOT strip the `<image>` element, because the single-outer-wrapper normalisation runs only for tagged appends

#### Scenario: Successful run with replace
- **WHEN** the action bar dispatches `runPluginPrompt("polish-instruction.md", { replace: true })` for the `polish` plugin against a story whose last chapter file is `003.md` and `003.md` has no leading `<user_message>` block
- **THEN** the route SHALL load the full content of `003.md` into the Vento variable `draft`, capture an empty preserved prefix, render `polish-instruction.md` through the system-prompt pipeline, stream the LLM response over WebSocket as `plugin-action:delta` envelopes, and on successful completion atomically replace `003.md` with the trimmed accumulated content (plus a single trailing newline) via `atomicWriteChapter`, re-read the chapter file and dispatch `post-response` with the full chapter content, `source: "plugin-action"`, and `pluginName: "polish"`, and return `{ content, usage, chapterUpdated: true, chapterReplaced: true, appendedTag: null }`

#### Scenario: Replace mode preserves a leading user_message block
- **WHEN** the action bar dispatches `runPluginPrompt("polish-instruction.md", { replace: true })` for the `polish` plugin against a story whose last chapter file `003.md` begins with `<user_message>\n玩家輸入\n</user_message>\n\n` followed by narrative prose, and the loaded plugin set declares `promptStripTags: ["user_message"]`
- **THEN** the route SHALL capture `<user_message>\n玩家輸入\n</user_message>\n\n` (block plus its trailing separator) as the preserved prefix, bind `draft` to the chapter content with that `<user_message>` block removed (so the LLM never receives the `<user_message>` bytes), and on successful completion atomically write `003.md` as the captured `<user_message>` prefix immediately followed by the trimmed polished prose plus a single trailing newline — so the `<user_message>` block survives the polish round byte-for-byte and `post-response.content` / the returned `content` reflect the re-prepended block

#### Scenario: Replace mode preserves user_message for a non-polish plugin
- **WHEN** a plugin OTHER than `polish` (e.g. a hypothetical `rewrite` plugin) dispatches `runPluginPrompt("rewrite.md", { replace: true })` against a chapter whose last chapter file begins with `<user_message>\n玩家輸入\n</user_message>\n\n` followed by prose, and the loaded plugin set declares `promptStripTags: ["user_message"]`
- **THEN** the route SHALL apply the SAME preserved-prefix mechanism as for `polish` — capturing the leading `<user_message>` block, keeping it out of `draft`, and re-prepending it ahead of the trimmed rewrite — so the `<user_message>` block survives byte-for-byte; preservation is a property of `replace` mode, not of the `polish` plugin

#### Scenario: Replace mode without a leading user_message block is unchanged
- **WHEN** a `replace: true` run is dispatched against a chapter that contains no leading `<user_message>` block
- **THEN** the preserved prefix SHALL be the empty string and the written chapter SHALL be exactly the trimmed polished prose plus a single trailing newline, byte-for-byte identical to the pre-change behaviour

#### Scenario: Replace mode does not preserve a non-leading user_message block
- **WHEN** a `replace: true` run is dispatched against a chapter whose only `<user_message>` block appears in the MIDDLE of the chapter body (not at the leading position)
- **THEN** the route SHALL capture an empty preserved prefix, the mid-body `<user_message>` block SHALL still be stripped out of `draft` by `getStripTagPatterns()`, and the polished output SHALL NOT contain that `<user_message>` block (it is ordinary stripped content, not a preserved prefix)

#### Scenario: Replace mode does not preserve a user_message block preceded by other content
- **WHEN** a `replace: true` run is dispatched against a chapter that begins with some other block (e.g. `<meta>…</meta>\n`) followed by `<user_message>…</user_message>\n\n` and then prose — i.e. `<user_message>` is NOT at byte 0
- **THEN** the route SHALL capture an empty preserved prefix and the `<user_message>` block SHALL be lost from the polished output (a documented limitation: only a `<user_message>` block anchored at the chapter start is preserved; this configuration cannot arise with the built-in plugin set, in which only the `user-message` plugin registers `pre-write`)

#### Scenario: Replace mode drops a model-emitted leading user_message when re-prepending
- **WHEN** a `replace: true` run is dispatched against a chapter with a leading `<user_message>玩家輸入</user_message>` block, and the (misbehaving) model output ITSELF begins with its own leading `<user_message>…</user_message>` block followed by prose
- **THEN** the route SHALL drop the model-emitted leading `<user_message>` block before re-prepending the captured `preservedPrefix`, so the written chapter contains exactly ONE leading `<user_message>` block (the preserved original) followed by the model's prose — never two leading blocks

#### Scenario: Replace mode preserves user_message even when the model returns empty content
- **WHEN** a `replace: true` run completes successfully against a chapter with a leading `<user_message>…</user_message>\n\n` block but the accumulated LLM output trims to the empty string
- **THEN** the route SHALL write the chapter as `preservedPrefix + "\n"` (the `<user_message>` block plus its separator, plus the finaliser's single trailing newline), so the user's message survives even when the model emits nothing, and `post-response.content` SHALL reflect those bytes

#### Scenario: Replace mode does not over-capture prose whitespace into the prefix
- **WHEN** a `replace: true` run is dispatched against a chapter whose leading `<user_message>…</user_message>` block is followed by `\n\n\n   ` (more than two line breaks and/or indentation) before the prose body
- **THEN** the captured preserved prefix SHALL include at most the two line breaks immediately after `</user_message>` and SHALL NOT absorb the additional blank line(s)/indentation, which remain part of the LLM-controlled body region

#### Scenario: Replace mode does not preserve an uppercase USER_MESSAGE block
- **WHEN** a `replace: true` run is dispatched against a chapter whose leading block is a hand-edited uppercase `<USER_MESSAGE>…</USER_MESSAGE>` and the loaded plugin set declares `promptStripTags: ["user_message"]`
- **THEN** the route SHALL NOT capture it as a preserved prefix (capture is case-sensitive to the engine's lowercase emission), the block SHALL still be removed from `draft` by the case-insensitive strip regex, and the block SHALL be absent from the polished output (documented case-sensitivity asymmetry)

#### Scenario: Replace mode preserves user_message with no promptStripTags configured
- **WHEN** a `replace: true` run is dispatched in a deployment with NO plugin declaring `promptStripTags` (so `getStripTagPatterns()` returns null) against a chapter with a leading `<user_message>…</user_message>\n\n` block
- **THEN** the preserved-prefix capture SHALL still succeed (it operates on the raw chapter bytes, independent of the strip regex), `draft` SHALL be the raw chapter trimmed (no strip pass available), and the polished output SHALL begin with the preserved `<user_message>` block

#### Scenario: Replace mode rejects when story has no chapter
- **WHEN** a request sends `"replace": true` against a story directory that contains no chapter files
- **THEN** the route SHALL respond with HTTP 400 `plugin-action:no-chapter` and SHALL NOT call `atomicWriteChapter`

#### Scenario: Replace mode rejects when combined with append
- **WHEN** a request sends `"append": true, "replace": true`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-replace-combo` and SHALL NOT touch the chapter file

#### Scenario: Replace mode rejects when combined with appendTag
- **WHEN** a request sends `"replace": true, "appendTag": "Foo"`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-replace-combo` and SHALL NOT touch the chapter file

#### Scenario: Append mode allows omitted appendTag
- **WHEN** a request sends `"append": true` and omits `appendTag` entirely
- **THEN** the route SHALL accept the request as a tagless append, resolve `appendTag` to `null`, and proceed to the append finalisation without adding any wrapper element

#### Scenario: appendTag present but malformed still rejected in append mode
- **WHEN** a request sends `"append": true, "appendTag": "Update Variable"` (with a space), or `"appendTag": "<script>"`, or `"appendTag": ""` (empty string), or `"appendTag": null` (explicit JSON null)
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-append-tag` and SHALL NOT modify the chapter file

#### Scenario: Replace mode rejects explicit null appendTag
- **WHEN** a request sends `"replace": true, "appendTag": null`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-replace-combo` and SHALL NOT touch the chapter file

#### Scenario: Replace mode preserves original chapter on abort
- **WHEN** the client cancels a `replace: true` run while the LLM stream is still flowing
- **THEN** the route SHALL re-throw `ChatAbortError` before calling `atomicWriteChapter`, the highest-numbered chapter file SHALL remain byte-for-byte identical to its pre-request content (including any leading `<user_message>` block), the route SHALL emit `plugin-action:aborted` over WebSocket if connected, SHALL NOT dispatch `post-response`, and SHALL release the generation lock

#### Scenario: Replace mode preserves original chapter on LLM error
- **WHEN** the upstream LLM API returns an error mid-stream during a `replace: true` run
- **THEN** the route SHALL NOT call `atomicWriteChapter`, the highest-numbered chapter file SHALL remain byte-for-byte unchanged, the route SHALL surface the error as HTTP 502 (or `plugin-action:error` over WebSocket), SHALL NOT dispatch `post-response`, and SHALL release the generation lock

#### Scenario: Replace mode atomic swap visible to readers
- **WHEN** a `replace: true` run completes successfully and a concurrent reader reads the chapter file at the same moment
- **THEN** the reader SHALL observe either the full pre-replace content or the full post-replace content, never a partial overwrite, because `atomicWriteChapter` writes to a temp sibling and uses `Deno.rename` for the atomic swap

#### Scenario: Replace mode injects draft as Vento variable
- **WHEN** a `replace: true` run is dispatched against a story whose last chapter content is `"原稿…"`
- **THEN** the route SHALL render the prompt with `draft` bound to `"原稿…"` (the chapter file content after `getStripTagPatterns()` scrub) and SHALL ignore any `extraVariables.draft` in the request body — a request that supplies `extraVariables: { draft: "fake" }` SHALL be rejected with HTTP 400 `plugin-action:extra-variables-collision`

#### Scenario: Replace mode strips control tags from draft
- **WHEN** a `replace: true` run is dispatched against a story whose last chapter file contains both a leading `<user_message>玩家輸入</user_message>` and a `<chapter_summary>舊摘要</chapter_summary>` block alongside narrative prose, and the loaded plugin set declares `promptStripTags: ["user_message", "chapter_summary"]`
- **THEN** the `draft` Vento variable bound for prompt rendering SHALL contain neither `<user_message>...</user_message>` nor `<chapter_summary>...</chapter_summary>` (both blocks SHALL be removed by the same `pluginManager.getStripTagPatterns()` regex applied to chapter history elsewhere), the leading `<user_message>` block SHALL be re-prepended into the polished output via the preserved-prefix mechanism, the `<chapter_summary>` block SHALL NOT reappear in the polished output, and any other narrative prose between the wrappers SHALL be preserved into `draft`

#### Scenario: Replace mode token usage uses existing schema unchanged
- **WHEN** a `replace: true` run completes successfully and the upstream LLM response includes a usage block
- **THEN** the route SHALL append exactly one record to `<storyDir>/_usage.json` conforming to the existing `TokenUsageRecord` schema (`{ chapter, promptTokens, completionTokens, totalTokens, model, timestamp }`), the record's `chapter` field SHALL equal the polished chapter's number, NO new fields (e.g. `source`, `pluginName`) SHALL be introduced on the persisted record, and the live `post-response` hook payload SHALL still carry `source: "plugin-action"` + `pluginName: "polish"` for in-memory consumers (as it already does for `append`-mode plugin actions)

#### Scenario: Path traversal attempt rejected
- **WHEN** a request sends `"promptFile": "../../system.md"`
- **THEN** the route SHALL reject the request with HTTP 400 and an RFC 9457 Problem Details body whose `type` slug is `plugin-action:invalid-prompt-path`, and SHALL NOT read the resolved file

#### Scenario: Symlink escape rejected via realPath
- **WHEN** a plugin directory contains a symlink whose canonical target is outside the plugin directory and a request references the symlink as `promptFile`
- **THEN** the route SHALL canonicalise both the plugin directory and the resolved prompt path through `Deno.realPath()` before the containment check and reject with HTTP 400 `plugin-action:invalid-prompt-path`

#### Scenario: Non-md prompt file rejected
- **WHEN** a request sends `"promptFile": "plugin.json"`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:non-md-prompt` and SHALL NOT load the file

#### Scenario: Unknown plugin name rejected
- **WHEN** a request targets a plugin name that is syntactically valid but not in the loaded-plugin registry
- **THEN** the route SHALL reject with HTTP 404 `plugin-action:unknown-plugin`

#### Scenario: Syntactically invalid plugin name rejected
- **WHEN** a request targets `pluginName: "Bad Plugin"` (with a space)
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-plugin-name`

#### Scenario: extraVariables non-scalar rejected
- **WHEN** a request sends `"extraVariables": { "list": [1, 2, 3] }`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-extra-variables`

#### Scenario: extraVariables collides with reserved name
- **WHEN** a request sends `"extraVariables": { "previousContext": "fake" }`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:extra-variables-collision`

#### Scenario: extraVariables draft override rejected
- **WHEN** a request sends `"extraVariables": { "draft": "fake draft" }` (regardless of `replace` flag)
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:extra-variables-collision` and SHALL NOT load any chapter content

#### Scenario: Plugin prompt missing user message
- **WHEN** a plugin's prompt template renders without emitting any `{{ message "user" }}` block
- **THEN** the route SHALL reject with HTTP 422 `multi-message:no-user-message` and SHALL NOT modify the chapter file

#### Scenario: Concurrent generation conflict
- **WHEN** a normal chat generation or another plugin-action run is already in flight for the same story
- **THEN** the route SHALL respond with HTTP 409 `plugin-action:concurrent-generation` and SHALL NOT modify the chapter file

#### Scenario: Atomic generation lock acquired before render
- **WHEN** two run-prompt requests arrive for the same story within the same event-loop tick
- **THEN** the `tryMarkGenerationActive` helper SHALL grant the lock to exactly one request and the other SHALL receive HTTP 409 — neither request SHALL be able to observe an unlocked state between the check and the mark

#### Scenario: Stream aborted mid-flight
- **WHEN** the client cancels the run-prompt request before the stream completes
- **THEN** the route SHALL stop reading from the upstream LLM, emit `plugin-action:aborted` over WebSocket if connected, skip the append/replace step, NOT dispatch `post-response`, and release the generation lock

#### Scenario: Discard mode does not write to chapter
- **WHEN** a request sends `"append": false, "replace": false` (or omits both)
- **THEN** the route SHALL stream the LLM response and return its full content in the JSON response body without modifying any chapter file, and SHALL NOT dispatch `pre-write`, `response-stream`, or `post-response`

#### Scenario: Append mode post-response receives full chapter content
- **WHEN** an append-mode run (tagged or tagless) completes successfully
- **THEN** the `post-response` hook SHALL receive `{ content }` set to the full chapter file content AFTER the append (not the bare LLM response), so plugins relying on full-chapter replay see identical semantics whether the patch came from a normal chat or a plugin action

#### Scenario: Replace mode post-response receives full chapter content
- **WHEN** a replace-mode run completes successfully
- **THEN** the `post-response` hook SHALL receive `{ content }` set to the full chapter file content AFTER the replace (re-read from disk, including any re-prepended `<user_message>` prefix), matching the semantics already used by `write-new-chapter` and `append-to-existing-chapter`

#### Scenario: Append wrapper normalisation strips one outer layer
- **WHEN** the model emits its response wrapped in exactly one `<UpdateVariable>...</UpdateVariable>` pair and the route is configured with `appendTag: "UpdateVariable"`
- **THEN** the route SHALL strip that single outer wrapper before re-wrapping so the appended chapter content contains exactly one `<UpdateVariable>` layer, not two

#### Scenario: Append wrapper normalisation preserves nested same-name elements
- **WHEN** the model emits its response wrapped in two nested `<UpdateVariable>` layers (e.g., model emitted `<UpdateVariable><UpdateVariable>inner</UpdateVariable></UpdateVariable>`)
- **THEN** the route SHALL strip exactly ONE outer layer (resulting in `<UpdateVariable>inner</UpdateVariable>` after re-wrapping), preserving the legitimately nested inner element

#### Scenario: Route-specific rate limit
- **WHEN** a single authenticated client issues 31 run-prompt requests in 60 seconds
- **THEN** the 31st request SHALL be rejected by the route-specific 30/min limiter with HTTP 429 and an RFC 9457 Problem Details body, regardless of the global 300/min budget
