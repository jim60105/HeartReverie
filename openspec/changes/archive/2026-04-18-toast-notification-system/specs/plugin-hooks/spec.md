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
