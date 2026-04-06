## Why

Two improvements to the story writing workflow:
1. The AI's chapter output includes `<options>` and `<disclaimer>` tags that are UI artifacts, not story content. Including them in the chat history pollutes the prompt context and wastes tokens.
2. The writer server now streams chapter content to disk in real time, but the reader frontend only polls for new chapter *files* — it doesn't re-read content of existing chapters. Users can't see content appearing as it streams.

## What Changes

- Strip `<options>...</options>` and `<disclaimer>...</disclaimer>` tags (and their content) from chapter text when building the prompt's `<previous_context>` messages
- Change the frontend polling to also fetch and compare the content of the last chapter, so streaming updates appear in real time without waiting for a new file

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `writer-backend`: Strip `<options>` and `<disclaimer>` tags from chapter content when constructing prompt chat history
- `chapter-navigation`: Poll the last chapter's content (not just file count) to detect streaming updates in real time

## Impact

- `writer/server.js` — Add tag-stripping logic before building `<previous_context>` messages
- `reader/js/chapter-nav.js` — Modify `pollBackend()` to fetch and compare last chapter content, re-render if changed
