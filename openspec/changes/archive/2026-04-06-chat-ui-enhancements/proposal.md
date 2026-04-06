## Why

The chat input UI lacks basic usability features expected in an interactive AI writing tool. Users cannot retry/regenerate an AI response without manually retyping their message. The message text is cleared after sending, forcing users to retype if they want to adjust and resend. Additionally, the chat input is shown on all chapters even though it is only meaningful on the last chapter, creating confusion about where user input will take effect.

## What Changes

- Add a **resend button** to the chat input UI that deletes the last chapter file and re-sends the user message, allowing the user to retry/regenerate the AI response
- Add a backend endpoint to delete the last chapter file (`DELETE /api/stories/:series/:name/chapters/last`)
- **Keep the user's message** in the textarea after sending, so the user can resend or edit without retyping
- **Hide the chat input** when viewing previous chapters; only show it when the user is on the last chapter

## Capabilities

### New Capabilities

_(none — all enhancements modify existing capabilities)_

### Modified Capabilities

- `writer-backend`: Add `DELETE /api/stories/:series/:name/chapters/last` endpoint to delete the last chapter file
- `chat-input`: Add resend button, keep message text after send, wire resend flow (delete last chapter then re-send)
- `chapter-navigation`: Expose whether the user is viewing the last chapter; toggle chat input visibility on chapter change

## Impact

- `writer/server.js` — new DELETE endpoint for last chapter removal
- `reader/js/chat-input.js` — resend button, message retention, resend logic
- `reader/js/chapter-nav.js` — expose `isLastChapter` state, call visibility callback on chapter change
- `reader/index.html` — add resend button element, wire chapter-change callback to show/hide chat input
