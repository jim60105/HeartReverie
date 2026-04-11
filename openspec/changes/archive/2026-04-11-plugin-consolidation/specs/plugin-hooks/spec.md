# Plugin Hooks — Delta Spec (plugin-consolidation)

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Hook stages

The hook system SHALL define the following ordered hook stages that plugins can subscribe to:
- `prompt-assembly`: Invoked during prompt construction — plugins can modify the `previousContext` array (e.g., replace full chapter text with summaries). The context object SHALL include a mutable `previousContext` (array of strings) field, a `rawChapters` (array of strings containing unstripped chapter content) field, `storyDir` (string), `series` (string), and `name` (string).
- `response-stream`: Invoked during streaming — plugins can observe or transform stream chunks as they arrive from OpenRouter
- `pre-write`: Invoked after OpenRouter response is confirmed but before chapter file writing — plugins can inject content to prepend to the chapter file (e.g., user message wrappers)
- `post-response`: Invoked after the response stream completes — plugins can run side effects (e.g., apply-patches status update)
- `frontend-render`: Invoked during frontend rendering — plugins register tag extractors and custom renderers for LLM output tags
- `frontend-strip`: Invoked during frontend rendering — plugins register tag names to strip from rendered output
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

#### Scenario: Frontend-strip stage invocation
- **WHEN** the frontend `md-renderer` processes chapter content for display
- **THEN** the hook system SHALL invoke all `frontend-strip` handlers to collect tag names that should be stripped from the rendered output

#### Scenario: Strip-tags stage invocation
- **WHEN** the server strips tags from chapter content before including it in `previous_context`
- **THEN** the hook system SHALL invoke all `strip-tags` handlers to collect tag names that should be stripped, in addition to the default tags
