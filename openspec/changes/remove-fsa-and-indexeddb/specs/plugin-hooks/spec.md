## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked once per content delta during streaming — plugins can observe or transform stream chunks as they arrive from the LLM. The context object SHALL include a mutable `chunk` (string) field, plus `correlationId`, `series`, `name`, `storyDir`, `chapterPath`, and `chapterNumber`. Handlers mutate `context.chunk` to transform or (by assigning `""`) drop the chunk.
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state status update). The context object SHALL include `content`, `storyDir`, `series`, `name`, `rootDir`, an optional `source` (string discriminating the trigger; `"chat"` for normal chat completions and `"plugin-action"` for plugin-action runs), an optional `pluginName` (set when `source === "plugin-action"`), an optional `chapterPath` (set whenever a chapter file was written or appended to), an optional `chapterNumber` (number, set alongside `chapterPath`), and an optional `appendedTag` (set when `source === "plugin-action"` and the run appended a wrapped block). For `source === "plugin-action"` runs, `content` SHALL be the FULL chapter file content after the append (not the bare LLM response) so consumers see identical semantics whether the patch came from a normal chat completion or a plugin-action append.
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
- `notification`: Invoked when a WebSocket event or frontend action triggers a notification opportunity — plugins can call the notification composable to emit notifications to the user
- `strip-tags`: Invoked during server-side chapter content stripping — plugins register tag names to strip from `previous_context` before prompt assembly
- `chat:send:before`: Invoked in the frontend before a chat message leaves the browser — plugins can inspect and transform the outgoing message text by returning a replacement string from the handler. Dispatched from `useChatApi.sendMessage()` and `useChatApi.resendMessage()` strictly before the WebSocket `chat:send`/`chat:resend` message is sent OR before the HTTP POST body is serialised on the fallback path.
- `chapter:render:after`: Invoked in the frontend at the end of `useMarkdownRenderer.renderChapter()`, after markdown parsing, DOMPurify sanitization, and placeholder reinjection have produced the final `RenderToken[]`. Plugins receive the tokens array by reference and can mutate it in place to add, remove, or decorate tokens. Dispatched once per chapter render, for every chapter (not just the last).
- `chapter:dom:ready`: Invoked in the frontend AFTER Vue commits a chapter's `v-html` token render to the live DOM. Plugins receive a context object containing `container` (the chapter's root `HTMLElement`, e.g. `div.chapter-content`), `tokens` (the same `RenderToken[]` passed through `chapter:render:after`), `rawMarkdown` (the original chapter string), and `chapterIndex` (number, zero-based). Dispatched once on mount and on every subsequent render commit (e.g., when `tokens` change or `renderEpoch` bumps), for every chapter (not just the last). This stage is the canonical entry point for plugins that need to inspect, measure, or annotate live rendered DOM nodes (`Range` construction, `IntersectionObserver` attachment, computed-style reads, etc.) and MUST NOT be used for content mutation that would re-trigger a render commit cycle.
- `chapter:dom:dispose`: Invoked in the frontend right before a `ChapterContent` instance is unmounted (e.g., navigation to a different route, story switch, or component teardown). Plugins receive a context object containing `container` (the same `HTMLElement` previously passed via `chapter:dom:ready`) and `chapterIndex` (number). Plugins SHALL use this to release any references they hold keyed by the container (e.g., `Range` objects registered against `Highlight` instances), preventing detached-DOM leaks across long sessions.
- `story:switch`: Invoked in the frontend when the active story changes — dispatched from `useChapterNav.loadFromBackend()` after the new story's metadata is committed to module state but before chapter content is displayed. Plugins can reset or initialise per-story state.
- `chapter:change`: Invoked in the frontend whenever the currently displayed chapter index changes — dispatched from `useChapterNav.navigateTo()`, `reloadToLast()`, and the route-watcher branches inside `initRouteSync()`. The hook SHALL also be dispatched once during initial story load (with `previousIndex: null`).
- `action-button:click`: Invoked in the frontend when the user clicks a plugin-contributed button in `PluginActionBar`. The context object SHALL contain `buttonId` (string), `pluginName` (string identifying the plugin that owns the button), `series` (string), `name` (story name), `storyDir` (string), `lastChapterIndex` (number or null), and the curried helper functions `runPluginPrompt(promptFile, opts?)`, `notify(input)`, and `reload()`. The dispatcher SHALL only invoke handlers whose owning plugin matches `context.pluginName`, treat the stage as async (await all handler return values in priority order), keep the clicked button's qualified `pendingKey` (`${pluginName}:${buttonId}`) until the aggregate dispatch promise settles, and on any handler rejection surface a default error notification via the toast system unless the handler already emitted one.

Each stage SHALL have a well-defined context object that handlers receive and can modify.

#### Scenario: Prompt-assembly stage invocation
- **WHEN** the server constructs the system prompt for an LLM request
- **THEN** the hook system SHALL invoke all `prompt-assembly` handlers in priority order, passing a context object containing `previousContext` (mutable array of stripped chapter strings), `rawChapters` (array of original unstripped chapter contents for tag extraction), `storyDir` (string path to the story directory), `series` (string series name), and `name` (string story name)

#### Scenario: Prompt-assembly stage dispatch point
- **WHEN** `buildPromptFromStory()` has constructed the initial `previousContext` array from chapter files (after tag stripping)
- **THEN** it SHALL dispatch the `prompt-assembly` hook with both the stripped `previousContext` array and the raw chapter contents, before passing the potentially-modified `previousContext` to `renderSystemPrompt()`

#### Scenario: Pre-write stage invocation
- **WHEN** the OpenRouter API returns a valid streaming response and the server is about to write to the chapter file
- **THEN** the hook system SHALL invoke all `pre-write` handlers in priority order, passing a context object containing `message`, `chapterPath`, `storyDir`, `series`, `name`, and `preContent`

#### Scenario: Response-stream stage invocation
- **WHEN** `executeChat()` in `writer/lib/chat-shared.ts` parses a non-empty content delta from the LLM SSE stream
- **THEN** the hook system SHALL invoke all `response-stream` handlers in priority order, passing a context object containing `correlationId`, mutable `chunk`, `series`, `name`, `storyDir`, `chapterPath`, and `chapterNumber`, before the delta is written to the chapter file or emitted via `onDelta`

#### Scenario: Response-stream stage is dispatched (not dormant)
- **WHEN** a plugin registers a handler via `hooks.register("response-stream", handler)`
- **THEN** the handler SHALL be invoked for every content delta during every LLM chat execution, for both HTTP `/api/chat` requests and WebSocket `chat:send`/`chat:resend` messages (both go through `executeChat()`)

#### Scenario: Post-response stage invocation
- **WHEN** the OpenRouter SSE stream completes and the full chapter content is available
- **THEN** the hook system SHALL invoke all `post-response` handlers in priority order, passing `{ content, storyDir, series, name, rootDir, source, pluginName? }` for side effects such as status patching

#### Scenario: Post-response source distinguishes plugin-action runs
- **WHEN** the plugin-action route completes a streaming response and dispatches `post-response`
- **THEN** the context SHALL set `source: "plugin-action"` and `pluginName` SHALL be set to the plugin name from the route URL so handlers can branch on the trigger

#### Scenario: Frontend-render stage invocation
- **WHEN** the frontend `md-renderer` processes chapter content for display
- **THEN** the hook system SHALL invoke all `frontend-render` handlers to register tag extractors and renderers before the rendering pipeline executes

#### Scenario: Notification stage invocation
- **WHEN** the frontend receives a WebSocket event that warrants user notification (e.g., `chat:done`)
- **THEN** the hook system SHALL invoke all `notification` handlers in priority order, passing a context object containing `event` (string event type), `data` (event payload), and `notify` (the notification composable's notify function)

#### Scenario: Strip-tags stage invocation
- **WHEN** chapter content is loaded for prompt assembly and tag stripping is performed
- **THEN** the hook system SHALL invoke `strip-tags` handlers to collect the union of tag names to strip before re-rendering chapter text into `previous_context`

#### Scenario: Action-button:click stage invocation
- **WHEN** the user clicks a plugin-contributed button in `PluginActionBar` whose owning plugin is `state` and whose `buttonId` is `recompute-state`
- **THEN** the dispatcher SHALL invoke only handlers registered by the `state` plugin for the `action-button:click` stage, in priority order, passing a context with `buttonId: "recompute-state"`, `pluginName: "state"`, `series`, `name`, `storyDir`, `lastChapterIndex`, and the curried helpers `runPluginPrompt`, `notify`, `reload`

#### Scenario: Action-button:click handlers are filtered by owning plugin
- **WHEN** plugin A and plugin B both register `action-button:click` handlers and the user clicks a button owned by plugin A
- **THEN** the dispatcher SHALL invoke plugin A's handlers and SHALL NOT invoke plugin B's handlers, regardless of whether plugin B's handler internally checks `buttonId`

#### Scenario: Action-button:click awaits async handlers
- **WHEN** an `action-button:click` handler returns a promise
- **THEN** the dispatcher SHALL await every handler's promise (in priority order) and the bar's qualified `pendingKey` (`${pluginName}:${buttonId}`) SHALL stay set until the aggregate dispatch settles

#### Scenario: Action-button:click default error notification
- **WHEN** an `action-button:click` handler rejects without itself emitting a notification
- **THEN** the dispatcher SHALL emit a default error toast via the notification system referencing the failed button's label and the error message, and SHALL still resolve the dispatch (no unhandled rejection)

#### Scenario: Post-response context for plugin-action append
- **WHEN** a plugin-action run with `append: true` and `appendTag: "UpdateVariable"` completes successfully
- **THEN** the `post-response` context SHALL include `source: "plugin-action"`, `pluginName`, `chapterPath`, `chapterNumber`, `appendedTag: "UpdateVariable"`, and `content` set to the full chapter file content AFTER the append

### Requirement: story:switch hook context and dispatch

The `story:switch` frontend hook stage SHALL pass a context object with the following shape:
- `previousSeries: string | null` — the series name that was active before this switch, or `null` if no story was previously loaded.
- `previousStory: string | null` — the story name that was active before this switch, or `null` if no story was previously loaded.
- `series: string` — the new series name.
- `story: string` — the new story name.

The hook SHALL be dispatched from `useChapterNav.loadFromBackend()` after the module's internal `currentSeries` and `currentStory` state has been updated, and before the first `chapter:change` dispatch for the new story.

The hook SHALL NOT fire when `loadFromBackend()` is called with the same series and story already loaded (i.e., only real transitions dispatch). Reloads of the same story (e.g., `reloadToLast()`) SHALL NOT dispatch `story:switch`.

Handler return values SHALL be ignored (informational stage).

#### Scenario: Switch from no story to a backend story
- **WHEN** `loadFromBackend("seriesA", "storyA")` is called as the first load
- **THEN** the hook SHALL dispatch with `previousSeries: null, previousStory: null, series: "seriesA", story: "storyA"`

#### Scenario: Switch between two backend stories
- **WHEN** `loadFromBackend("seriesB", "storyB")` is called while `seriesA/storyA` is active
- **THEN** the hook SHALL dispatch with `previousSeries: "seriesA", previousStory: "storyA", series: "seriesB", story: "storyB"`

#### Scenario: Reloading the same story does not fire story:switch
- **WHEN** `reloadToLast()` is called for the currently active story
- **THEN** the `story:switch` hook SHALL NOT be dispatched

### Requirement: chapter:change hook context and dispatch

The `chapter:change` frontend hook stage SHALL pass a context object with the following shape:
- `previousIndex: number | null` — the zero-based index of the chapter previously visible, or `null` on the initial dispatch immediately following a `story:switch`.
- `index: number` — the zero-based index of the newly visible chapter.
- `chapter: number` — the one-based chapter number (typically `index + 1`, or the `ChapterData.number` field).
- `series: string` — the active series.
- `story: string` — the active story.

The hook SHALL be dispatched from exactly one canonical site per state transition to avoid duplicate dispatches. The canonical dispatch sites are: `navigateTo()`, `reloadToLast()`, the chapter-param branch of the route watcher inside `initRouteSync()`, and once during initial story load in `loadFromBackend()` after `story:switch` has fired.

The hook SHALL NOT fire when the new index equals the current index (no-op navigation).

Handler return values SHALL be ignored (informational stage).

#### Scenario: Navigate next
- **WHEN** `next()` is called while `currentIndex === 2` for `series/story`
- **THEN** the hook SHALL dispatch with `previousIndex: 2, index: 3, chapter: 3 or matching ChapterData.number, series, story`

#### Scenario: Initial load after story:switch
- **WHEN** `loadFromBackend("s", "st")` has just dispatched `story:switch` and committed the initial chapter index
- **THEN** the hook SHALL dispatch exactly once with `previousIndex: null` and the initial `index`

#### Scenario: No-op navigation does not fire
- **WHEN** a route watcher triggers with a chapter param equal to the current `currentIndex + 1`
- **THEN** the `chapter:change` hook SHALL NOT be dispatched
