## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), `name` (string), and `correlationId` (non-empty string — a UUID generated at the entry of `executeChat()` / `executeContinue()` and threaded through `buildPromptFromStory()` / `buildContinuePromptFromStory()`; this same UUID SHALL be reused unchanged for the eventual `pre-llm-fetch` dispatch produced by the same chat request).
- `pre-llm-fetch`: Invoked once per upstream LLM request, dispatched from `streamLlmAndPersist()` in `writer/lib/chat-shared.ts` immediately before the `fetch(config.LLM_API_URL, ...)` call, after the request body has been fully constructed. The context object SHALL include `correlationId` (non-empty string — **the same** UUID that was passed into the `prompt-assembly` context for this request, propagated from `executeChat()` / `executeContinue()` through to `streamLlmAndPersist()`), `messages` (the final `ChatMessage[]` to be serialised), `model` (string), `requestMetadata` (`Readonly<Record<string, unknown>>` carrying the upstream sampler/control knobs including `stream`, `model`, and the same keys as `requestBody`), `storyDir` (string), `series` (string), `name` (string), and `writeMode` (`{ kind: string }` discriminating `"write-new-chapter"`, `"append-to-existing-chapter"`, `"continue-last-chapter"`, or `"replace-last-chapter"`). The stage is **observation-only** — handlers SHALL NOT influence the outgoing HTTP request; mutating any field of `context` SHALL NOT change the bytes posted to `config.LLM_API_URL`. Only the `messages` array and the `requestMetadata` object SHALL be deep-cloned and deep-frozen (`deepFreeze(structuredClone(...))`) at the dispatch site; any handler attempt to mutate either of those two fields (including any nested element/property) SHALL therefore throw a `TypeError` under strict mode. The remaining top-level context fields (`model`, `writeMode`, `correlationId`, `storyDir`, `series`, `name`) SHALL NOT be deep-frozen; handlers MAY reassign them locally, but such reassignment is purely observational — it SHALL NOT change the bytes posted to `config.LLM_API_URL`, and the dispatcher provides NO peer-isolation guarantee for these fields between parallel handlers (handlers MUST NOT depend on peer handlers leaving them untouched). This freeze invariant on `messages` and `requestMetadata` makes the `readOnly: true` contract runtime-enforced rather than convention-only for the fields that govern the outgoing request, and consequently the stage is **parallel-eligible** — the dispatcher SHALL accept `{ parallel: true, readOnly: true }` registrations for this stage (subject to the same `PARALLEL_ALLOWED` and `readOnly:true` rules that govern other parallel-eligible stages defined in the `hook-parallel-dispatch` capability). There is exactly one dispatch site; the hook is not re-dispatched on retry.
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
- **THEN** the hook system SHALL invoke all `prompt-assembly` handlers in priority order, passing a context object containing `previousContext` (mutable array of stripped chapter strings), `rawChapters` (array of original unstripped chapter contents for tag extraction), `storyDir` (string path to the story directory), `series` (string series name), `name` (string story name), and `correlationId` (non-empty string UUID for this chat request)

#### Scenario: Prompt-assembly stage dispatch point
- **WHEN** `buildPromptFromStory()` has constructed the initial `previousContext` array from chapter files (after tag stripping)
- **THEN** it SHALL dispatch the `prompt-assembly` hook with both the stripped `previousContext` array and the raw chapter contents (and the inbound `correlationId` argument), before passing the potentially-modified `previousContext` to `renderSystemPrompt()`

#### Scenario: Prompt-assembly correlationId is supplied by caller
- **WHEN** `executeChat()` or `executeContinue()` is invoked for a chat request
- **THEN** the entry function SHALL generate a single `correlationId = crypto.randomUUID()` and pass it as an argument into `buildPromptFromStory()` / `buildContinuePromptFromStory()`, which in turn SHALL include it in the `prompt-assembly` hook context as `context.correlationId`

#### Scenario: Prompt-assembly correlationId matches pre-llm-fetch correlationId
- **WHEN** a single chat request triggers both a `prompt-assembly` dispatch and the subsequent `pre-llm-fetch` dispatch in `streamLlmAndPersist()`
- **THEN** the `context.correlationId` value observed by `prompt-assembly` handlers SHALL strictly equal (`===`) the `context.correlationId` value observed by `pre-llm-fetch` handlers for that request; the engine SHALL NOT mint a separate UUID inside `streamLlmAndPersist()` when one was supplied by the caller

#### Scenario: Pre-llm-fetch stage invocation
- **WHEN** `streamLlmAndPersist()` has built `requestBody` (containing `messages`, `model`, sampler knobs, and `stream: true`) and is about to call `fetch(config.LLM_API_URL, { method: "POST", body: JSON.stringify(requestBody), ... })`
- **THEN** the hook system SHALL invoke all `pre-llm-fetch` handlers via the standard two-bucket serial-first dispatch (serial-bucket entries in priority order, followed by the parallel bucket per the `hook-parallel-dispatch` contract), passing a context object containing `correlationId`, `messages`, `model`, `requestMetadata`, `storyDir`, `series`, `name`, and `writeMode`, and SHALL await both buckets before issuing the upstream `fetch(...)` call

#### Scenario: Pre-llm-fetch is observation-only
- **WHEN** a `pre-llm-fetch` handler mutates `context.messages` (e.g., `context.messages.push(...)` or `context.messages = []`) or `context.requestMetadata`
- **THEN** the bytes posted to `config.LLM_API_URL` SHALL be byte-for-byte identical to the no-handler case for that request, because (a) the engine uses the locally-built `requestBody` (not the dispatched context) for the actual fetch, and (b) the dispatched `messages` and `requestMetadata` are deep-frozen so the mutation itself throws a `TypeError` under strict mode

#### Scenario: Pre-llm-fetch is parallel-eligible under readOnly contract
- **WHEN** a plugin manifest declares `hooks: [{ stage: "pre-llm-fetch", parallel: true, readOnly: true }]` or a plugin calls `hooks.register("pre-llm-fetch", h, { parallel: true, readOnly: true })`
- **THEN** the dispatcher SHALL register the handler in the parallel bucket for the stage (it SHALL NOT coerce `parallel: true` to `false`), and the handler SHALL be invoked concurrently with other parallel handlers on the same stage during dispatch
- **AND** a registration of `{ readOnly: true }` with `parallel` unset SHALL be auto-promoted to `parallel: true` by the Track B default-on rule defined in the `hook-parallel-dispatch` capability

#### Scenario: Pre-llm-fetch correlationId is non-empty
- **WHEN** any `pre-llm-fetch` dispatch occurs
- **THEN** `context.correlationId` SHALL be a non-empty string (the UUID generated on entry to `streamLlmAndPersist()`)

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
