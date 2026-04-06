## Why

When users interact with the AI writer, their chat messages are sent to the LLM but discarded from the chapter output files. This makes it impossible to review what prompt produced a given chapter. Persisting the user message inside the chapter file preserves the creative context, enabling re-reading, debugging, and iterating on prompts—while keeping it invisible in the reader UI.

## What Changes

- Write the user's chat message into the chapter `.md` file wrapped in `<user_message>…</user_message>` tags, placed **before** the AI response content
- Strip or hide `<user_message>` blocks during the frontend markdown rendering pipeline so they are never displayed to the reader
- The `<user_message>` tag content is also stripped from `<previous_context>` messages sent to the LLM (same treatment as `<options>` and `<disclaimer>`)

## Capabilities

### New Capabilities

_(none — this feature is implemented entirely through modifications to existing capabilities)_

### Modified Capabilities

- `writer-backend`: Add user message persistence to the chapter file write flow; strip `<user_message>` tags from previous-context prompt construction
- `chapter-navigation`: Strip `<user_message>` blocks during the markdown rendering pipeline so they are not displayed

## Impact

- `writer/server.js` — chat endpoint writes user message to chapter file before streaming AI content; `stripPromptTags` function updated to also remove `<user_message>` blocks
- `reader/js/md-renderer.js` — rendering pipeline strips `<user_message>` blocks before markdown conversion
- Chapter `.md` files on disk will now contain `<user_message>` blocks at the top; existing files without them are unaffected
