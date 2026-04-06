## 1. Chat Input — Add `appendToInput` Export

- [x] 1.1 Add `appendToInput(text)` function to `reader/js/chat-input.js` that appends text to `els.textarea` with a `\n` separator when the textarea already has content, or inserts directly when empty. Guard against `els.textarea` being undefined.
- [x] 1.2 Export `appendToInput` from `reader/js/chat-input.js`.

## 2. Application Wiring — Register Global Bridge

- [x] 2.1 In `reader/index.html` script block, import `appendToInput` from `chat-input.js` and register it on `window.__appendToInput` so inline onclick handlers can call it.

## 3. Options Panel — Update Click Handler

- [x] 3.1 Update `renderOptionsPanel` in `reader/js/options-panel.js` to call `window.__appendToInput(btn.dataset.optionText)` inside the inline `onclick` handler, in addition to the existing clipboard copy logic. Guard the call with a typeof check so a missing bridge function does not throw.

## 4. Verification

- [x] 4.1 Manually verify: click an option button → text is copied to clipboard AND appended to chat textarea. Confirm newline separator when textarea already has content.
- [x] 4.2 Verify that clicking an option before chat-input is initialised does not throw errors.
