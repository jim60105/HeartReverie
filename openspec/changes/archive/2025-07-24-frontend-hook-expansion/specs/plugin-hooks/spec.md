## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked during streaming — plugins can observe or transform stream chunks as they arrive from OpenRouter
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state status update)
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
- `notification`: Invoked when a WebSocket event or frontend action triggers a notification opportunity — plugins can call the notification composable to emit notifications to the user
- `strip-tags`: Invoked during server-side chapter content stripping — plugins register tag names to strip from `previous_context` before prompt assembly
- `chat:send:before`: Invoked in the frontend before a chat message leaves the browser — plugins can inspect and transform the outgoing message text by returning a replacement string from the handler. Dispatched from `useChatApi.sendMessage()` and `useChatApi.resendMessage()` strictly before the WebSocket `chat:send`/`chat:resend` message is sent OR before the HTTP POST body is serialised on the fallback path.
- `chapter:render:after`: Invoked in the frontend at the end of `useMarkdownRenderer.renderChapter()`, after markdown parsing, DOMPurify sanitization, and placeholder reinjection have produced the final `RenderToken[]`. Plugins receive the tokens array by reference and can mutate it in place to add, remove, or decorate tokens. Dispatched once per chapter render, for every chapter (not just the last).
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
- **WHEN** the server receives a content delta from the OpenRouter SSE stream
- **THEN** the hook system SHALL invoke all `response-stream` handlers in priority order, passing the chunk content and allowing handlers to observe or transform it

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

#### Scenario: story:switch stage invocation
- **WHEN** `useChapterNav.loadFromBackend()` or `useChapterNav.loadFromFSA()` is called and the target story differs from the previously loaded story
- **THEN** the hook system SHALL invoke all `story:switch` handlers in priority order, passing a context object containing `previousSeries` (string | null), `previousStory` (string | null), `series` (string | null, absent in FSA mode), `story` (string | null, absent in FSA mode), and `mode` (`"fsa"` | `"backend"`)

#### Scenario: chapter:change stage invocation
- **WHEN** the currently displayed chapter index changes in `useChapterNav` (via `navigateTo()`, `loadFSAChapter()`, `reloadToLast()`, route-watcher, or initial load)
- **THEN** the hook system SHALL invoke all `chapter:change` handlers in priority order, passing a context object containing `previousIndex` (number | null, `null` on initial load), `index` (number, the new zero-based chapter index), `chapter` (number, the one-based chapter number), `series` (string | null), `story` (string | null), and `mode` (`"fsa"` | `"backend"`)

## ADDED Requirements

### Requirement: chat:send:before hook context and return-value contract

The `chat:send:before` frontend hook stage SHALL pass a context object with the following shape:
- `message: string` — the current outgoing chat message text.
- `series: string` — the target series name.
- `story: string` — the target story name.
- `mode: "send" | "resend"` — whether the call originated from `sendMessage()` or `resendMessage()`.

Handlers MAY return a `string` to replace `context.message` for subsequent handlers and for the eventual network send. Any non-string return value (including `undefined`, `null`, numbers, objects) SHALL be ignored and `context.message` SHALL remain unchanged by that handler. Handlers MAY also mutate `context.message` directly; when a handler both mutates the context and returns a string, the returned string SHALL take precedence.

After all handlers have executed, `useChatApi` SHALL use the final `context.message` value as the payload for the WebSocket `chat:send`/`chat:resend` message or the HTTP POST body.

If a handler throws, the hook dispatcher SHALL log the error via `console.error` and continue executing subsequent handlers with the current `context.message` (which may reflect any mutation performed before the throw). This matches the error-isolation semantics of all other frontend hook stages.

#### Scenario: Handler rewrites outgoing message via return value
- **WHEN** a `chat:send:before` handler returns the string `"/expanded command"` for an input `message` of `"/cmd"`
- **THEN** the subsequent handlers and the network send SHALL see `context.message === "/expanded command"`

#### Scenario: Handler returns non-string
- **WHEN** a `chat:send:before` handler returns `undefined`, `null`, a number, or an object
- **THEN** `context.message` SHALL NOT be changed by that handler's return value

#### Scenario: Multiple handlers chain transformations
- **WHEN** two `chat:send:before` handlers are registered, the first returning `"A"` and the second returning `"A → B"`
- **THEN** the final `context.message` SHALL be `"A → B"` and handlers SHALL run in priority order (lower number first), matching the existing ordering semantics

#### Scenario: Handler throws mid-pipeline
- **WHEN** a `chat:send:before` handler throws after mutating `context.message`
- **THEN** the dispatcher SHALL log the error and proceed to the next handler with the mutated `context.message`

#### Scenario: Dispatch occurs before WebSocket send
- **WHEN** `useChatApi.sendMessage(series, story, msg)` is invoked and the WebSocket is connected and authenticated
- **THEN** the `chat:send:before` hook SHALL be dispatched and its final `context.message` SHALL be used as the `message` field of the emitted `chat:send` WebSocket message

#### Scenario: Dispatch occurs before HTTP fallback POST
- **WHEN** `useChatApi.sendMessage(series, story, msg)` is invoked and no WebSocket connection is available
- **THEN** the `chat:send:before` hook SHALL be dispatched and its final `context.message` SHALL be used as the `message` property of the JSON POST body to `/api/stories/<series>/<story>/chat`

#### Scenario: Mode field reflects resend
- **WHEN** `useChatApi.resendMessage()` dispatches the hook
- **THEN** `context.mode` SHALL equal `"resend"`; when called from `sendMessage()` it SHALL equal `"send"`

### Requirement: chapter:render:after hook context and mutation model

The `chapter:render:after` frontend hook stage SHALL pass a context object with the following shape:
- `tokens: RenderToken[]` — the final token array produced by `renderChapter()`. Passed by reference; handlers MAY mutate the array (push, splice, reassign element `.content`) to alter the rendered output.
- `rawMarkdown: string` — the original unmodified chapter markdown passed into `renderChapter()`.
- `options: RenderOptions` — the same options object passed to `renderChapter()`, including `isLastChapter`.

The hook SHALL be dispatched exactly once per `renderChapter()` invocation, after DOMPurify sanitization and `reinjectPlaceholders()` have completed, and BEFORE `renderChapter()` returns the token array to the caller. The hook SHALL fire for every chapter render regardless of `isLastChapter`.

After all `chapter:render:after` handlers have executed, if any token was added, replaced, or had its HTML-bearing content mutated, the final HTML MUST be re-sanitized through DOMPurify before `renderChapter()` returns. The re-sanitization SHALL use the same DOMPurify configuration as the primary sanitization pass. Tokens that were not mutated during the hook dispatch MAY be skipped by the re-sanitization step for efficiency. Plugins are still encouraged to sanitize their own HTML defensively, but the dispatcher's re-sanitization is the authoritative safety net and guarantees that no plugin can inject executable script content, inline event handlers, or `javascript:` URIs into the rendered chapter.

Handler return values SHALL be ignored (informational stage).

#### Scenario: Handler receives sanitized tokens
- **WHEN** `renderChapter("# hello")` completes sanitization
- **THEN** a `chapter:render:after` handler SHALL receive `context.tokens` containing the already-sanitized HTML token(s)

#### Scenario: Handler mutates tokens in place
- **WHEN** a handler calls `context.tokens.push({ type: "html", content: "<div>annotation</div>" })`
- **THEN** `renderChapter()` SHALL return the array including the pushed token

#### Scenario: Hook fires for every chapter, not only the last
- **WHEN** `renderChapter(md, { isLastChapter: false })` is called
- **THEN** the `chapter:render:after` hook SHALL be dispatched and `context.options.isLastChapter` SHALL be `false`

#### Scenario: Dispatcher re-sanitizes mutated token HTML
- **WHEN** a `chapter:render:after` handler sets a token's `.content` to `"<p>hi</p><script>alert(1)</script>"`
- **THEN** after the hook dispatch completes, `renderChapter()` SHALL re-run DOMPurify over the mutated token(s) before returning
- **AND** the returned token's `.content` SHALL NOT contain the `<script>` element or its inline JavaScript

#### Scenario: Plugin mutates token to include script tags
- **WHEN** a plugin mutates a token to include `<script>` tags (or inline event handlers such as `onclick=`, or `javascript:` URLs)
- **THEN** the script tags, event handlers, and dangerous URIs SHALL be stripped by the dispatcher's re-sanitization step before `renderChapter()` returns

#### Scenario: Unmutated tokens bypass re-sanitization
- **WHEN** no `chapter:render:after` handler mutates the tokens array or any token's content
- **THEN** `renderChapter()` MAY return the tokens without re-running DOMPurify (no-op optimisation)

### Requirement: story:switch hook context and dispatch

The `story:switch` frontend hook stage SHALL pass a context object with the following shape:
- `previousSeries: string | null` — the series name that was active before this switch, or `null` if no story was previously loaded.
- `previousStory: string | null` — the story name that was active before this switch, or `null` if no story was previously loaded.
- `series: string | null` — the new series name, or `null` when switching into FSA (local file) mode.
- `story: string | null` — the new story name, or `null` when switching into FSA mode.
- `mode: "fsa" | "backend"` — the new reader mode after the switch.

The hook SHALL be dispatched from both `useChapterNav.loadFromBackend()` and `useChapterNav.loadFromFSA()` after the module's internal `currentSeries`, `currentStory`, and `mode` state has been updated, and before the first `chapter:change` dispatch for the new story.

The hook SHALL NOT fire when `loadFromBackend()` is called with the same series and story already loaded (i.e., only real transitions dispatch). Reloads of the same story (e.g., `reloadToLast()`) SHALL NOT dispatch `story:switch`.

Handler return values SHALL be ignored (informational stage).

#### Scenario: Switch from no story to backend story
- **WHEN** `loadFromBackend("seriesA", "storyA")` is called as the first load
- **THEN** the hook SHALL dispatch with `previousSeries: null, previousStory: null, series: "seriesA", story: "storyA", mode: "backend"`

#### Scenario: Switch between two backend stories
- **WHEN** `loadFromBackend("seriesB", "storyB")` is called while `seriesA/storyA` is active
- **THEN** the hook SHALL dispatch with `previousSeries: "seriesA", previousStory: "storyA", series: "seriesB", story: "storyB", mode: "backend"`

#### Scenario: Switch into FSA mode
- **WHEN** `loadFromFSA(handle)` is called while a backend story was active
- **THEN** the hook SHALL dispatch with `previousSeries` and `previousStory` set to the prior backend values, `series: null, story: null, mode: "fsa"`

#### Scenario: Reloading the same story does not fire story:switch
- **WHEN** `reloadToLast()` is called for the currently active story
- **THEN** the `story:switch` hook SHALL NOT be dispatched

### Requirement: chapter:change hook context and dispatch

The `chapter:change` frontend hook stage SHALL pass a context object with the following shape:
- `previousIndex: number | null` — the zero-based index of the chapter previously visible, or `null` on the initial dispatch immediately following a `story:switch`.
- `index: number` — the zero-based index of the newly visible chapter.
- `chapter: number` — the one-based chapter number (typically `index + 1`, or the `ChapterData.number` field for backend mode).
- `series: string | null` — the active series, or `null` in FSA mode.
- `story: string | null` — the active story, or `null` in FSA mode.
- `mode: "fsa" | "backend"` — the current reader mode.

The hook SHALL be dispatched from exactly one canonical site per state transition to avoid duplicate dispatches. The canonical dispatch sites are: `navigateTo()`, `loadFSAChapter()`, `reloadToLast()`, the chapter-param branch of the route watcher inside `initRouteSync()`, and once during initial story load in `loadFromBackend()` / `loadFromFSA()` after `story:switch` has fired.

The hook SHALL NOT fire when the new index equals the current index (no-op navigation).

Handler return values SHALL be ignored (informational stage).

#### Scenario: Navigate next in backend mode
- **WHEN** `next()` is called while `currentIndex === 2` in backend mode for `series/story`
- **THEN** the hook SHALL dispatch with `previousIndex: 2, index: 3, chapter: 3 or matching ChapterData.number, series, story, mode: "backend"`

#### Scenario: Initial load after story:switch
- **WHEN** `loadFromBackend("s", "st")` has just dispatched `story:switch` and committed the initial chapter index
- **THEN** the hook SHALL dispatch exactly once with `previousIndex: null` and the initial `index`

#### Scenario: No-op navigation does not fire
- **WHEN** a route watcher triggers with a chapter param equal to the current `currentIndex + 1`
- **THEN** the `chapter:change` hook SHALL NOT be dispatched

#### Scenario: FSA mode dispatch
- **WHEN** `loadFSAChapter(1)` is called from index 0 in FSA mode
- **THEN** the hook SHALL dispatch with `series: null, story: null, mode: "fsa", previousIndex: 0, index: 1, chapter: 2`

### Requirement: TypeScript type extensions for new frontend hook stages

The frontend TypeScript types in `reader-src/src/types/index.ts` and `reader-src/src/lib/plugin-hooks.ts` SHALL be extended to support the new stages:
- `HookStage` SHALL include `"chat:send:before" | "chapter:render:after" | "story:switch" | "chapter:change"` as additional union members.
- `ContextMap` in `plugin-hooks.ts` SHALL map each new stage to its corresponding context interface (`ChatSendBeforeContext`, `ChapterRenderAfterContext`, `StorySwitchContext`, `ChapterChangeContext`).
- `VALID_STAGES` SHALL include the four new stage names so `register()` does not warn when plugins subscribe to them.
- The handler type for `chat:send:before` SHALL permit returning `string | void` to express the pipeline contract; other stages SHALL continue to use the existing `HookHandler<T>` returning `void`.

#### Scenario: Plugin registers handler for new stage without warning
- **WHEN** a plugin calls `hooks.register("chapter:change", handler)` during `initPlugins()`
- **THEN** `FrontendHookDispatcher.register()` SHALL NOT emit the "Invalid frontend hook stage" warning, and the handler SHALL be added to the dispatcher

#### Scenario: Type checker accepts chat:send:before return value
- **WHEN** a TypeScript plugin declares `register(hooks) { hooks.register("chat:send:before", (ctx) => "new message"); }`
- **THEN** the project SHALL type-check successfully under the existing `strict` compiler settings
