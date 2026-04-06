## 1. Backend — Delete last chapter endpoint

- [x] 1.1 In `writer/server.js`, add `DELETE /api/stories/:series/:name/chapters/last` endpoint with `validateParams` middleware. Find the highest-numbered `.md` file in the story directory, delete it, and return `{ "deleted": <number> }`. Return 404 if no chapters exist.

## 2. Frontend — Resend button

- [x] 2.1 In `reader/index.html`, add a resend button (`id="btn-chat-resend"`, label "🔄 重送") next to the existing send button in the chat input area
- [x] 2.2 In `reader/js/chat-input.js`, accept the resend button element in `initChatInput` and implement `handleResend`: disable controls, call `DELETE /api/stories/:series/:name/chapters/last`, then call the existing send flow, re-enable controls on completion or error

## 3. Frontend — Keep user message

- [x] 3.1 In `reader/js/chat-input.js`, remove the `els.textarea.value = ''` line from the successful send path in `handleSend()` so the message text is retained after sending

## 4. Frontend — Chat input visibility on last chapter

- [x] 4.1 In `reader/js/chapter-nav.js`, add an `onChapterChange` callback option to `initChapterNav`. Call it from `loadChapter` with `{ isLastChapter }` after rendering
- [x] 4.2 In `reader/index.html`, wire the `onChapterChange` callback in `initChapterNav` to call `showChatInput()` when `isLastChapter` is true and `hideChatInput()` otherwise
- [x] 4.3 Ensure that when a backend story is loaded with zero chapters, the chat input remains visible (the `loadFromBackend` function already calls `showChatInput` via `onLoad`)

## 5. Validation

- [x] 5.1 Start the dev server, send a chat message, and verify the textarea retains the message text after successful send
- [x] 5.2 Click the resend button and verify it deletes the last chapter and regenerates the response
- [x] 5.3 Navigate to a previous chapter and verify the chat input is hidden; navigate back to the last chapter and verify it reappears
- [x] 5.4 Load a story with no chapters and verify the chat input is visible
