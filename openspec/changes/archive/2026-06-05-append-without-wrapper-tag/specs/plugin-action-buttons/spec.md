## MODIFIED Requirements

### Requirement: Plugin run-prompt backend route

The server SHALL expose an authenticated `POST /api/plugins/:pluginName/run-prompt` endpoint, gated by the same passphrase middleware as other authed routes AND by a route-specific 30-requests-per-minute rate limiter (in addition to the global 300/min limiter). The request body SHALL contain `series` (string), `name` (story name, string), `promptFile` (string, relative to plugin directory), and the optional `append` (boolean, default `false`), `replace` (boolean, default `false`), `appendTag` (string, OPTIONAL even when `append` is `true`; when supplied it MUST be a string matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$` — an explicit JSON `null` is NOT a valid way to request a tagless append), and `extraVariables` (object whose values are `string | number | boolean` only). `append` and `replace` SHALL be mutually exclusive: a request that sets both to `true` SHALL be rejected with HTTP 400 `plugin-action:invalid-replace-combo`. A request that sets `replace: true` together with a non-`undefined` `appendTag` (including an explicit JSON `null`) SHALL be rejected with the same `plugin-action:invalid-replace-combo` slug.

When `append: true`, the route SHALL resolve `appendTag` as follows: an omitted/`undefined` `appendTag` SHALL resolve to a tagless append (`appendTag: null`); a string matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$` SHALL resolve to that tag; any other value — including an explicit JSON `null`, a non-string value, or a string failing the regex (such as the empty string) — SHALL be rejected with HTTP 400 `plugin-action:invalid-append-tag`. Only total omission opts into tagless append; this is symmetric with `replace` mode, which rejects any non-`undefined` `appendTag` (including `null`).

The route SHALL validate `pluginName` against `isValidPluginName()` (HTTP 400 on syntactic violation, with `type` slug `plugin-action:invalid-plugin-name`) and against the loaded-plugin registry (HTTP 404 with `type` slug `plugin-action:unknown-plugin` when the name is syntactically valid but no plugin with that name is loaded). The route SHALL validate `series`/`name` via the existing `isValidParam` rules, resolve `storyDir` via `safePath(playgroundDir, series, name)`, and require the directory to exist (HTTP 404 otherwise).

The route SHALL acquire the per-story generation lock atomically via a `tryMarkGenerationActive(series, name)` helper before any LLM call begins; if the lock is already held the route SHALL respond HTTP 409 with `type` slug `plugin-action:concurrent-generation` and SHALL NOT touch the chapter file. The lock SHALL be released in a `finally` block whether the run succeeds, errors, or aborts. The same atomic-acquire helper SHALL be used by the normal chat path (replacing the existing check-then-mark sequence).

The route SHALL resolve the prompt file path with `safePath` followed by `Deno.realPath()` canonicalisation of both the plugin directory and the resolved prompt path before applying `isPathContained` against the canonicalised plugin directory; reject anything outside it with HTTP 400 and `type` slug `plugin-action:invalid-prompt-path`; reject prompt files whose extension is not `.md` (HTTP 400, `plugin-action:non-md-prompt`); reject paths whose target is not a regular file or does not exist (HTTP 400, `plugin-action:prompt-file-not-found`).

The route SHALL render the file with the same Vento setup `system.md` uses (including dynamic variables, lore variables, and the `{{ message }}` tag) plus any `extraVariables` merged into the variable map. `extraVariables` keys that collide with reserved system-prompt variable names (`previousContext`, `previous_context`, `user_input`, `userInput`, `status_data`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`, `draft`, or any `lore_*`) SHALL cause HTTP 400 `plugin-action:extra-variables-collision`. `extraVariables` values that are not scalar strings/numbers/booleans SHALL cause HTTP 400 `plugin-action:invalid-extra-variables`. The variable `user_input` SHALL default to the empty string for plugin-action runs.

When `replace: true`, the route SHALL — after successfully acquiring the generation lock and BEFORE rendering the prompt — load the highest-numbered chapter file's full content from `storyDir`, run it through the combined `promptStripTags` regex returned by `pluginManager.getStripTagPatterns()` (the same scrub `chat-shared.ts`/`story.ts::stripPromptTags` apply to chapter history), and inject the stripped string into the Vento variable map as `draft`. When `replace` is not `true`, `draft` SHALL be the empty string. Callers SHALL NOT be able to override the server-supplied `draft` because `draft` is a reserved name (see above).

Plugin prompt templates SHALL be required to emit at least one `{{ message "user" }}…{{ /message }}` block; the existing `assertHasUserMessage` guard SHALL surface a missing user-role message as HTTP 422 with `type` slug `multi-message:no-user-message`.

The route SHALL execute the LLM call through the shared `streamLlmAndPersist` helper extracted from `executeChat`, supplying a discriminated `writeMode`:
- `{ kind: "append-to-existing-chapter", appendTag, pluginName }` when `append: true`, where `appendTag` is `string | null` (`null` for the tagless append). In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. After successful stream completion the route SHALL produce the appended payload as follows:
  - **Tagged append (`appendTag` is a string):** normalise the accumulated content (see "Append wrapper normalisation"), then atomically append `\n<{appendTag}>\n{normalised content}\n</{appendTag}>\n` to the highest-numbered chapter file in `storyDir`.
  - **Tagless append (`appendTag` is `null`):** `trim()` the accumulated content WITHOUT any wrapper-stripping pass, then atomically append `\n{trimmed content}\n` to the highest-numbered chapter file in `storyDir` — NO synthetic wrapper element SHALL be added, so any XML tags the model emitted (e.g. multiple `<image>` blocks) are preserved exactly as produced.

  In both cases the route SHALL re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }`, where `appendedTag` SHALL equal the resolved `appendTag` (the string for tagged append, `null` for tagless append). On abort the append step SHALL be skipped and `post-response` SHALL NOT be dispatched.
- `{ kind: "replace-last-chapter", pluginName }` when `replace: true`. In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. The route SHALL accumulate the entire stream in memory and, on successful completion only, atomically replace the highest-numbered chapter file in `storyDir` with the trimmed accumulated content (followed by a single trailing newline) via `atomicWriteChapter` (write-to-temp + `Deno.rename`). The route SHALL re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after replace>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName }`. On abort or any error before the rename, the route SHALL NOT call `atomicWriteChapter`, the original chapter file SHALL remain byte-for-byte unchanged, and `post-response` SHALL NOT be dispatched. If `storyDir` contains no chapter files, the route SHALL respond HTTP 400 `plugin-action:no-chapter` and SHALL NOT touch the file system.
- `{ kind: "discard" }` when both `append` and `replace` are `false`. In this mode no chapter file is written, and `pre-write`, `response-stream`, and `post-response` hooks SHALL NOT be dispatched.

The route SHALL stream live progress over WebSocket using the typed envelopes `plugin-action:delta` (`{ correlationId, chunk }`), `plugin-action:done` (`{ correlationId, content, usage, chapterUpdated, chapterReplaced, appendedTag }`), `plugin-action:error` (`{ correlationId, problem }`), and `plugin-action:aborted` (`{ correlationId }`). The `appendedTag` field SHALL be the resolved append tag string for a tagged append and `null` for a tagless append, a `replace` run, or a `discard` run. The `chapterReplaced` boolean SHALL be `true` when the request used `replace: true` and the rename succeeded, and `false` otherwise. When the client invokes the route over plain HTTP without an active WebSocket the route SHALL NOT emit per-delta progress and SHALL return only the final JSON response body `{ content, usage, chapterUpdated, chapterReplaced, appendedTag }`.

**Append wrapper normalisation (tagged append only):** before wrapping, the route SHALL trim the accumulated content; if the trimmed content matches `^<{escaped appendTag}\b[^>]*>([\s\S]*)</{escaped appendTag}>\s*$` (one matching outer wrapper) it SHALL strip exactly that one outer layer and re-trim. The route SHALL strip at most ONE outer wrapper layer so legitimately nested same-name elements are preserved. This normalisation SHALL NOT run for a tagless append, where the content is trimmed but otherwise appended verbatim.

**Replace finalisation:** after the upstream stream completes successfully, the route SHALL trim the accumulated content (`trimEnd()`), append a single `"\n"`, and pass the result to `atomicWriteChapter(storyDir, "<padded-target>.md", content)`. The atomic-write helper SHALL write to a `*.tmp-<uuid>` sibling and then `Deno.rename` into place; on any error before the rename the temp file SHALL be best-effort removed and the original chapter file SHALL remain unchanged.

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

- **WHEN** the action bar dispatches `runPluginPrompt("polish-instruction.md", { replace: true })` for the `polish` plugin against a story whose last chapter file is `003.md`
- **THEN** the route SHALL load the full content of `003.md` into the Vento variable `draft`, render `polish-instruction.md` through the system-prompt pipeline, stream the LLM response over WebSocket as `plugin-action:delta` envelopes, and on successful completion atomically replace `003.md` with the trimmed accumulated content (plus a single trailing newline) via `atomicWriteChapter`, re-read the chapter file and dispatch `post-response` with the full chapter content, `source: "plugin-action"`, and `pluginName: "polish"`, and return `{ content, usage, chapterUpdated: true, chapterReplaced: true, appendedTag: null }`

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

#### Scenario: Path traversal attempt rejected

- **WHEN** a request sends `"promptFile": "../../system.md"`
- **THEN** the route SHALL reject the request with HTTP 400 and an RFC 9457 Problem Details body whose `type` slug is `plugin-action:invalid-prompt-path`, and SHALL NOT read the resolved file

#### Scenario: Non-md prompt file rejected

- **WHEN** a request sends `"promptFile": "plugin.json"`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:non-md-prompt` and SHALL NOT load the file

#### Scenario: Append mode post-response receives full chapter content

- **WHEN** an append-mode run (tagged or tagless) completes successfully
- **THEN** the `post-response` hook SHALL receive `{ content }` set to the full chapter file content AFTER the append (not the bare LLM response), so plugins relying on full-chapter replay see identical semantics whether the patch came from a normal chat or a plugin action

#### Scenario: Append wrapper normalisation strips one outer layer

- **WHEN** the model emits its response wrapped in exactly one `<UpdateVariable>...</UpdateVariable>` pair and the route is configured with `appendTag: "UpdateVariable"`
- **THEN** the route SHALL strip that single outer wrapper before re-wrapping so the appended chapter content contains exactly one `<UpdateVariable>` layer, not two

#### Scenario: Append wrapper normalisation preserves nested same-name elements

- **WHEN** the model emits its response wrapped in two nested `<UpdateVariable>` layers (e.g., model emitted `<UpdateVariable><UpdateVariable>inner</UpdateVariable></UpdateVariable>`)
- **THEN** the route SHALL strip exactly ONE outer layer (resulting in `<UpdateVariable>inner</UpdateVariable>` after re-wrapping), preserving the legitimately nested inner element

#### Scenario: Stream aborted mid-flight

- **WHEN** the client cancels the run-prompt request before the stream completes
- **THEN** the route SHALL stop reading from the upstream LLM, emit `plugin-action:aborted` over WebSocket if connected, skip the append/replace step, NOT dispatch `post-response`, and release the generation lock

#### Scenario: Discard mode does not write to chapter

- **WHEN** a request sends `"append": false, "replace": false` (or omits both)
- **THEN** the route SHALL stream the LLM response and return its full content in the JSON response body without modifying any chapter file, and SHALL NOT dispatch `pre-write`, `response-stream`, or `post-response`

#### Scenario: Route-specific rate limit

- **WHEN** a single authenticated client issues 31 run-prompt requests in 60 seconds
- **THEN** the 31st request SHALL be rejected by the route-specific 30/min limiter with HTTP 429 and an RFC 9457 Problem Details body, regardless of the global 300/min budget

### Requirement: Frontend runPluginPrompt helper

The frontend SHALL provide a `runPluginPrompt(pluginName, promptFile, opts?)` helper that drives the new backend route while sharing the existing `useChatApi` streaming state (`isLoading`, `streamingContent`, `errorMessage`, `abortCurrentRequest`). The helper SHALL be auth-aware (using the same headers and WebSocket auth as the regular send path), SHALL prefer WebSocket dispatch when the connection is open and listen for `plugin-action:delta` envelopes to update `streamingContent`, SHALL transparently fall back to plain HTTP `POST /api/plugins/:pluginName/run-prompt` when no WebSocket is connected (in which case `streamingContent` will not update mid-stream), SHALL be abortable via the same `abortCurrentRequest` button (sending `plugin-action:abort` over WebSocket or aborting the HTTP request), SHALL refuse to start a new round while `isLoading` is already `true` (returning a rejected promise), and SHALL preserve the original options object's structural typing so plugin authors get autocomplete on `append` / `appendTag` / `replace` / `extraVariables`. The `opts.appendTag` field SHALL be an OPTIONAL `string`; the helper SHALL include an `appendTag` field on the WebSocket envelope and the HTTP body ONLY when `opts.appendTag !== undefined`, so a `{ append: true }` call with no `appendTag` SHALL produce a request payload that contains NO `appendTag` key (driving the backend's tagless append path). The `opts.replace` field SHALL be a `boolean` (default `false`); when set to `true` it SHALL be forwarded as `replace: true` on both the WebSocket envelope and the HTTP body, and the helper's resolved result SHALL include the `chapterReplaced` boolean returned by the server. The helper SHALL surface `plugin-action:invalid-replace-combo` errors via `errorMessage` and a rejected promise without mutating any local chapter state. When invoked from an `action-button:click` handler the helper's `pluginName` argument SHALL be supplied from the curried context so the plugin cannot trigger another plugin's prompts.

The helper (or its caller layer, `usePluginActions`) SHALL coordinate with the chapter editor in `ChapterContent.vue`. It SHALL consult an "editor has unsaved buffer for the current chapter" predicate (derived from `ChapterContent.vue`'s `isEditing` and `editBuffer` refs, lifted into a shared composable / store) and disable any action button whose plugin descriptor would trigger a `replace: true` round while that predicate is `true`; click attempts SHALL be no-ops with an explanatory toast/tooltip. When a `runPluginPrompt` call resolves with `chapterReplaced: true`, the helper SHALL — before settling its promise — force the editor's `isEditing` ref to `false`, clear `editBuffer` to the empty string, and trigger a chapter content reload via the existing chapter-fetch pathway so the rendered DOM picks up the new content immediately, ensuring a stale in-memory buffer cannot subsequently be `PUT` back over the polished file.

#### Scenario: Streaming progress visible during run (WebSocket path)

- **WHEN** `runPluginPrompt` is called with an open WebSocket and the LLM begins streaming response chunks
- **THEN** the `streamingContent` ref SHALL update with each accumulated `plugin-action:delta` chunk so the existing `streaming-preview` UI block renders the in-flight text identically to a normal send

#### Scenario: HTTP fallback returns final result without per-delta updates

- **WHEN** `runPluginPrompt` is called with no active WebSocket
- **THEN** the helper SHALL issue a plain `POST /api/plugins/:pluginName/run-prompt`, leave `streamingContent` empty, and resolve with the final response body when the request completes

#### Scenario: Append with appendTag forwards the tag

- **WHEN** `runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" })` is called with an active WebSocket
- **THEN** the helper SHALL emit a `plugin-action:run` envelope that includes `append: true` and `appendTag: "UpdateVariable"`

#### Scenario: Append without appendTag omits the tag (WebSocket path)

- **WHEN** `runPluginPrompt("image-design.md", { append: true })` is called with no `appendTag` and an active WebSocket
- **THEN** the helper SHALL emit a `plugin-action:run` envelope that includes `append: true` and SHALL NOT include an `appendTag` field

#### Scenario: Append without appendTag omits the tag (HTTP fallback)

- **WHEN** `runPluginPrompt("image-design.md", { append: true })` is called with no `appendTag` and no active WebSocket
- **THEN** the helper SHALL `POST` a request body that includes `append: true` and SHALL NOT include an `appendTag` field to `/api/plugins/:pluginName/run-prompt`

#### Scenario: Concurrent call rejected

- **WHEN** `isLoading.value === true` and `runPluginPrompt` is invoked
- **THEN** the helper SHALL reject the returned promise with an explanatory error and SHALL NOT issue a network request

#### Scenario: Abort cancels run

- **WHEN** the user clicks the existing stop button while `runPluginPrompt` is mid-stream
- **THEN** `abortCurrentRequest` SHALL signal the underlying request (sending `plugin-action:abort` on the WS path or aborting the fetch on the HTTP path), the helper's promise SHALL reject with an aborted error, and `isLoading` SHALL flip back to `false`

#### Scenario: Replace flag forwarded over WebSocket

- **WHEN** `runPluginPrompt("polish-instruction.md", { replace: true })` is called for the `polish` plugin with an active WebSocket
- **THEN** the helper SHALL emit `{ type: "plugin-action:run", pluginName: "polish", promptFile: "polish-instruction.md", replace: true, … }` on the socket and SHALL NOT include `append` or `appendTag` fields

#### Scenario: chapterReplaced surfaced in resolved result

- **WHEN** a `replace: true` run completes successfully
- **THEN** the helper's resolved result SHALL include `chapterReplaced: true` in addition to `content`, `usage`, `chapterUpdated`, and `appendedTag`
