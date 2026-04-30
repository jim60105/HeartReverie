## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked once per content delta during streaming — plugins can observe or transform stream chunks as they arrive from the LLM. The context object SHALL include a mutable `chunk` (string) field, plus `correlationId`, `series`, `name`, `storyDir`, `chapterPath`, and `chapterNumber`. Handlers mutate `context.chunk` to transform or (by assigning `""`) drop the chunk.
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state status update)
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
- `notification`: Invoked when a WebSocket event or frontend action triggers a notification opportunity — plugins can call the notification composable to emit notifications to the user
- `strip-tags`: Invoked during server-side chapter content stripping — plugins register tag names to strip from `previous_context` before prompt assembly
- `chat:send:before`: Invoked in the frontend before a chat message leaves the browser — plugins can inspect and transform the outgoing message text by returning a replacement string from the handler. Dispatched from `useChatApi.sendMessage()` and `useChatApi.resendMessage()` strictly before the WebSocket `chat:send`/`chat:resend` message is sent OR before the HTTP POST body is serialised on the fallback path.
- `chapter:render:after`: Invoked in the frontend at the end of `useMarkdownRenderer.renderChapter()`, after markdown parsing, DOMPurify sanitization, and placeholder reinjection have produced the final `RenderToken[]`. Plugins receive the tokens array by reference and can mutate it in place to add, remove, or decorate tokens. Dispatched once per chapter render, for every chapter (not just the last).
- `chapter:dom:ready`: Invoked in the frontend AFTER Vue commits a chapter's `v-html` token render to the live DOM. Plugins receive a context object containing `container` (the chapter's root `HTMLElement`, e.g. `div.chapter-content`), `tokens` (the same `RenderToken[]` passed through `chapter:render:after`), `rawMarkdown` (the original chapter string), and `chapterIndex` (number, zero-based). Dispatched once on mount and on every subsequent render commit (e.g., when `tokens` change or `renderEpoch` bumps), for every chapter (not just the last). This stage is the canonical entry point for plugins that need to inspect, measure, or annotate live rendered DOM nodes (`Range` construction, `IntersectionObserver` attachment, computed-style reads, etc.) and MUST NOT be used for content mutation that would re-trigger a render commit cycle.
- `chapter:dom:dispose`: Invoked in the frontend right before a `ChapterContent` instance is unmounted (e.g., navigation to a different route, story switch, or component teardown). Plugins receive a context object containing `container` (the same `HTMLElement` previously passed via `chapter:dom:ready`) and `chapterIndex` (number). Plugins SHALL use this to release any references they hold keyed by the container (e.g., `Range` objects registered against `Highlight` instances), preventing detached-DOM leaks across long sessions.
- `story:switch`: Invoked in the frontend when the active story changes — dispatched from both `useChapterNav.loadFromBackend()` and `useChapterNav.loadFromFSA()` after the new story's metadata is committed to module state but before chapter content is displayed. Plugins can reset or initialise per-story state.
- `chapter:change`: Invoked in the frontend whenever the currently displayed chapter index changes — dispatched from `useChapterNav.navigateTo()`, `loadFSAChapter()`, `reloadToLast()`, and the route-watcher branches inside `initRouteSync()`. The hook SHALL also be dispatched once during initial story load (with `previousIndex: null`).

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
- **THEN** the hook system SHALL invoke all `post-response` handlers in priority order, passing `{ content, storyDir, series, name, rootDir }` for side effects such as status patching

#### Scenario: Frontend-render stage invocation
- **WHEN** the frontend `md-renderer` processes chapter content for display
- **THEN** the hook system SHALL invoke all `frontend-render` handlers to register tag extractors and renderers before the rendering pipeline executes

#### Scenario: Notification stage invocation
- **WHEN** the frontend receives a WebSocket event that warrants user notification (e.g., `chat:done`)
- **THEN** the hook system SHALL invoke all `notification` handlers in priority order, passing a context object containing `event` (string event type), `data` (event payload), and `notify` (the notification composable's notify function)

#### Scenario: Strip-tags stage invocation
- **WHEN** the server strips tags from chapter content before including it in `previous_context`
- **THEN** the hook system SHALL invoke all `strip-tags` handlers to collect tag names that should be stripped, in addition to the default tags

#### Scenario: chat:send:before stage invocation
- **WHEN** `useChatApi.sendMessage()` or `useChatApi.resendMessage()` is called with a user message
- **THEN** the hook system SHALL invoke all `chat:send:before` handlers in priority order, passing a context object containing `message` (string, the outgoing text), `series` (string), `story` (string), and `mode` (`"send"` or `"resend"`), BEFORE the WebSocket `chat:send`/`chat:resend` message is sent or the HTTP POST body is constructed

#### Scenario: chapter:render:after stage invocation
- **WHEN** `useMarkdownRenderer.renderChapter()` has produced the final `RenderToken[]` array via markdown parsing, DOMPurify sanitization, and placeholder reinjection
- **THEN** the hook system SHALL invoke all `chapter:render:after` handlers in priority order, passing a context object containing `tokens` (the mutable `RenderToken[]` array), `rawMarkdown` (the original chapter string), and `options` (the `RenderOptions` including `isLastChapter`), before `renderChapter()` returns

#### Scenario: chapter:dom:ready stage invocation
- **WHEN** Vue has committed a `ChapterContent` v-html token render to the live DOM (i.e. immediately after the `flush: "post"` watcher tick that follows a `tokens` or `renderEpoch` change, including the initial mount)
- **THEN** the hook system SHALL invoke all `chapter:dom:ready` handlers in priority order, passing a context object containing `container` (the chapter root `HTMLElement`), `tokens` (the same `RenderToken[]` consumed by `v-html`), `rawMarkdown` (the original chapter string), and `chapterIndex` (zero-based number)

#### Scenario: chapter:dom:ready dispatches once per render commit per chapter
- **WHEN** the user edits a chapter, cancels the edit, navigates between chapters, or any other action that causes `ChapterContent.vue` to re-render its token list and bump `renderEpoch`
- **THEN** `chapter:dom:ready` SHALL be dispatched exactly once for that chapter after each render commit; it SHALL NOT be dispatched in the absence of a render commit

#### Scenario: chapter:dom:dispose stage invocation
- **WHEN** a `ChapterContent.vue` instance is about to be unmounted (route change, story switch, parent re-key, etc.)
- **THEN** the hook system SHALL invoke all `chapter:dom:dispose` handlers in priority order, passing a context object containing `container` (the same `HTMLElement` previously passed via `chapter:dom:ready`) and `chapterIndex` (zero-based number), so plugins can release container-keyed state without leaking detached DOM

#### Scenario: story:switch stage invocation
- **WHEN** `useChapterNav.loadFromBackend()` or `useChapterNav.loadFromFSA()` is called and the target story differs from the previously loaded story
- **THEN** the hook system SHALL invoke all `story:switch` handlers in priority order, passing a context object containing `previousSeries` (string | null), `previousStory` (string | null), `series` (string | null, absent in FSA mode), `story` (string | null, absent in FSA mode), and `mode` (`"fsa"` | `"backend"`)

#### Scenario: chapter:change stage invocation
- **WHEN** the currently displayed chapter index changes in `useChapterNav` (via `navigateTo()`, `loadFSAChapter()`, `reloadToLast()`, route-watcher, or initial load)
- **THEN** the hook system SHALL invoke all `chapter:change` handlers in priority order, passing a context object containing `previousIndex` (number | null, `null` on initial load), `index` (number, the new zero-based chapter index), `chapter` (number, the one-based chapter number), `series` (string | null), `story` (string | null), and `mode` (`"fsa"` | `"backend"`)
