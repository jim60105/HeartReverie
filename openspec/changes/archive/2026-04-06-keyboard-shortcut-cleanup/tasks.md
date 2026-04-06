## 1. Remove arrow-key chapter navigation

- [x] 1.1 Delete the `keydown` event listener block (lines 216–221) in `reader/js/chapter-nav.js` that maps ArrowLeft/ArrowRight to `loadChapter()`
- [x] 1.2 Verify button-based and hash-based chapter navigation still work after removal

## 2. Change chat submit shortcut to Enter

- [x] 2.1 Replace the `keydown` handler in `reader/js/chat-input.js`: Enter (without Shift) calls `e.preventDefault()` and `handleSend()`; Shift+Enter falls through to default newline behavior
- [x] 2.2 Verify Enter submits the message and Shift+Enter inserts a newline in the textarea
