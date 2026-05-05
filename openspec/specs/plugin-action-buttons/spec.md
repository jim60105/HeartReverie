# plugin-action-buttons Specification

## Purpose
TBD - created by archiving change plugin-action-buttons. Update Purpose after archive.
## Requirements
### Requirement: Action button manifest field

Plugins SHALL be able to contribute interactive buttons to the reader UI by declaring an optional `actionButtons` array in their `plugin.json` manifest. Each entry SHALL be an `ActionButtonDescriptor` object with the fields `id` (required, kebab-case identifier matching `^[a-z0-9-]+$`, unique within the plugin), `label` (required, non-empty string of 1..40 characters after trim), `icon` (optional, short emoji or symbol), `tooltip` (optional, ≤200 characters), `priority` (optional finite number, defaulting to 100, lower renders first), and `visibleWhen` (optional, one of the literal strings `"last-chapter-backend"` or `"backend-only"`, defaulting to `"last-chapter-backend"`). The plugin loader SHALL validate every entry; entries that fail validation SHALL be dropped individually with a logged warning, and the rest of the plugin SHALL continue to load. Duplicate `id` values within a single plugin's `actionButtons` array SHALL keep the first occurrence and drop subsequent duplicates with a warning.

#### Scenario: Plugin declares a single action button
- **WHEN** a plugin's `plugin.json` contains `"actionButtons": [{ "id": "recompute-state", "label": "🧮 重算狀態" }]`
- **THEN** the loader SHALL register one `ActionButtonDescriptor` with the declared `id` and `label`, `priority` defaulted to `100`, `visibleWhen` defaulted to `"last-chapter-backend"`, and the descriptor SHALL be returned in the `GET /api/plugins` payload for that plugin

#### Scenario: Invalid descriptor entry is dropped without failing the plugin
- **WHEN** a plugin declares two `actionButtons` entries, one with `"id": "valid-button"` and one with `"id": "BAD ID"` (containing uppercase and spaces)
- **THEN** the loader SHALL register the valid descriptor, drop the invalid entry, log a warning identifying the plugin and the offending field, and continue to load the rest of the plugin's capabilities

#### Scenario: Duplicate id within a plugin
- **WHEN** a plugin declares two `actionButtons` entries with the same `id`
- **THEN** the loader SHALL register only the first occurrence, drop subsequent duplicates, and log a warning

#### Scenario: Unknown visibleWhen value
- **WHEN** an `actionButtons` entry sets `"visibleWhen": "always"` (not in the v1 allowed enum)
- **THEN** the loader SHALL drop that entry with a warning and SHALL NOT default it silently to a different value

### Requirement: Plugin action button API payload

The `GET /api/plugins` endpoint SHALL include the validated `actionButtons` array on each plugin descriptor it returns. Plugins that did not declare the field SHALL receive an empty array `[]` in the response so the frontend can rely on the field being present. Each descriptor's resolved defaults (`priority`, `visibleWhen`) SHALL be filled in by the server before serialisation.

#### Scenario: Plugin without actionButtons declaration
- **WHEN** a plugin's manifest omits the `actionButtons` field entirely
- **THEN** the `GET /api/plugins` payload for that plugin SHALL contain `"actionButtons": []`

#### Scenario: Defaults are filled in the response
- **WHEN** a plugin declares `[{ "id": "x", "label": "X" }]` and nothing else
- **THEN** the `GET /api/plugins` payload SHALL include `{ "id": "x", "label": "X", "priority": 100, "visibleWhen": "last-chapter-backend" }` for that descriptor

### Requirement: Plugin action bar UI panel

The reader frontend SHALL render a `PluginActionBar` component in the main reading layout, positioned between the `UsagePanel` and the `ChatInput`. The layout SHALL gate the `PluginActionBar` with the same visibility condition as `ChatInput` (i.e. `showChatInput`): when `ChatInput` is not rendered, `PluginActionBar` SHALL also not be rendered. Within this outer gate, the bar SHALL list one button per `ActionButtonDescriptor` returned by the plugin API whose `visibleWhen` clause matches the current view state. Buttons SHALL be sorted ascending by `priority`, with ties broken by the tuple `(pluginName ascending, declaration order ascending)`. The bar SHALL render no DOM at all when no descriptor is currently visible. When a button is clicked the bar SHALL hold a `pendingKey` of the form `${pluginName}:${buttonId}` for that button until the dispatch promise settles, render the pressed button in a disabled visual state, and prevent re-clicks on that exact `pendingKey` during the pending window. If the click handler throws or rejects, the bar SHALL surface the error via the existing toast notification system (e.g., `useNotifications`) by default, unless the plugin's own `action-button:click` handler already emitted a notification.

#### Scenario: Bar visibility with last-chapter-backend descriptor
- **WHEN** a plugin contributes a button with `visibleWhen: "last-chapter-backend"` and the user is viewing the last chapter of a story in backend mode
- **THEN** the `PluginActionBar` SHALL render with that button visible and clickable

#### Scenario: Bar collapses when no buttons match
- **WHEN** the user is viewing a non-last chapter in backend mode and all loaded buttons declare `visibleWhen: "last-chapter-backend"`
- **THEN** the `PluginActionBar` SHALL not render any DOM

#### Scenario: Sorting by priority and declaration order
- **WHEN** plugin A declares buttons `[{ id: "a1", priority: 50 }]` and plugin B declares `[{ id: "b1" }, { id: "b2" }]` (both default priority 100)
- **THEN** the bar SHALL render `a1` first (lower priority), then `b1`, then `b2` (plugin name and declaration order)

#### Scenario: Disabled state during dispatch
- **WHEN** the user clicks a button and the `action-button:click` dispatch is still pending
- **THEN** that button SHALL render disabled and clicks SHALL be ignored until the dispatch promise settles

#### Scenario: Qualified pending key prevents collision across plugins
- **WHEN** plugin A and plugin B each declare a button with the same `id` (e.g., `"refresh"`) and the user clicks plugin A's button
- **THEN** only the `pendingKey` `"plugin-a:refresh"` SHALL be marked pending — plugin B's `"plugin-b:refresh"` button SHALL remain clickable

#### Scenario: Default error notification on handler rejection
- **WHEN** an `action-button:click` handler rejects with an error and the handler did not surface a notification itself
- **THEN** the bar SHALL emit a default error toast via the notification system referencing the failed button's label and the error message

#### Scenario: Action bar hidden when ChatInput is hidden
- **WHEN** the current view state does not satisfy `showChatInput` (e.g. the user is not on the last chapter and story is not empty)
- **THEN** the layout SHALL not instantiate `PluginActionBar`, regardless of whether plugins have registered action buttons

### Requirement: Plugin run-prompt backend route

The server SHALL expose an authenticated `POST /api/plugins/:pluginName/run-prompt` endpoint, gated by the same passphrase middleware as other authed routes AND by a route-specific 30-requests-per-minute rate limiter (in addition to the global 300/min limiter). The request body SHALL contain `series` (string), `name` (story name, string), `promptFile` (string, relative to plugin directory), and the optional `append` (boolean, default `false`), `replace` (boolean, default `false`), `appendTag` (string, required when `append` is `true`, matching `^[a-zA-Z][a-zA-Z0-9_-]{0,30}$`), and `extraVariables` (object whose values are `string | number | boolean` only). `append` and `replace` SHALL be mutually exclusive: a request that sets both to `true` SHALL be rejected with HTTP 400 `plugin-action:invalid-replace-combo`. A request that sets `replace: true` together with `appendTag` SHALL be rejected with the same `plugin-action:invalid-replace-combo` slug.

The route SHALL validate `pluginName` against `isValidPluginName()` (HTTP 400 on syntactic violation, with `type` slug `plugin-action:invalid-plugin-name`) and against the loaded-plugin registry (HTTP 404 with `type` slug `plugin-action:unknown-plugin` when the name is syntactically valid but no plugin with that name is loaded). The route SHALL validate `series`/`name` via the existing `isValidParam` rules, resolve `storyDir` via `safePath(playgroundDir, series, name)`, and require the directory to exist (HTTP 404 otherwise).

The route SHALL acquire the per-story generation lock atomically via a `tryMarkGenerationActive(series, name)` helper before any LLM call begins; if the lock is already held the route SHALL respond HTTP 409 with `type` slug `plugin-action:concurrent-generation` and SHALL NOT touch the chapter file. The lock SHALL be released in a `finally` block whether the run succeeds, errors, or aborts. The same atomic-acquire helper SHALL be used by the normal chat path (replacing the existing check-then-mark sequence).

The route SHALL resolve the prompt file path with `safePath` followed by `Deno.realPath()` canonicalisation of both the plugin directory and the resolved prompt path before applying `isPathContained` against the canonicalised plugin directory; reject anything outside it with HTTP 400 and `type` slug `plugin-action:invalid-prompt-path`; reject prompt files whose extension is not `.md` (HTTP 400, `plugin-action:non-md-prompt`); reject paths whose target is not a regular file or does not exist (HTTP 400, `plugin-action:prompt-file-not-found`).

The route SHALL render the file with the same Vento setup `system.md` uses (including dynamic variables, lore variables, and the `{{ message }}` tag) plus any `extraVariables` merged into the variable map. `extraVariables` keys that collide with reserved system-prompt variable names (`previousContext`, `previous_context`, `user_input`, `userInput`, `status_data`, `isFirstRound`, `series_name`, `story_name`, `plugin_fragments`, `draft`, or any `lore_*`) SHALL cause HTTP 400 `plugin-action:extra-variables-collision`. `extraVariables` values that are not scalar strings/numbers/booleans SHALL cause HTTP 400 `plugin-action:invalid-extra-variables`. The variable `user_input` SHALL default to the empty string for plugin-action runs.

When `replace: true`, the route SHALL — after successfully acquiring the generation lock and BEFORE rendering the prompt — load the highest-numbered chapter file's full content from `storyDir`, run it through the combined `promptStripTags` regex returned by `pluginManager.getStripTagPatterns()` (the same scrub `chat-shared.ts`/`story.ts::stripPromptTags` apply to chapter history), and inject the stripped string into the Vento variable map as `draft`. When `replace` is not `true`, `draft` SHALL be the empty string. Callers SHALL NOT be able to override the server-supplied `draft` because `draft` is a reserved name (see above).

Plugin prompt templates SHALL be required to emit at least one `{{ message "user" }}…{{ /message }}` block; the existing `assertHasUserMessage` guard SHALL surface a missing user-role message as HTTP 422 with `type` slug `multi-message:no-user-message`.

The route SHALL execute the LLM call through the shared `streamLlmAndPersist` helper extracted from `executeChat`, supplying a discriminated `writeMode`:
- `{ kind: "append-to-existing-chapter", appendTag, pluginName }` when `append: true`. In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. After successful stream completion the route SHALL normalise the accumulated content (see "Append wrapper normalisation"), atomically append `\n<{appendTag}>\n{normalised content}\n</{appendTag}>\n` to the highest-numbered chapter file in `storyDir`, re-read the full chapter file, and dispatch `post-response` with `{ content: <full chapter content after append>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName, appendedTag }`. On abort the append step SHALL be skipped and `post-response` SHALL NOT be dispatched.
- `{ kind: "replace-last-chapter", pluginName }` when `replace: true`. In this mode `pre-write` and `response-stream` hooks SHALL NOT be dispatched. The route SHALL accumulate the entire stream in memory and, on successful completion only, atomically replace the highest-numbered chapter file in `storyDir` with the trimmed accumulated content (followed by a single trailing newline) via `atomicWriteChapter` (write-to-temp + `Deno.rename`). The route SHALL re-read the full chapter file and dispatch `post-response` with `{ content: <full chapter content after replace>, chapterPath, chapterNumber, storyDir, series, name, rootDir, source: "plugin-action", pluginName }`. On abort or any error before the rename, the route SHALL NOT call `atomicWriteChapter`, the original chapter file SHALL remain byte-for-byte unchanged, and `post-response` SHALL NOT be dispatched. If `storyDir` contains no chapter files, the route SHALL respond HTTP 400 `plugin-action:no-chapter` and SHALL NOT touch the file system.
- `{ kind: "discard" }` when both `append` and `replace` are `false`. In this mode no chapter file is written, and `pre-write`, `response-stream`, and `post-response` hooks SHALL NOT be dispatched.

The route SHALL stream live progress over WebSocket using the typed envelopes `plugin-action:delta` (`{ correlationId, chunk }`), `plugin-action:done` (`{ correlationId, content, usage, chapterUpdated, chapterReplaced, appendedTag }`), `plugin-action:error` (`{ correlationId, problem }`), and `plugin-action:aborted` (`{ correlationId }`). The `chapterReplaced` boolean SHALL be `true` when the request used `replace: true` and the rename succeeded, and `false` otherwise. When the client invokes the route over plain HTTP without an active WebSocket the route SHALL NOT emit per-delta progress and SHALL return only the final JSON response body `{ content, usage, chapterUpdated, chapterReplaced, appendedTag }`.

**Append wrapper normalisation:** before wrapping, the route SHALL trim the accumulated content; if the trimmed content matches `^<{escaped appendTag}\b[^>]*>([\s\S]*)</{escaped appendTag}>\s*$` (one matching outer wrapper) it SHALL strip exactly that one outer layer and re-trim. The route SHALL strip at most ONE outer wrapper layer so legitimately nested same-name elements are preserved.

**Replace finalisation:** after the upstream stream completes successfully, the route SHALL trim the accumulated content (`trimEnd()`), append a single `"\n"`, and pass the result to `atomicWriteChapter(storyDir, "<padded-target>.md", content)`. The atomic-write helper SHALL write to a `*.tmp-<uuid>` sibling and then `Deno.rename` into place; on any error before the rename the temp file SHALL be best-effort removed and the original chapter file SHALL remain unchanged.

#### Scenario: Successful run with append
- **WHEN** the action bar dispatches `runPluginPrompt("state-recompute.md", { append: true, appendTag: "UpdateVariable" })` for the `state` plugin against an existing story
- **THEN** the route SHALL render `state-recompute.md` from the `state` plugin directory through the system-prompt pipeline, stream the LLM response over WebSocket as `plugin-action:delta` envelopes, normalise the accumulated content (stripping any single outer `<UpdateVariable>` wrapper the model emitted), atomically append `\n<UpdateVariable>\n{normalised content}\n</UpdateVariable>\n` to the last chapter file, re-read the chapter file and dispatch `post-response` with the full chapter content and `source: "plugin-action"`, and return `{ content, usage, chapterUpdated: true, chapterReplaced: false, appendedTag: "UpdateVariable" }`

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

#### Scenario: Replace mode preserves original chapter on abort
- **WHEN** the client cancels a `replace: true` run while the LLM stream is still flowing
- **THEN** the route SHALL re-throw `ChatAbortError` before calling `atomicWriteChapter`, the highest-numbered chapter file SHALL remain byte-for-byte identical to its pre-request content, the route SHALL emit `plugin-action:aborted` over WebSocket if connected, SHALL NOT dispatch `post-response`, and SHALL release the generation lock

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
- **WHEN** a `replace: true` run is dispatched against a story whose last chapter file contains both `<user_message>玩家輸入</user_message>` and `<chapter_summary>舊摘要</chapter_summary>` blocks alongside narrative prose, and the loaded plugin set declares `promptStripTags: ["user_message", "chapter_summary"]`
- **THEN** the `draft` Vento variable bound for prompt rendering SHALL contain neither `<user_message>...</user_message>` nor `<chapter_summary>...</chapter_summary>` (both blocks SHALL be removed by the same `pluginManager.getStripTagPatterns()` regex applied to chapter history elsewhere), the polished output written by `atomicWriteChapter` SHALL contain neither tag block, and any other narrative prose between the wrappers SHALL be preserved into `draft`

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

#### Scenario: appendTag missing when append is true
- **WHEN** a request sends `"append": true` without `appendTag`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-append-tag`

#### Scenario: appendTag fails regex validation
- **WHEN** a request sends `"appendTag": "Update Variable"` (with a space) or `"appendTag": "<script>"`
- **THEN** the route SHALL reject with HTTP 400 `plugin-action:invalid-append-tag` and SHALL NOT modify the chapter file

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
- **WHEN** an append-mode run completes successfully
- **THEN** the `post-response` hook SHALL receive `{ content }` set to the full chapter file content AFTER the append (not the bare LLM response), so plugins relying on full-chapter replay see identical semantics whether the patch came from a normal chat or a plugin action

#### Scenario: Replace mode post-response receives full chapter content
- **WHEN** a replace-mode run completes successfully
- **THEN** the `post-response` hook SHALL receive `{ content }` set to the full chapter file content AFTER the replace (re-read from disk), matching the semantics already used by `write-new-chapter` and `append-to-existing-chapter`

#### Scenario: Append wrapper normalisation strips one outer layer
- **WHEN** the model emits its response wrapped in exactly one `<UpdateVariable>...</UpdateVariable>` pair and the route is configured with `appendTag: "UpdateVariable"`
- **THEN** the route SHALL strip that single outer wrapper before re-wrapping so the appended chapter content contains exactly one `<UpdateVariable>` layer, not two

#### Scenario: Append wrapper normalisation preserves nested same-name elements
- **WHEN** the model emits its response wrapped in two nested `<UpdateVariable>` layers (e.g., model emitted `<UpdateVariable><UpdateVariable>inner</UpdateVariable></UpdateVariable>`)
- **THEN** the route SHALL strip exactly ONE outer layer (resulting in `<UpdateVariable>inner</UpdateVariable>` after re-wrapping), preserving the legitimately nested inner element

#### Scenario: Route-specific rate limit
- **WHEN** a single authenticated client issues 31 run-prompt requests in 60 seconds
- **THEN** the 31st request SHALL be rejected by the route-specific 30/min limiter with HTTP 429 and an RFC 9457 Problem Details body, regardless of the global 300/min budget

### Requirement: Frontend runPluginPrompt helper

The frontend SHALL provide a `runPluginPrompt(pluginName, promptFile, opts?)` helper that drives the new backend route while sharing the existing `useChatApi` streaming state (`isLoading`, `streamingContent`, `errorMessage`, `abortCurrentRequest`). The helper SHALL be auth-aware (using the same headers and WebSocket auth as the regular send path), SHALL prefer WebSocket dispatch when the connection is open and listen for `plugin-action:delta` envelopes to update `streamingContent`, SHALL transparently fall back to plain HTTP `POST /api/plugins/:pluginName/run-prompt` when no WebSocket is connected (in which case `streamingContent` will not update mid-stream), SHALL be abortable via the same `abortCurrentRequest` button (sending `plugin-action:abort` over WebSocket or aborting the HTTP request), SHALL refuse to start a new round while `isLoading` is already `true` (returning a rejected promise), and SHALL preserve the original options object's structural typing so plugin authors get autocomplete on `append` / `appendTag` / `replace` / `extraVariables`. The `opts.replace` field SHALL be a `boolean` (default `false`); when set to `true` it SHALL be forwarded as `replace: true` on both the WebSocket envelope and the HTTP body, and the helper's resolved result SHALL include the `chapterReplaced` boolean returned by the server. The helper SHALL surface `plugin-action:invalid-replace-combo` errors via `errorMessage` and a rejected promise without mutating any local chapter state. When invoked from an `action-button:click` handler the helper's `pluginName` argument SHALL be supplied from the curried context so the plugin cannot trigger another plugin's prompts.

The helper (or its caller layer, `usePluginActions`) SHALL coordinate with the chapter editor in `ChapterContent.vue`. It SHALL consult an "editor has unsaved buffer for the current chapter" predicate (derived from `ChapterContent.vue`'s `isEditing` and `editBuffer` refs, lifted into a shared composable / store) and disable any action button whose plugin descriptor would trigger a `replace: true` round while that predicate is `true`; click attempts SHALL be no-ops with an explanatory toast/tooltip. When a `runPluginPrompt` call resolves with `chapterReplaced: true`, the helper SHALL — before settling its promise — force the editor's `isEditing` ref to `false`, clear `editBuffer` to the empty string, and trigger a chapter content reload via the existing chapter-fetch pathway so the rendered DOM picks up the new content immediately, ensuring a stale in-memory buffer cannot subsequently be `PUT` back over the polished file.

#### Scenario: Streaming progress visible during run (WebSocket path)
- **WHEN** `runPluginPrompt` is called with an open WebSocket and the LLM begins streaming response chunks
- **THEN** the `streamingContent` ref SHALL update with each accumulated `plugin-action:delta` chunk so the existing `streaming-preview` UI block renders the in-flight text identically to a normal send

#### Scenario: HTTP fallback returns final result without per-delta updates
- **WHEN** `runPluginPrompt` is called with no active WebSocket
- **THEN** the helper SHALL issue a plain `POST /api/plugins/:pluginName/run-prompt`, leave `streamingContent` empty, and resolve with the final response body when the request completes

#### Scenario: Concurrent call rejected
- **WHEN** `isLoading.value === true` and `runPluginPrompt` is invoked
- **THEN** the helper SHALL reject the returned promise with an explanatory error and SHALL NOT issue a network request

#### Scenario: Abort cancels run
- **WHEN** the user clicks the existing stop button while `runPluginPrompt` is mid-stream
- **THEN** `abortCurrentRequest` SHALL signal the underlying request (sending `plugin-action:abort` on the WS path or aborting the fetch on the HTTP path), the helper's promise SHALL reject with an aborted error, and `isLoading` SHALL flip back to `false`

#### Scenario: Replace flag forwarded over WebSocket
- **WHEN** `runPluginPrompt("polish-instruction.md", { replace: true })` is called for the `polish` plugin with an active WebSocket
- **THEN** the helper SHALL emit `{ type: "plugin-action:run", pluginName: "polish", promptFile: "polish-instruction.md", replace: true, … }` on the socket and SHALL NOT include `append` or `appendTag` fields

#### Scenario: Replace flag forwarded over HTTP fallback
- **WHEN** `runPluginPrompt("polish-instruction.md", { replace: true })` is called with no active WebSocket
- **THEN** the helper SHALL `POST` the request body `{ series, name, promptFile: "polish-instruction.md", replace: true }` (no `append`, no `appendTag`) to `/api/plugins/polish/run-prompt`

#### Scenario: chapterReplaced surfaced in resolved result
- **WHEN** a `replace: true` run completes successfully
- **THEN** the helper's resolved result SHALL include `chapterReplaced: true` in addition to `content`, `usage`, `chapterUpdated`, and `appendedTag`

#### Scenario: Polish-class button disabled while editor has unsaved buffer
- **WHEN** the user has opened the markdown editor on the current last chapter (`isEditing.value === true` in `ChapterContent.vue`) with any non-empty `editBuffer`, and `runPluginPrompt(...)` would otherwise be dispatchable for a `replace: true` action button (e.g. the `polish` button)
- **THEN** that action button SHALL render disabled, a click SHALL NOT issue any network request, and the helper SHALL surface an explanatory hint (toast or tooltip) such as "請先儲存或捨棄章節編輯內容後再潤飾"

#### Scenario: Editor force-closed and chapter reloaded after replace
- **WHEN** a `runPluginPrompt(..., { replace: true })` call resolves with `chapterReplaced: true` while the chapter editor in `ChapterContent.vue` is currently open on the replaced chapter
- **THEN** before the helper's promise settles, the editor's `isEditing` ref SHALL be set to `false`, `editBuffer` SHALL be cleared to the empty string, the chapter content SHALL be re-fetched via the existing chapter-fetch pathway so the rendered DOM shows the polished text immediately, and any subsequent attempt by stale UI to `PUT` the prior buffer back SHALL find no editor session to drive that save

### Requirement: Plugin action bar visibility filter

The frontend SHALL evaluate each `ActionButtonDescriptor`'s `visibleWhen` clause against the current view state to decide whether the descriptor renders. Because `MainLayout` gates `PluginActionBar` with `showChatInput` (which requires the last chapter or an empty story in backend mode), both `"backend-only"` and `"last-chapter-backend"` clauses are effectively equivalent at runtime — the bar is never mounted on non-last chapters. The `"backend-only"` clause remains as a manifest option for forward-compatibility but SHALL NOT cause the bar to render outside the `showChatInput` gate. The set of visible descriptors SHALL recompute reactively when route or chapter index changes — no manual reload required.

#### Scenario: backend-only on last chapter
- **WHEN** a button declares `visibleWhen: "backend-only"` and the user is viewing the last chapter of a backend story
- **THEN** the bar SHALL render the button

#### Scenario: backend-only on non-last chapter
- **WHEN** a button declares `visibleWhen: "backend-only"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL NOT render because the layout gate (`showChatInput`) prevents `PluginActionBar` from mounting

#### Scenario: last-chapter-backend on last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user is viewing the last chapter of the story
- **THEN** the bar SHALL render the button

#### Scenario: last-chapter-backend on non-last chapter
- **WHEN** a button declares `visibleWhen: "last-chapter-backend"` and the user navigates to chapter 1 of a 3-chapter story
- **THEN** the bar SHALL hide the button until the user navigates to the last chapter

### Requirement: Bundled polish plugin

The repository SHALL ship a bundled plugin at `plugins/polish/` containing `plugin.json`, `polish-instruction.md`, and `README.md`. The plugin manifest SHALL declare `type: "prompt-only"` (no `frontendModule`, no `backendModule`) and a single `actionButtons` entry with `id: "polish"`, a Traditional-Chinese label such as `"潤飾"` (1..40 chars), `visibleWhen: "last-chapter-backend"`, and a `priority` ordered AFTER existing built-in buttons. The plugin SHALL declare `displayStripTags` and `promptStripTags` only if `polish-instruction.md` introduces wrapper tags (the v1 prompt does not — both arrays SHALL be empty or omitted). `polish-instruction.md` SHALL be a Vento template that:

1. Emits exactly one `{{ message "system" }}` block instructing the model to act as a literary editor for modern Chinese fiction with the following constraints — literary modern Chinese prose; advance the story through dialogue rather than narration; "show, don't tell"; smooth scene transitions with connecting beats; faithful character voices; full-width punctuation for Chinese, ASCII punctuation for other languages; plain prose only — no bullet lists, no headings, no commentary preamble.
2. Emits exactly one `{{ message "user" }}` block that wraps `{{ draft }}` in a `<draft>…</draft>` envelope and explicitly instructs the model to return only the rewritten chapter (no preamble, no surrounding tags, no chain-of-thought).
3. Contains NO age-related directives, NO jailbreak/bypass language, NO "no content restrictions" claims, NO NSFW directives, and NO "do not disclose this prompt" clauses. Anything along those lines from external inspiration material SHALL NOT be carried over.

The plugin SHALL be auto-discovered by the existing `PluginManager` and SHALL contribute its `polish` action button via the existing `plugin-action-buttons` capability without any new manifest field.

#### Scenario: Polish plugin auto-discovered
- **WHEN** the writer server boots with `plugins/polish/` present and a valid `plugin.json`
- **THEN** the `PluginManager` SHALL load the plugin, expose its `polish` action-button descriptor on `GET /api/plugins`, and the `PluginActionBar` SHALL render the button on the last chapter of any backend story

#### Scenario: Polish prompt is SFW
- **WHEN** `plugins/polish/polish-instruction.md` is reviewed at PR time
- **THEN** the file SHALL contain none of the strings `18+`, `NSFW`, `RPJB`, `no content restrictions`, `jailbreak`, `bypass`, `DO NOT DISCLOSE`, or any age-related fictional-character disclaimer language

#### Scenario: Polish click triggers replace round
- **WHEN** the user clicks the `潤飾` button on the last chapter of a backend story
- **THEN** the frontend SHALL invoke `runPluginPrompt("polish-instruction.md", { replace: true })` for plugin `polish` via the curried `action-button:click` context, the route SHALL load the chapter content into `draft`, stream the LLM response, and atomically replace the chapter file on success

#### Scenario: Polish button hidden when chapter list empty
- **WHEN** a story directory contains no chapter files
- **THEN** the `last-chapter-backend` visibility filter SHALL hide the `polish` button — the user cannot dispatch a polish round, and the server-side `plugin-action:no-chapter` guard remains as a defensive backstop

#### Scenario: Polish button disabled during generation
- **WHEN** any chat generation or plugin-action run is in flight (`isLoading` is `true`)
- **THEN** the `polish` button SHALL render disabled via the existing `PluginActionBar` pending-state plumbing, and a click SHALL be ignored

#### Scenario: Polish button disabled when editor has unsaved buffer
- **WHEN** the user has opened the markdown editor on the current last chapter (`isEditing` true with a non-empty `editBuffer` for the chapter the polish button targets)
- **THEN** the `polish` button SHALL render disabled and a click SHALL NOT trigger any network request — the user must first save or discard the editor session before polishing

#### Scenario: Editor closed and chapter reloaded after polish completes
- **WHEN** a polish round finishes successfully (`runPluginPrompt(..., { replace: true })` resolves with `chapterReplaced: true`) while the editor is open on that chapter
- **THEN** the `ChapterContent.vue` editor SHALL be force-closed (`isEditing` set to `false`, `editBuffer` cleared), the chapter SHALL be re-fetched so the polished content is visible immediately, and the user SHALL NOT be able to overwrite the polished file by re-saving the prior buffer

