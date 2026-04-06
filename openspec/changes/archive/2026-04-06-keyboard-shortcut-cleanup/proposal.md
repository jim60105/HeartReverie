## Why

The arrow-key chapter navigation conflicts with normal text editing and scrolling. The user doesn't need it — chapters are navigated via buttons. Additionally, the chat input currently requires Ctrl+Enter to send, which is unintuitive; plain Enter should submit the message, with Shift+Enter reserved for inserting newlines.

## What Changes

- **Remove arrow-key chapter navigation**: Delete the `keydown` listener in `initChapterNav()` that maps ArrowLeft/ArrowRight to `loadChapter()`. Button and hash-based navigation remain unchanged.
- **Change chat submit shortcut**: Replace the Ctrl+Enter / Cmd+Enter shortcut with plain Enter to submit. Shift+Enter allows the default newline behavior in the textarea.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `chapter-navigation`: Remove the keyboard navigation requirement (ArrowLeft/ArrowRight chapter switching).
- `chat-input`: Change the keyboard submit shortcut from Ctrl+Enter to plain Enter; Shift+Enter inserts a newline.

## Impact

- `reader/js/chapter-nav.js` — Remove the `keydown` event listener block at the end of `initChapterNav()`.
- `reader/js/chat-input.js` — Replace the `keydown` handler: Enter triggers `handleSend()`, Shift+Enter falls through to default textarea behavior.
- No API, dependency, or backend changes.
