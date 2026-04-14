# Delta Spec: plugin-hooks

## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked during streaming — plugins can observe or transform stream chunks as they arrive from OpenRouter
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., state status update)
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
