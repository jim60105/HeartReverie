# Plugin Hooks

## Purpose

Hook system architecture that allows plugins to subscribe to ordered lifecycle stages, enabling extensible prompt assembly, response processing, and frontend rendering.

## Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked during streaming — plugins can observe or transform stream chunks as they arrive from OpenRouter
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state-patches status update)
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
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

#### Scenario: Strip-tags stage invocation
- **WHEN** the server strips tags from chapter content before including it in `previous_context`
- **THEN** the hook system SHALL invoke all `strip-tags` handlers to collect tag names that should be stripped, in addition to the default tags

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

### Requirement: Handler execution

For each hook stage invocation, the hook system SHALL execute all registered handlers in priority order. `prompt-assembly` handlers SHALL receive a mutable context object containing `templateVariables` and `promptFragments`, and MAY modify these to contribute prompt content or adjust template data. `response-stream` handlers SHALL receive the current chunk and MAY return a transformed chunk. `post-response` handlers SHALL receive the completed response content and story metadata for side effects. `frontend-render` handlers SHALL receive a registration API to declare tag extractors and renderers. `strip-tags` handlers SHALL receive a registration API to declare tag names for server-side stripping.

#### Scenario: Prompt-assembly handler contributes a prompt fragment
- **WHEN** a `prompt-assembly` handler pushes a string into `context.promptFragments`
- **THEN** the prompt assembly pipeline SHALL include that string in the final system prompt

#### Scenario: Prompt-assembly handler modifies template variables
- **WHEN** a `prompt-assembly` handler sets `context.templateVariables.customVar = 'value'`
- **THEN** the Vento template SHALL have access to `customVar` during rendering

#### Scenario: Post-response handler runs side effect
- **WHEN** a `post-response` handler executes the `state-patches` binary
- **THEN** the side effect SHALL complete before the server sends the HTTP response to the client

#### Scenario: Frontend-render handler registers tag extractor
- **WHEN** a `frontend-render` handler registers an extractor for the `<options>` tag
- **THEN** the `md-renderer` SHALL use that extractor to extract and render `<options>` content from chapter markdown

#### Scenario: Strip-tags handler adds custom tag for stripping
- **WHEN** a `strip-tags` handler registers the tag name `imgthink`
- **THEN** the server SHALL strip `<imgthink>...</imgthink>` from chapter content when building `previous_context`

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
