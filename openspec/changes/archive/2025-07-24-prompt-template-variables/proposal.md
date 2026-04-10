## Why

The writer-backend currently hardcodes prompt construction logic (wrapping chapters in `<previous_context>`, user input in `<inputs>`, status in `<status_current_variable>`, and conditionally prepending `<start_hints>`) directly in JavaScript. The `after_user_message.md` is loaded as a separate system message appended after the user message. This design scatters prompt structure across code and multiple template files, making it difficult for prompt engineers to iterate on the full prompt layout without modifying server code. By exposing these elements as Vento template variables and consolidating the prompt into a single system template, the entire prompt structure becomes editable through template files alone.

## What Changes

- Pass `previous_context` (array of stripped chapter contents), `user_input` (the raw user message), `status` (the status file content), and `isFirstRound` (boolean) as Vento template variables alongside the existing `scenario` variable when rendering the system prompt.
- Remove the hardcoded `<previous_context>`, `<inputs>`, `<start_hints>`, and `<status_current_variable>` tag wrapping from server.js; the template will handle all prompt structure.
- Move `after_user_message.md` content into the end of `system.md` template, eliminating the separate system message.
- Add an `isFirstRound` boolean variable so the template can conditionally render `<start_hints>` content using Vento's `{{ if }}` syntax.
- **BREAKING**: The messages array structure changes from multiple system/assistant/user messages to a simplified structure where the system prompt template controls the full prompt layout.
- Create documentation under `docs/` in Traditional Chinese (正體中文) explaining the Vento template design, available variables, and the new LLM messages array construction.

## Capabilities

### New Capabilities
- `vento-template-docs`: Documentation under `docs/` explaining the Vento template system, available variables, and the prompt construction pipeline design (written in 正體中文).
- `vento-prompt-template`: Specification for the Vento template system used in prompt construction, defining available template variables (`scenario`, `previous_context`, `user_input`, `status`, `isFirstRound`), their types, and how the template handles prompt structure (tag wrapping, conditional rendering, iteration).

### Modified Capabilities
- `writer-backend`: The prompt construction pipeline changes from hardcoded JavaScript message assembly to Vento template-driven prompt rendering with new template variables (`previous_context`, `user_input`, `status`, `isFirstRound`). The messages array structure simplifies as the system template consolidates all prompt content.

## Impact

- **Code**: `writer/server.js` — the `renderSystemPrompt()` function signature expands to accept additional variables; the chat endpoint prompt construction logic simplifies significantly; the `after_user_message.md` file loading is removed from the chat handler.
- **Templates**: `playground/prompts/system.md` — gains new Vento variable usage for `previous_context`, `user_input`, `status`, `isFirstRound`, and absorbs `after_user_message.md` content. `playground/prompts/after_user_message.md` — content moves into `system.md` (file may be removed or kept empty).
- **New files**: `docs/` directory with Vento template documentation in Traditional Chinese.
- **APIs**: No REST API changes. The `/api/stories/:series/:name/chat` endpoint behavior is unchanged from the client's perspective.
- **Dependencies**: No new dependencies. Continues using `ventojs`.
