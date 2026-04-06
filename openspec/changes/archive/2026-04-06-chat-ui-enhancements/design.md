## Context

The story writer application has a chat input UI (`reader/js/chat-input.js`) where users type messages that are sent to the backend (`writer/server.js`) via `POST /api/stories/:series/:name/chat`. The backend constructs an LLM prompt, streams the AI response, and writes it as the next numbered chapter file. The frontend polls for content changes and renders chapters via `chapter-nav.js`.

Currently: (1) there is no way to regenerate an AI response without manually retyping the message; (2) the textarea is cleared after each send; (3) the chat input is shown on all chapters even though sending a message always creates the *next* chapter after the last one.

## Goals / Non-Goals

**Goals:**
- D1: Allow users to delete the last chapter and resend the same message to regenerate the AI response
- D2: Retain the user's message text in the textarea after sending
- D3: Only show the chat input when the user is viewing the last chapter (or when no chapters exist)

**Non-Goals:**
- Editing or resending messages for arbitrary (non-last) chapters
- Undo/redo history for multiple regenerations
- Changing the prompt construction pipeline or LLM parameters

## Decisions

### D1: New DELETE endpoint for last chapter removal

Add `DELETE /api/stories/:series/:name/chapters/last` to `writer/server.js`. This endpoint finds the highest-numbered `.md` file in the story directory and deletes it. It returns `200` with the deleted chapter number, or `404` if no chapters exist.

**Alternative considered:** Sending a "resend" flag to the existing POST endpoint that implicitly deletes the last chapter — rejected because it conflates creation and deletion semantics, making the API harder to reason about and test independently.

### D2: Resend button in chat-input.js

Add a resend button (🔄 重送) next to the existing send button. On click, it: (1) calls `DELETE /api/stories/:series/:name/chapters/last`, (2) calls `handleSend()` to re-send the current textarea content via the existing chat endpoint. The resend button is only enabled when the textarea has content (i.e., the previous message is still present).

The resend button reuses the existing `onSent` callback after the full flow completes, so chapter navigation reloads automatically.

### D3: Keep textarea content after send

Remove the `els.textarea.value = ''` line in `handleSend()`. The textarea retains its content after a successful send, allowing the user to immediately resend or edit.

### D4: Chat input visibility tied to last-chapter view

Add an `onChapterChange` callback parameter to `initChapterNav`. The `loadChapter` function calls this callback with `{ isLastChapter: boolean }` after rendering. In `index.html`, wire this callback to call `showChatInput()` / `hideChatInput()` based on whether the user is on the last chapter. When no chapters exist (empty story in backend mode), the chat input remains visible.

**Alternative considered:** Having `chapter-nav.js` directly import and call `showChatInput`/`hideChatInput` — rejected to avoid tight coupling between modules.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Deleting the last chapter is destructive and irreversible | The resend flow immediately re-creates the chapter with the same message, so the user only loses the previous AI response. The file system preserves no history regardless. |
| Race condition if polling detects the deleted file before resend completes | The resend button disables both buttons during the operation. Polling may briefly show one fewer chapter, which self-corrects when the new chapter is written. |
| Keeping textarea content may confuse users who expect it to clear | The resend button provides clear affordance for why the message is retained. Users can manually clear if desired. |
