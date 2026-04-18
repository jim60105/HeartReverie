# Plugin Hooks

## Purpose

Hook system architecture that allows plugins to subscribe to ordered lifecycle stages, enabling extensible prompt assembly, response processing, and frontend rendering.

## Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked during streaming — plugins can observe or transform stream chunks as they arrive from OpenRouter
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state status update)
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
- `notification`: Invoked when a WebSocket event or frontend action triggers a notification opportunity — plugins can call the notification composable to emit notifications to the user
- `strip-tags`: Invoked during server-side chapter content stripping — plugins register tag names to strip from `previous_context` before prompt assembly

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

For each hook stage invocation, the hook system SHALL execute all registered handlers in priority order. `prompt-assembly` handlers SHALL receive a mutable context object containing `templateVariables` and `promptFragments`, and MAY modify these to contribute prompt content or adjust template data. `response-stream` handlers SHALL receive the current chunk and MAY return a transformed chunk. `post-response` handlers SHALL receive the completed response content and story metadata for side effects. `strip-tags` handlers SHALL receive a registration API to declare tag names for server-side stripping.

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

The `response-stream` and `strip-tags` hook stages are defined in `VALID_STAGES` but are not currently dispatched anywhere in the codebase. Documentation SHALL note these stages exist for future use but are not yet active.

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
