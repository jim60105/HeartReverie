# Plugin Hooks

## Purpose

Hook system architecture that allows plugins to subscribe to ordered lifecycle stages, enabling extensible prompt assembly, response processing, and frontend rendering.
## Requirements
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

### Requirement: Notification hook context

The `notification` frontend hook stage SHALL pass a context object with the following shape:
- `event: string` — the WebSocket event type that triggered the notification opportunity (e.g., `'chat:done'`, `'chat:error'`)
- `data: Record<string, unknown>` — the event payload data
- `notify: (options: NotifyOptions) => string` — the notification composable's `notify` function for emitting notifications

Handlers SHALL call `context.notify()` to emit notifications. The hook dispatcher SHALL NOT emit any notification by itself — it only provides the opportunity and the API.

**Dispatch ownership**: Core application code (e.g., `useChatApi.ts`) SHALL be responsible for dispatching the `notification` hook via `frontendHooks.dispatch('notification', ctx)` when relevant events occur (both WebSocket `chat:done`/`chat:error` and HTTP fallback completion). Plugins SHALL only `register('notification', handler)` and call `ctx.notify(...)` — they do NOT dispatch the hook themselves.

#### Scenario: Plugin receives notify function in context
- **WHEN** a `notification` hook handler is invoked
- **THEN** the context SHALL contain a callable `notify` function with the same signature as `useNotification().notify`

#### Scenario: Multiple plugins can emit different notifications
- **WHEN** two plugins both have `notification` handlers for the same event
- **THEN** each plugin can independently call `context.notify()` with different options, resulting in multiple notifications

#### Scenario: Notification dispatched on HTTP fallback completion
- **WHEN** a chat request completes via the HTTP fallback path (not WebSocket)
- **THEN** the core code SHALL dispatch the `notification` hook with `event: 'chat:done'` and relevant data, identical to the WebSocket path

### Requirement: Pre-write hook stage

The hook system SHALL define a `pre-write` hook stage that is dispatched after the OpenRouter API response is confirmed valid but before any content is written to the chapter file. The `pre-write` context object SHALL include:
- `message` (string): the raw user input
- `chapterPath` (string): the target chapter file path
- `storyDir` (string): the story directory path
- `series` (string): the series name
- `name` (string): the story name
- `preContent` (string): initially empty, handlers MAY append to this field

After all `pre-write` handlers have executed, the server SHALL write `context.preContent` to the chapter file before streaming AI response content. If no handlers modify `preContent`, the server SHALL write nothing before the AI content.

#### Scenario: Pre-write stage dispatched before file writing
- **WHEN** the OpenRouter API returns a valid streaming response and the chapter file is opened for writing
- **THEN** the server SHALL dispatch the `pre-write` hook stage with the context object before writing any content to the file

#### Scenario: Pre-write handler sets preContent
- **WHEN** a `pre-write` handler sets `context.preContent` to a non-empty string
- **THEN** the server SHALL write that string to the chapter file before streaming AI content

#### Scenario: No pre-write handlers registered
- **WHEN** no plugin has registered a `pre-write` handler
- **THEN** `context.preContent` SHALL remain empty and the server SHALL write only AI response content to the chapter file

#### Scenario: Multiple pre-write handlers append content
- **WHEN** two `pre-write` handlers both append to `context.preContent` (handler A at priority 50, handler B at priority 100)
- **THEN** handler A's content SHALL appear before handler B's content in the final `preContent` string

### Requirement: Priority ordering

Each hook handler SHALL have a numeric `priority` value. Handlers with lower priority numbers SHALL execute before handlers with higher priority numbers. The default priority SHALL be `100` when not explicitly specified. When two handlers have the same priority, they SHALL execute in the order they were registered.

#### Scenario: Handlers execute in priority order
- **WHEN** three handlers are registered for `prompt-assembly` with priorities 50, 100, and 200
- **THEN** the handler with priority 50 SHALL execute first, followed by 100, then 200

#### Scenario: Default priority assignment
- **WHEN** a handler is registered without specifying a priority
- **THEN** the handler SHALL be assigned a default priority of `100`

#### Scenario: Same priority maintains registration order
- **WHEN** two handlers are registered for `post-response` both with priority 100, where handler A is registered before handler B
- **THEN** handler A SHALL execute before handler B

### Requirement: Handler registration

Plugins SHALL register hook handlers via `hooks.on(stage, handler, priority?)` where `stage` is a valid hook stage name, `handler` is an async function, and `priority` is an optional numeric value defaulting to `100`. The `hooks.on()` method SHALL validate that the stage name is one of the defined hook stages and SHALL reject unknown stage names with a logged error.

#### Scenario: Register a handler with explicit priority
- **WHEN** a plugin calls `hooks.on('prompt-assembly', myHandler, 50)`
- **THEN** the hook system SHALL register `myHandler` for the `prompt-assembly` stage with priority 50

#### Scenario: Register a handler with default priority
- **WHEN** a plugin calls `hooks.on('post-response', myHandler)`
- **THEN** the hook system SHALL register `myHandler` for the `post-response` stage with the default priority of 100

#### Scenario: Register handler for invalid stage
- **WHEN** a plugin calls `hooks.on('invalid-stage', myHandler)`
- **THEN** the hook system SHALL log an error identifying the plugin and the invalid stage name, and SHALL NOT register the handler

#### Scenario: Handler is an async function
- **WHEN** a plugin registers a handler that returns a Promise
- **THEN** the hook system SHALL await the handler's completion before proceeding to the next handler in the stage

The frontend `FrontendHookDispatcher` SHALL use `hooks.register(stage, handler, priority?)` where `stage` is a valid frontend hook stage name, `handler` is a synchronous function, and `priority` is an optional numeric value defaulting to `100`. The `FrontendHookDispatcher` supports the `frontend-render` and `notification` stages; `register()` SHALL validate that the stage name is one of these and SHALL log a warning and skip registration for unknown stage names. The `FrontendHookDispatcher` class SHALL be preserved as a TypeScript class (NOT converted to a Vue composable) for backward compatibility with existing plugin `frontend.js` modules that call `register(frontendHooks)`. The class API (`register`, `dispatch`) SHALL remain identical in signature and behavior.

#### Scenario: Frontend register a handler with explicit priority
- **WHEN** a plugin calls `hooks.register('frontend-render', myHandler, 50)`
- **THEN** the hook system SHALL register `myHandler` for the `frontend-render` stage with priority 50

#### Scenario: Frontend register a handler with default priority
- **WHEN** a plugin calls `hooks.register('frontend-render', myHandler)`
- **THEN** the hook system SHALL register `myHandler` for the `frontend-render` stage with the default priority of 100

#### Scenario: Frontend register handler for invalid stage
- **WHEN** a plugin calls `hooks.register('invalid-stage', myHandler)`
- **THEN** the hook system SHALL log a warning identifying the invalid stage name and SHALL NOT register the handler

#### Scenario: Handler is called synchronously
- **WHEN** `dispatch('frontend-render', context)` invokes registered handlers
- **THEN** each handler SHALL be called synchronously in priority order; handlers are NOT awaited

#### Scenario: Existing plugin frontend.js modules remain compatible
- **WHEN** an existing plugin's `frontend.js` module calls `register(frontendHooks)` where `frontendHooks` is a `FrontendHookDispatcher` instance
- **THEN** the call SHALL succeed with the same API surface as the vanilla JS implementation, because the class is preserved as-is (not converted to a composable)

### Requirement: Plugin registration interface

The plugin backend module registration function SHALL accept a `PluginRegisterContext` object instead of a bare `HookDispatcher`. The context object SHALL contain `hooks` (a `PluginHooks` wrapper that auto-binds plugin name and baseLogger) and `logger` (a `Logger` instance scoped to the plugin name). The plugin manager SHALL construct this context object when loading each backend module.

#### Scenario: Backend module receives context object
- **WHEN** the plugin manager loads a backend module that exports a `register` function
- **THEN** it SHALL call `register(context)` where `context` is `{ hooks: PluginHooks, logger: Logger }` instead of calling `register(hookDispatcher)` directly

#### Scenario: Plugin accesses hook dispatcher from context
- **WHEN** a plugin's `register(context)` function needs to register hooks
- **THEN** it SHALL use `context.hooks.register(stage, handler, priority)` to register handlers (plugin name and baseLogger are auto-bound)

#### Scenario: Plugin accesses logger from context
- **WHEN** a plugin's `register(context)` function needs to log information
- **THEN** it SHALL use `context.logger.info(message, data)` (or debug/warn/error) to emit structured log entries

### Requirement: Handler execution

For each hook stage invocation, the hook system SHALL execute all registered handlers in priority order. `prompt-assembly` handlers SHALL receive a mutable context object containing `templateVariables` and `promptFragments`, and MAY modify these to contribute prompt content or adjust template data. `response-stream` handlers SHALL receive a mutable context object containing `chunk` (string) and SHALL transform the chunk by assigning a new value to `context.chunk` (handler return values are ignored, consistent with all other backend stages); assigning `""` drops the chunk. `post-response` handlers SHALL receive the completed response content and story metadata for side effects. `strip-tags` handlers SHALL receive a registration API to declare tag names for server-side stripping.

For each `dispatch(stage, context)` invocation, the `FrontendHookDispatcher` SHALL execute all registered `frontend-render` handlers synchronously in priority order. `frontend-render` handlers SHALL receive a mutable context object with the following exact shape:
- `context.text` (`string`, mutable) — the raw markdown text being processed; handlers replace extracted blocks with placeholder comments and write the modified text back to this property
- `context.placeholderMap` (`Map<string, string>`, mutable) — a map from placeholder comment strings (e.g., `<!--STATUS_BLOCK_0-->`) to rendered HTML strings; handlers add entries to this map for each extracted block
- `context.options` (`object`) — rendering options passed from the caller (e.g., `{ isLastChapter: boolean }`)

Handlers mutate `context.text` and `context.placeholderMap` directly — the dispatcher does NOT create copies or merge return values. If a handler throws, the error SHALL be caught and logged, and execution SHALL continue with the next handler. The `dispatch()` method SHALL return the context object. All handler signatures and context object shapes SHALL have TypeScript type definitions.

#### Scenario: Prompt-assembly handler contributes a prompt fragment
- **WHEN** a `prompt-assembly` handler pushes a string into `context.promptFragments`
- **THEN** the prompt assembly pipeline SHALL include that string in the final system prompt

#### Scenario: Prompt-assembly handler modifies template variables
- **WHEN** a `prompt-assembly` handler sets `context.templateVariables.customVar = 'value'`
- **THEN** the Vento template SHALL have access to `customVar` during rendering

#### Scenario: Response-stream handler transforms via context mutation
- **WHEN** a `response-stream` handler assigns a new string to `context.chunk`
- **THEN** that new value SHALL be what is written to the chapter file, accumulated into the full response, and emitted to the `onDelta` callback

#### Scenario: Post-response handler runs side effect
- **WHEN** a `post-response` handler executes the `state-patches` binary
- **THEN** the side effect SHALL complete before the server sends the HTTP response to the client

#### Scenario: Frontend-render handler extracts and renders a tag
- **WHEN** a `frontend-render` handler (e.g., the `options` plugin at priority 50) is invoked with a context containing `<options>` blocks in `context.text`
- **THEN** the handler SHALL replace each `<options>` block in `context.text` with a placeholder comment and add a corresponding `placeholder → renderedHTML` entry to `context.placeholderMap`

#### Scenario: Strip-tags handler adds custom tag for stripping
- **WHEN** a `strip-tags` handler registers the tag name `imgthink`
- **THEN** the server SHALL strip `<imgthink>...</imgthink>` from chapter content when building `previous_context`

#### Scenario: Frontend handler error does not halt dispatch
- **WHEN** handler A (priority 50) throws an error and handler B (priority 100) is also registered for `frontend-render`
- **THEN** the dispatcher SHALL log the error from handler A and proceed to execute handler B

### Requirement: Error isolation

If a hook handler throws an error during execution, the hook system SHALL catch the error, log it with the plugin name, hook stage, and error details, and continue executing the remaining handlers for that stage. A single handler failure SHALL NOT prevent other handlers from running or cause the overall request to fail.

#### Scenario: Handler throws and others continue
- **WHEN** handler A (priority 50) throws an error and handler B (priority 100) is also registered for the same stage
- **THEN** the hook system SHALL log the error from handler A and proceed to execute handler B normally

#### Scenario: Error log includes context
- **WHEN** a handler from plugin `my-plugin` throws an error during the `post-response` stage
- **THEN** the log entry SHALL include the plugin name `my-plugin`, the stage `post-response`, and the error message/stack trace

#### Scenario: Request completes despite handler error
- **WHEN** a `post-response` handler throws an error
- **THEN** the server SHALL still return the HTTP response with the chapter content successfully

### Requirement: Hook stage context documentation

The documentation for hook stage contexts SHALL match the actual codebase implementation:

**`prompt-assembly`** context SHALL be documented as: `{ previousContext, rawChapters, storyDir, series, name }` — where `previousContext` is a mutable string array and `rawChapters` is a string array. The previous documentation listing `{ prompt, variables }` is incorrect.

**`frontend-render`** context SHALL be documented as: `{ text, placeholderMap, options }` — where `text` is a mutable string, `placeholderMap` is a `Map<string, string>`, and `options` is `{ isLastChapter: boolean }`. The previous documentation listing `{ text, element }` is incorrect.

#### Scenario: Documentation matches code for prompt-assembly
- **WHEN** `buildPromptFromStory()` dispatches the `prompt-assembly` hook
- **THEN** the context object SHALL contain `previousContext` (string[]), `rawChapters` (string[]), `storyDir` (string), `series` (string), and `name` (string)

#### Scenario: Documentation matches code for frontend-render
- **WHEN** the frontend hook dispatcher invokes `frontend-render` handlers
- **THEN** the context object SHALL contain `text` (string), `placeholderMap` (Map<string, string>), and `options` ({ isLastChapter: boolean })

### Requirement: Undispatched hook stages documentation

The `strip-tags` hook stage is defined in `VALID_STAGES` but is not currently dispatched anywhere in the codebase. Documentation SHALL note this stage exists for future use but is not yet active. The `response-stream` stage is now dispatched (see the Response-stream hook dispatch point requirement) and SHALL NOT appear in any list of dormant/undispatched stages.

#### Scenario: Documentation lists only strip-tags as dormant
- **WHEN** a reader consults the plugin-hooks specification or `docs/plugin-system.md` for a list of hook stages that exist but are not dispatched
- **THEN** the list SHALL contain only `strip-tags` and SHALL NOT contain `response-stream`

### Requirement: TypeScript type definitions for hooks

The `FrontendHookDispatcher` class SHALL have TypeScript type definitions for all handler signatures and context shapes. A `FrontendHookHandler<T>` generic type SHALL define the handler function signature as `(context: T) => void`. A `FrontendRenderContext` interface SHALL be defined with the following properties matching the current runtime contract:
- `text: string` — the raw markdown text (mutable by handlers)
- `placeholderMap: Map<string, string>` — placeholder to rendered HTML mapping (mutable by handlers)
- `options: Record<string, unknown>` — rendering options from the caller

The interface SHALL NOT introduce new methods such as `registerExtractor` or `registerRenderer` — handlers mutate context properties directly, preserving the existing plugin contract. These types SHALL be exported so plugin authors can use them for type-safe handler implementations.

#### Scenario: Handler type definitions are available
- **WHEN** a TypeScript plugin module imports hook types from the frontend hook system
- **THEN** it SHALL have access to `FrontendHookHandler<T>`, `FrontendRenderContext`, and related interfaces for compile-time type checking

#### Scenario: FrontendRenderContext matches runtime contract
- **WHEN** an existing plugin's `frontend-render` handler mutates `context.text` and `context.placeholderMap`
- **THEN** the `FrontendRenderContext` type SHALL accept these mutations without type errors, because both properties are typed as mutable (not `readonly`)

#### Scenario: FrontendHookDispatcher typed methods
- **WHEN** the `FrontendHookDispatcher` class is used in TypeScript code
- **THEN** `register(stage, handler, priority?)` SHALL be typed to accept only valid stage names and correctly-typed handler functions, and `dispatch(stage, context)` SHALL be typed to require the correct context shape for each stage

### Requirement: Response-stream hook dispatch point

The `executeChat()` function in `writer/lib/chat-shared.ts` SHALL dispatch the `response-stream` hook stage for every non-empty content delta parsed from the LLM Server-Sent Events stream, at both the main SSE parse loop and the trailing-buffer flush after the loop terminates. The dispatch SHALL occur **before** the delta is appended to the accumulated `aiContent` string, **before** it is written to the chapter file via `file.write`, and **before** the `onDelta` callback is invoked. If `hookDispatcher.dispatch` rejects or a handler throws, the streaming loop SHALL continue processing subsequent chunks (error isolation is handled by the existing `HookDispatcher.dispatch` catch-and-log behavior).

#### Scenario: Dispatch occurs per content delta
- **WHEN** `executeChat()` parses a non-empty `choices[0].delta.content` string from an SSE `data:` line
- **THEN** it SHALL call `hookDispatcher.dispatch("response-stream", payload)` exactly once for that delta, and await the returned promise before proceeding to file write and `onDelta`

#### Scenario: Dispatch occurs for trailing-buffer delta
- **WHEN** the SSE reader signals `done` and a valid non-empty delta remains in the trailing buffer
- **THEN** that delta SHALL also be dispatched through `response-stream` with the same payload shape as loop-body deltas

#### Scenario: No handler registered — streaming unchanged
- **WHEN** `executeChat()` runs an LLM stream and no plugin has called `hooks.register("response-stream", ...)`
- **THEN** the bytes written to the chapter file, the bytes emitted to `onDelta`, and the final `aiContent` value SHALL be byte-for-byte identical to the pre-activation behavior

#### Scenario: Handler exception does not break the stream
- **WHEN** a registered `response-stream` handler throws an exception while processing a chunk
- **THEN** `executeChat()` SHALL continue reading and writing subsequent chunks, the error SHALL be logged by the dispatcher, and the current chunk SHALL be persisted using whatever value is present in `context.chunk` at the time the dispatcher returns

### Requirement: Response-stream payload shape

The `response-stream` hook context object dispatched by `executeChat()` SHALL contain the following fields:
- `correlationId` (`string`) — the per-request correlation ID used by all loggers in this chat execution
- `chunk` (`string`, mutable) — the content delta text; handlers MAY overwrite this field to transform the chunk, including setting it to the empty string `""` to drop the chunk
- `series` (`string`) — the series name under `playground/`
- `name` (`string`) — the story name under `playground/<series>/`
- `storyDir` (`string`) — the absolute path to the story directory
- `chapterPath` (`string`) — the absolute path to the chapter file being written
- `chapterNumber` (`number`) — the target chapter number (1-based)
- `logger` — injected by `HookDispatcher` (existing behavior, identical to all other stages)

A TypeScript interface `ResponseStreamPayload` SHALL be exported from `writer/types.ts` defining these fields. The interface is for plugin authors and tests; the dispatcher continues to accept the general `Record<string, unknown>` type.

#### Scenario: Payload fields are present and correct
- **WHEN** a `response-stream` handler runs
- **THEN** `context.correlationId`, `context.chunk`, `context.series`, `context.name`, `context.storyDir`, `context.chapterPath`, and `context.chapterNumber` SHALL all be defined and SHALL reflect the current chat request

#### Scenario: TypeScript type is exported
- **WHEN** a plugin module imports `ResponseStreamPayload` from `writer/types.ts`
- **THEN** the import SHALL succeed and the interface SHALL include the fields listed above

### Requirement: Response-stream chunk transformation semantics

Handlers for `response-stream` SHALL transform a chunk by assigning a new string value to `context.chunk`. After all handlers in the stage have run, `executeChat()` SHALL read `context.chunk` and use that value as the effective chunk for the chapter file, the `aiContent` accumulator, and the `onDelta` callback. Only `context.chunk` SHALL influence persistence; mutations to any other field (e.g., `chapterPath`, `chapterNumber`) SHALL be ignored for persistence purposes.

If `context.chunk` is not a `string` after dispatch (including `undefined`, `null`, deleted, or any non-string type), `executeChat()` SHALL coerce it to the empty string `""` (drop the chunk) rather than throwing. An empty string SHALL result in zero bytes being written to the file, zero bytes being appended to `aiContent`, and `onDelta` NOT being invoked for that chunk.

#### Scenario: Handler transforms the chunk
- **WHEN** a `response-stream` handler assigns `context.chunk = "[redacted]"` for a chunk whose original value is `"sensitive"`
- **THEN** `"[redacted]"` (not `"sensitive"`) SHALL be appended to `aiContent`, written to the chapter file, and passed to `onDelta`

#### Scenario: Handler drops the chunk
- **WHEN** a `response-stream` handler assigns `context.chunk = ""`
- **THEN** nothing SHALL be written to the chapter file for that chunk, `aiContent` SHALL be unchanged, and `onDelta` SHALL NOT be invoked for that chunk

#### Scenario: Multiple handlers compose by priority
- **WHEN** two `response-stream` handlers are registered, one at priority 10 that sets `context.chunk = context.chunk.toUpperCase()` and one at priority 20 that sets `context.chunk = "<" + context.chunk + ">"`
- **THEN** for an original chunk of `"hello"` the final persisted value SHALL be `"<HELLO>"` (priority-10 runs first, priority-20 sees the uppercased value)

#### Scenario: Non-string mutation is coerced to empty
- **WHEN** a handler sets `context.chunk = 42` (number) or `delete context.chunk`
- **THEN** `executeChat()` SHALL treat the chunk as empty, write nothing, and not invoke `onDelta` — no `TypeError` SHALL propagate

#### Scenario: Other field mutations do not affect persistence
- **WHEN** a handler assigns `context.chapterPath = "/tmp/elsewhere.md"` or `context.chapterNumber = 999`
- **THEN** `executeChat()` SHALL continue to write to the original `chapterPath` resolved from the request, and SHALL return the original `chapterNumber` in its result

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

### Requirement: Plugin readiness signals

The `usePlugins()` composable SHALL expose two reactive flags:

- `pluginsReady: Ref<boolean>` — flips to `true` only when `initPlugins()` completes a fully successful run (every plugin's manifest fetched, every declared `frontend.js` dynamically imported, and every `register()` resolved).
- `pluginsSettled: Ref<boolean>` — flips to `true` whenever `initPlugins()` finishes, regardless of success or failure.

Both flags SHALL start as `false`, MAY flip to `true` at most once per page lifetime, and SHALL NEVER flip back to `false`. On failure, `pluginsSettled` SHALL flip to `true` while `pluginsReady` SHALL remain `false`. Failures SHALL be surfaced to the user via a visible diagnostic (toast or equivalent notification) rather than silently swallowed.

#### Scenario: Successful initialization flips both flags
- **WHEN** `initPlugins()` runs against an `/api/plugins` response listing three plugins, all of whose `frontend.js` modules import and `register()` successfully
- **THEN** `pluginsReady.value` and `pluginsSettled.value` SHALL both flip from `false` to `true`

#### Scenario: Fetch failure flips only pluginsSettled
- **WHEN** the `/api/plugins` request fails (network error, non-2xx status, or JSON parse error)
- **THEN** `pluginsReady.value` SHALL remain `false`, `pluginsSettled.value` SHALL flip to `true`, and a user-visible failure notification SHALL be emitted

#### Scenario: Per-plugin import failure flips only pluginsSettled
- **WHEN** any plugin's dynamic `import()` or `register()` throws
- **THEN** `pluginsReady.value` SHALL remain `false`, `pluginsSettled.value` SHALL flip to `true`, and a user-visible failure notification SHALL be emitted

### Requirement: Idempotent and concurrency-safe plugin initialization

`initPlugins()` SHALL be safe to call multiple times concurrently. The composable SHALL hold a module-level in-flight initialization promise; if `initPlugins()` is invoked while a previous call is still pending, the new call SHALL await the same promise rather than starting a second initialization. Once `pluginsSettled` is `true`, subsequent calls SHALL return immediately without performing any work.

#### Scenario: Concurrent initPlugins calls share one in-flight promise
- **WHEN** two callers invoke `initPlugins()` synchronously, before the first call has resolved
- **THEN** both calls SHALL await the same in-flight promise, the `/api/plugins` endpoint SHALL be fetched at most once, and each plugin's `register()` SHALL be invoked at most once

#### Scenario: initPlugins after settled is a no-op
- **WHEN** `initPlugins()` is called a second time after `pluginsSettled.value === true`
- **THEN** the call SHALL return immediately, SHALL NOT re-fetch plugins, SHALL NOT re-import modules, and SHALL NOT re-invoke any `register()` function

### Requirement: Async register() functions are awaited

`initPlugins()` SHALL treat the return value of each plugin's `register()` function as a possible thenable: it SHALL await `Promise.resolve(register(...))` before considering that plugin's initialization complete. A plugin whose `register()` returns a `Promise` SHALL therefore be guaranteed to have completed all asynchronous setup (e.g. dynamic imports of its own dependencies, hook registrations performed inside `await`-ed code) before `pluginsReady` or `pluginsSettled` flip.

#### Scenario: Async register completes before pluginsReady flips
- **WHEN** a plugin's `register()` returns a `Promise` that resolves after a 50ms async hook registration
- **THEN** `pluginsReady.value` SHALL remain `false` until that `Promise` has resolved, even if all other plugins registered synchronously

### Requirement: Hook registry exposes handler counts

The `FrontendHookDispatcher` SHALL expose a `getHandlerCount(stage: HookStage): number` method returning the current number of registered handlers for the given stage. This API supports diagnostic instrumentation, tests asserting registration order, and future render-time gating decisions. The method SHALL be a synchronous, side-effect-free read of internal state.

#### Scenario: getHandlerCount reflects registration state
- **WHEN** two plugins each register a `frontend-render` handler and one plugin registers a `chapter:render:after` handler
- **THEN** `frontendHooks.getHandlerCount("frontend-render")` SHALL return `2` and `frontendHooks.getHandlerCount("chapter:render:after")` SHALL return `1`

### Requirement: Chapter rendering is gated on pluginsSettled

Components that mount the markdown rendering pipeline (specifically `ContentArea.vue` mounting `ChapterContent.vue`) SHALL NOT mount the chapter rendering subtree until `pluginsSettled.value === true`. The gate SHALL use `pluginsSettled` (not `pluginsReady`) so that a plugin-load failure does not permanently hide chapter content; in the failure case, the chapter SHALL render against the empty plugin handler set, matching the existing "no plugins registered" rendering contract.

#### Scenario: Chapter does not mount before pluginsSettled
- **WHEN** `currentContent.value` is non-empty but `pluginsSettled.value === false`
- **THEN** `<ChapterContent>` SHALL NOT be mounted; `ContentArea` SHALL render a loading placeholder

#### Scenario: Chapter mounts after plugins settle, including on failure
- **WHEN** `pluginsSettled` flips to `true` (regardless of `pluginsReady`'s value) and `currentContent.value` is non-empty
- **THEN** `<ChapterContent>` SHALL mount and `useMarkdownRenderer` SHALL run with the currently-registered handler set

### Requirement: Hook handler origin tracking

The frontend `FrontendHookDispatcher.register()` SHALL accept an optional `originPluginName` parameter recording which plugin owns the handler. When `usePlugins.ts` loads each plugin's `frontend.js` and invokes its `register(hooks)`, the `hooks` object passed in SHALL be a per-plugin proxy that automatically supplies `originPluginName` so plugin authors do not need to pass it manually. For all hook stages other than `action-button:click`, the recorded origin SHALL have no effect on dispatch (existing behaviour preserved). For `action-button:click`, the dispatcher SHALL filter handlers by `originPluginName === context.pluginName`.

#### Scenario: Per-plugin proxy curries origin
- **WHEN** `usePlugins.ts` imports plugin X's `frontend.js` and calls its `register(hooks)`
- **THEN** the `hooks` argument SHALL be a proxy whose `register(stage, handler, priority)` calls `FrontendHookDispatcher.register(stage, handler, priority, "X")` so the origin is recorded automatically

#### Scenario: Origin is no-op for non-action-button stages
- **WHEN** a plugin registers a `frontend-render` handler
- **THEN** the dispatcher SHALL invoke that handler for every `frontend-render` dispatch regardless of the recorded origin (no filtering)

