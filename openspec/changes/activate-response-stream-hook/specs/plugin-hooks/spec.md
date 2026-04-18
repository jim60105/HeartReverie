## ADDED Requirements

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

### Requirement: Undispatched hook stages documentation

The `strip-tags` hook stage is defined in `VALID_STAGES` but is not currently dispatched anywhere in the codebase. Documentation SHALL note this stage exists for future use but is not yet active. The `response-stream` stage is now dispatched (see the Response-stream hook dispatch point requirement) and SHALL NOT appear in any list of dormant/undispatched stages.

#### Scenario: Documentation lists only strip-tags as dormant
- **WHEN** a reader consults the plugin-hooks specification or `docs/plugin-system.md` for a list of hook stages that exist but are not dispatched
- **THEN** the list SHALL contain only `strip-tags` and SHALL NOT contain `response-stream`
