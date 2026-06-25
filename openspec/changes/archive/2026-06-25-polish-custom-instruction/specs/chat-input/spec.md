## ADDED Requirements

### Requirement: Shared chat-input composable owns the textarea state

The reader frontend SHALL own the chat textarea's text in a shared composable `useChatInput()` (`reader-src/src/composables/useChatInput.ts`) that exposes a single module-scoped reactive `inputText` ref as the source of truth. `ChatInput.vue` SHALL bind its textarea `v-model` to this shared `inputText` (instead of a component-local `ref`) and SHALL delegate its story-scoped `sessionStorage` persistence and its `appendText(text)` logic to the composable. The composable SHALL preserve all pre-existing chat-input behaviour: story-scoped sessionStorage key `"heartreverie:chat-input:<series>:<story>"`, restore-on-mount seeding, persist-before-send/resend, and the `appendText` newline-prepend rule. The shared `inputText` SHALL be readable by other reader code (e.g. the plugin action bar) so that the **currently-typed** value — including text typed but not yet sent — is observable without going through the stale sessionStorage value.

Because the ref is module-scoped (singleton) and survives story switches, the composable SHALL be **story-aware**: it SHALL track the active `<series>:<story>` key and SHALL provide a `syncToStory(series, story)` operation that re-seeds `inputText` from the story-scoped sessionStorage value (empty string when absent) whenever the active key changes. The composable SHALL re-seed at the composable layer — via a watch on the active backend story context — so that the shared `inputText` reflects the active story even before/independent of any `ChatInput` (re)mount. Any reader of the shared value that runs outside `ChatInput` (e.g. the action-bar accessor) SHALL ensure it observes the active story's value (e.g. by invoking `syncToStory(...)` with the active story before reading), so a value belonging to a previously-active story SHALL NOT be observable after the active story has changed.

The singleton is a deliberate single-instance design: if more than one `ChatInput` were ever mounted concurrently they would intentionally share the same `inputText`. This constraint SHALL be documented.

#### Scenario: ChatInput binds to the shared composable ref

- **WHEN** the user types `"讓氣氛更陰鬱"` into the chat textarea
- **THEN** `useChatInput().inputText.value` SHALL equal `"讓氣氛更陰鬱"` synchronously after the input event, with no send/resend required

#### Scenario: Live unsent text is observable by other consumers

- **WHEN** the user types text into the chat textarea but does NOT click send or resend
- **THEN** a separate consumer reading `useChatInput().inputText.value` SHALL observe the freshly-typed text, NOT the previously-persisted sessionStorage value

#### Scenario: appendText still works through the composable

- **WHEN** the chat textarea contains `"先回家"` and `appendText("走向藥妝店")` is invoked (via the component's exposed method or the composable)
- **THEN** `useChatInput().inputText.value` SHALL become `"先回家\n走向藥妝店"` and the textarea SHALL reflect the same value

#### Scenario: Per-story isolation preserved

- **WHEN** the user types and sends `"hello"` in story A, then the `ChatInput.vue` instance remounts for story B (story-scoped `:key` change) whose sessionStorage key holds no value
- **THEN** `useChatInput().inputText.value` SHALL be re-seeded to the empty string for story B and the textarea SHALL NOT display `"hello"`

#### Scenario: Unsent text does not leak across a story switch

- **WHEN** the user types `"讓氣氛更陰鬱"` into the chat textarea for story A WITHOUT sending, then the active story switches to story B (whose sessionStorage key holds no value)
- **THEN** after the switch both the textarea AND any external reader of the shared value (e.g. `getChatInputText()`) SHALL observe story B's value (the empty string), and SHALL NOT observe story A's unsent `"讓氣氛更陰鬱"`

#### Scenario: Restored multi-line draft re-fits the textarea after a story-driven reseed

- **WHEN** the active story switches to a story whose sessionStorage key holds a multi-line draft
- **THEN** after the composable reseeds `inputText`, the textarea SHALL recompute its height so the full draft is visible (at least the three-line floor), matching the pre-refactor restore-on-mount behaviour

#### Scenario: sessionStorage persistence unchanged on send

- **WHEN** the user clicks send with a non-empty message
- **THEN** the composable SHALL write the current `inputText` to `sessionStorage.setItem("heartreverie:chat-input:<series>:<story>", text)` before the `send` event is emitted, exactly as the component did previously
