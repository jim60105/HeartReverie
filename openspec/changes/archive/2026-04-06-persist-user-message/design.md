## Context

The writer backend (`writer/server.js`) receives user chat messages at `POST /api/stories/:series/:name/chat`, constructs a prompt, streams the AI response from OpenRouter, and writes the response as the next numbered chapter file (e.g., `002.md`). Currently, only the AI response is written to disk — the user's message is discarded after prompt construction. The frontend renders chapter markdown via a pipeline in `reader/js/md-renderer.js` that already strips several custom tags (`<imgthink>`, `<disclaimer>`, `<options>`, etc.).

## Goals / Non-Goals

**Goals:**
- D1: Persist the user message in the chapter file so the prompt that generated each chapter is permanently recorded
- D2: Place the user message before the AI response in the chapter file, wrapped in `<user_message>` tags
- D3: Hide `<user_message>` content from the reader rendering pipeline
- D4: Strip `<user_message>` content from `<previous_context>` messages sent to the LLM to avoid polluting future prompts

**Non-Goals:**
- Displaying user messages in the reader UI (they are hidden)
- Changing the prompt construction logic for the current chat round (the user message is still sent via `<inputs>` tags)
- Modifying the chapter listing or numbering logic

## Decisions

### D1: Write user message before streaming begins

After the chapter file handle is opened but before the SSE stream is consumed, write `<user_message>\n{message}\n</user_message>\n\n` to the file. This ensures the user message appears at the top of the chapter file, followed by the AI response content. The `fullContent` variable used for the HTTP response will also include this prefix.

**Alternative considered:** Writing user message as a separate metadata file — rejected because it fragments the chapter data and complicates backup/review.

### D2: Strip `<user_message>` in `stripPromptTags`

Add a `.replace(/<user_message>[\s\S]*?<\/user_message>/g, "")` to the existing `stripPromptTags` function. This reuses the established pattern for `<options>` and `<disclaimer>` stripping, keeping the prompt construction pipeline consistent.

### D3: Strip `<user_message>` in the frontend rendering pipeline

Add a strip step in `md-renderer.js` (alongside the existing `<imgthink>` and `<disclaimer>` strips) to remove `<user_message>…</user_message>` blocks before markdown conversion. This uses the same regex-based approach already proven in the pipeline.

**Alternative considered:** CSS `display:none` — rejected because marked.js converts the tag content to HTML text nodes unpredictably, making CSS targeting unreliable.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Slightly larger chapter files on disk | User messages are typically short (< 1KB); negligible impact |
| Old chapter files lack `<user_message>` tags | Both stripping functions are no-ops when the tag is absent — fully backward-compatible |
| Regex may match nested or malformed tags | User messages are plain text input, not arbitrary HTML; the non-greedy `[\s\S]*?` pattern handles this correctly |
