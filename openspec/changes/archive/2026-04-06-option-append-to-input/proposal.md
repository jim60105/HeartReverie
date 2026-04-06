## Why

Clicking an option button currently only copies the text to the clipboard. The user must then manually paste it into the chat input textarea. This friction slows interaction flow. By automatically appending the option text to the chat input on click, users can select options and submit in fewer steps while retaining the clipboard copy as a secondary convenience.

## What Changes

- Option buttons will append their text to the chat input textarea on click (with a newline separator if the textarea already has content).
- The existing copy-to-clipboard behavior is preserved — clicking does both: append to input AND copy to clipboard.
- A new exported function `appendToInput(text)` will be added to `chat-input.js` so the options panel can programmatically insert text into the textarea.
- The options panel's inline `onclick` handler will be updated to call the append function in addition to the clipboard copy.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `chat-input`: Add an `appendToInput(text)` public API for programmatically appending text to the chat textarea.
- `options-panel`: Update click behavior to append option text to the chat input in addition to copying to clipboard.

## Impact

- `reader/js/chat-input.js` — new exported function `appendToInput`.
- `reader/js/options-panel.js` — updated `renderOptionsPanel` to call the append function on click.
- `reader/index.html` — may need to wire/import the new function or pass it as a dependency during initialization.
