# Tasks: Prompt Template Variables

## 1. Expand `renderSystemPrompt()` signature

- [x] 1.1 Update `renderSystemPrompt()` in `writer/server.js` to accept a second parameter object `{ previousContext, userInput, status, isFirstRound }` alongside the existing `series` parameter
- [x] 1.2 Pass all variables to the Vento `runString()` call as `{ scenario, previous_context, user_input, status_data, isFirstRound }`
- [x] 1.3 Verify the function still works with existing callers (the chat endpoint) by confirming no runtime errors on startup

## 2. Merge `after_user_message.md` into `system.md`

- [x] 2.1 Copy the content of `playground/prompts/after_user_message.md` (including its `set`/`include` directives for sub-templates like `Threshold-Lord_end.md`, `status.md`, `options.md`) and append it to the end of `playground/prompts/system.md`
- [x] 2.2 Add Vento `{{ for chapter of previous_context }}` loop to render each chapter wrapped in `<previous_context>` tags
- [x] 2.3 Add Vento conditional `{{ if isFirstRound }}` block with the `<start_hints>` content (move the `START_HINTS` text from `server.js` into the template)
- [x] 2.4 Add `{{ status }}` rendering wrapped in `<status_current_variable>` tags
- [x] 2.5 Add `{{ user_input }}` rendering wrapped in `<inputs>` tags
- [x] 2.6 Verify all existing sub-template `{{ include }}` directives are preserved and ordered correctly

## 3. Simplify the chat endpoint in `server.js`

- [x] 3.1 Remove the `after_user_message.md` file loading logic from the chat endpoint
- [x] 3.2 Remove the `START_HINTS` constant definition from `server.js`
- [x] 3.3 Remove the hardcoded `userContent` string construction (the `<inputs>`, `<start_hints>` XML wrapping logic)
- [x] 3.4 Update the chat endpoint to call `renderSystemPrompt()` with all new variables (`previousContext`, `userInput`, `status`, `isFirstRound`)
- [x] 3.5 Simplify the messages array to exactly `[{ role: "system", content: renderedSystemPrompt }, { role: "user", content: message }]`
- [x] 3.6 Confirm `stripPromptTags()` is still applied per-chapter when building the `previous_context` array

## 4. Remove `after_user_message.md`

- [x] 4.1 Delete `playground/prompts/after_user_message.md` now that its content is merged into `system.md`
- [x] 4.2 Verify no remaining references to `after_user_message.md` exist in `server.js` or other files

## 5. End-to-end verification

- [x] 5.1 Start the server and confirm it launches without errors
- [x] 5.2 Verify that a first-round chat request (no existing chapters) produces a system prompt containing `<start_hints>` content and an empty `previous_context` renders correctly
- [x] 5.3 Verify that a subsequent-round chat request (with existing chapters) produces a system prompt with `<previous_context>` wrapped chapters and no `<start_hints>` block
- [x] 5.4 Confirm the REST API contract (`POST /api/stories/:series/:name/chat`) request/response shape is unchanged

## 6. Create documentation

- [x] 6.1 Create `docs/prompt-template.md` in Traditional Chinese (正體中文) explaining the Vento template engine and its integration in this project
- [x] 6.2 Document all available template variables with types: `scenario` (string), `previous_context` (array of strings), `user_input` (string), `status` (string), `isFirstRound` (boolean)
- [x] 6.3 Include Vento syntax examples: variable interpolation `{{ variable }}`, array iteration `{{ for ... }}`, and conditional rendering `{{ if ... }}`
- [x] 6.4 Describe the prompt construction pipeline: how `server.js` prepares data → renders the `system.md` template → constructs the `[system, user]` messages array → sends to the LLM
