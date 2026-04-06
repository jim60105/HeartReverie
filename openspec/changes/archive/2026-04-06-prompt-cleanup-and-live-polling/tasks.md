# Tasks — Prompt Cleanup & Live Polling

## 1. Prompt Tag Stripping

- [x] 1.1 Create a `stripPromptTags(content)` helper function in `writer/server.js` that removes `<options>...</options>` and `<disclaimer>...</disclaimer>` tags and their content using regex (dotAll flag for multiline)
- [x] 1.2 Apply `stripPromptTags()` to each chapter's content before wrapping in `<previous_context>` in the chat endpoint's message construction
- [x] 1.3 Trim the result after stripping to avoid leading/trailing whitespace from removed tags

## 2. Content-Aware Polling

- [x] 2.1 Modify `pollBackend()` in `reader/js/chapter-nav.js` to also fetch the last chapter's content via `GET /api/stories/:series/:name/chapters/:number`
- [x] 2.2 Compare fetched content with `state.backendChapters[last].content` — if different, update the cached content
- [x] 2.3 If user is currently viewing the last chapter, re-render the updated content
- [x] 2.4 Also handle new chapter detection (existing logic): if chapter count changed, fetch the new chapters and add them

## 3. Verification

- [x] 3.1 Verify tag stripping works correctly on chapter content containing `<options>` and `<disclaimer>` blocks
- [x] 3.2 Verify polling updates the display when last chapter content changes
