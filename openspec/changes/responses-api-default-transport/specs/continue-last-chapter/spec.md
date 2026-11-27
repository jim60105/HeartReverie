# Spec Delta

## MODIFIED Requirements

### Requirement: Prompt construction parses chapter n into user turn + assistant prefill

The upstream chat/completions request body produced by `executeContinue()` SHALL contain a `messages` array structured as follows:

1. Entries 0..k−1 are the messages produced by `renderSystemPrompt()` invoked with `userInput: userMessageText` (where `userMessageText` is the content of the first `<user_message>…</user_message>` block extracted from chapter n's freshly-read on-disk bytes — see Requirement: Continue endpoint, step 4). The render uses the same Vento `system.md` template, the same `previous_context` array (chapters 1..n−1 stripped via `stripPromptTags()`), and the same plugin `prompt-assembly` hook dispatch as `executeChat()`. When `userMessageText === ""` the rendered trailing user turn carries empty content, exactly as it would on the first-round case where no user input has been typed.
2. Entry k (the last entry) SHALL be `{ role: "assistant", content: assistantPrefill }` **only when `assistantPrefill.trim() !== ""`**. When `assistantPrefill` is empty, no trailing assistant message is appended — the request ends with whatever `system.md` rendered (so the upstream sees a normal user-driven request equivalent to `chat:send`, not a malformed empty assistant message). When non-empty, `assistantPrefill` is chapter n's bytes with the first `<user_message>…</user_message>` block removed and then run through `stripPromptTags()`. The terminal `assistant` role SHALL signal to OpenAI-compatible providers that they should *continue* that content rather than restart, per OpenRouter's prefix-completion documentation.

Splitting chapter n at the `<user_message>` boundary — rather than treating the whole chapter as one assistant prefill — ensures that user edits to either part are honoured: edits to `<user_message>` change the user turn; edits to the prose tail change the assistant prefill. Re-reading chapter n from disk on every Continue call (Requirement: Continue endpoint, step 3) is what makes those edits visible.

The Vento system prompt template (`system.md`) SHALL NOT be modified for this requirement; the trailing assistant prefill is appended to the rendered message array *after* `renderSystemPrompt()` returns.

If the rendered prompt happens to already end with an assistant message (e.g. a future template variant), `executeContinue()` SHALL still append the chapter-n prefill as a separate trailing assistant message. The upstream provider SHALL receive two consecutive assistant messages with no intervening user message; this is documented OpenAI-compatible behaviour and most providers concatenate consecutive same-role messages internally.

The provider-dependence of trailing-assistant prefill is a known limitation: OpenRouter (the project's default `LLM_API_BASE_URL`) and Anthropic-via-OpenRouter passthrough document the behaviour and treat it reliably; strict OpenAI (`api.openai.com/v1/chat/completions`) does not officially document prefill via trailing assistant message and may insert a leading newline or behave inconsistently with some models. Operators swapping `LLM_API_BASE_URL` to a strict provider accept this limitation; this capability SHALL NOT add a `prefill: true` / `continue_final_message: true` request flag because no supported provider requires one.

#### Scenario: Trailing assistant prefill present only when non-empty

- **WHEN** `executeContinue()` builds the request body and `assistantPrefill.trim() !== ""`
- **THEN** the JSON `messages` array's last element SHALL satisfy `messages[messages.length - 1].role === "assistant"` AND `messages[messages.length - 1].content === assistantPrefill`
- **WHEN** `assistantPrefill.trim() === ""` (e.g. chapter n contains only a `<user_message>` block with no prose)
- **THEN** the request body SHALL NOT contain a trailing assistant message — the rendered `system.md` output is sent as-is — AND the last user-role message SHALL carry `userMessageText`

#### Scenario: Edited `<user_message>` is the last user-role message

- **GIVEN** chapter `005.md` was originally written by a `chat:send` carrying the user message `"探索藥妝店"`, and the user has since manually edited the file to change the `<user_message>` block to `"探索便利商店"` (the prose tail is unchanged)
- **WHEN** the client clicks Continue
- **THEN** `executeContinue()` SHALL re-read `005.md` from disk, parse the edited `<user_message>` content `"探索便利商店"`, render the upstream prompt with `userInput: "探索便利商店"`, AND the **last `role === "user"` message** in the upstream `messages` SHALL contain `"探索便利商店"` (not the original `"探索藥妝店"`). NOTE: this scenario asserts on the last user-role message rather than `messages[messages.length - 2]`, because `system.md` is free to emit additional assistant messages after the user turn (e.g. a `threshold_lord_end` cue) before the prefill is appended.

#### Scenario: User-edited prose tail is honoured in the prefill

- **GIVEN** chapter `005.md` originally contained `<user_message>探索藥妝店</user_message>\n\n他走進店裡，看見店員。` and the user has since manually edited the prose tail to `<user_message>探索藥妝店</user_message>\n\n他走進店裡，看見一個小女孩。`
- **WHEN** the client clicks Continue
- **THEN** `executeContinue()` SHALL re-read `005.md` from disk, parse the edited prose, AND the trailing assistant message in the upstream `messages` SHALL satisfy `content === stripPromptTags("他走進店裡，看見一個小女孩。")` (post-edit; not the pre-edit value)

#### Scenario: Latest chapter is re-read from disk on every Continue invocation

- **GIVEN** two consecutive Continue invocations on the same chapter, with the chapter file mutated on disk between them
- **WHEN** the second invocation runs
- **THEN** the second invocation's prompt SHALL reflect the post-mutation bytes, AND the implementation SHALL have called `Deno.readTextFile(chapterPath)` (or an equivalent live-read API) at the start of the second invocation rather than reusing bytes loaded for the first

#### Scenario: System template is unchanged

- **GIVEN** the project's `system.md` Vento template at the time of this change
- **WHEN** `executeContinue()` runs
- **THEN** the function SHALL invoke the same `renderSystemPrompt()` entry point as `executeChat()` with `userInput: userMessageText` and `isFirstRound = (filteredContext.length === 0)` (so single-chapter continues match the first-round semantics of `executeChat()`), AND SHALL NOT pass any `templateOverride` that mentions a continue-specific branch

#### Scenario: Stripping rules for prior chapters match `executeChat`

- **GIVEN** chapters 1..n−1 each contain a leading `<user_message>…</user_message>` block, plugin tags (e.g. `<state>…</state>`), and prose
- **WHEN** `executeContinue()` builds `previous_context`
- **THEN** entries for chapters 1..n−1 SHALL be the result of running `stripPromptTags()` on each chapter's raw bytes — i.e. the same stripping policy `executeChat()` uses today (only chapter n is handled differently, by the parse-and-route path described above)
