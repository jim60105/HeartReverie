## 1. Backend — Persist user message in chapter file

- [x] 1.1 In `writer/server.js`, after opening the chapter file handle and before consuming the SSE stream, write `<user_message>\n{message}\n</user_message>\n\n` to the file and prepend it to `fullContent`
- [x] 1.2 Update `stripPromptTags` in `writer/server.js` to also remove `<user_message>...</user_message>` blocks (add `.replace(/<user_message>[\s\S]*?<\/user_message>/g, "")`)

## 2. Frontend — Hide user message in rendering pipeline

- [x] 2.1 In `reader/js/md-renderer.js`, add a strip step for `<user_message>…</user_message>` (regex removal, same pattern as `<imgthink>` and `<disclaimer>`)

## 3. Validation

- [x] 3.1 Start the dev server, send a chat message, and verify the resulting chapter `.md` file contains `<user_message>` tags at the top followed by AI content
- [x] 3.2 Verify the reader UI does not display the `<user_message>` content when rendering the chapter
- [x] 3.3 Verify that subsequent chat rounds do not include `<user_message>` content in `<previous_context>` messages (check server logs or inspect prompt array)
- [x] 3.4 Verify backward compatibility — load a chapter file without `<user_message>` tags and confirm it renders normally
