## Why

The chat input textarea (`ChatInput.vue`) loses its content when the component is destroyed and recreated by Vue's reactivity system. This happens when the user is not on the last chapter and the chapter list updates (e.g., after file creation/deletion), causing the input area to be hidden via `v-if` and then shown again. Although the spec already requires retaining textarea content after a successful send, the content is only stored in a local `ref()` which resets on remount.

The requirement should be strengthened to: "Save the last sent/resent text and restore it on component init." The input text should be persisted to browser storage on send/resend so it survives component remounts, page reloads, and navigation. The storage key should be scoped per story to prevent cross-story leakage.

## What Changes

The `ChatInput.vue` component will persist its textarea content to `sessionStorage`. The text will be saved on every send/resend action, and loaded back when the component initializes. This ensures the user's draft is never lost due to Vue lifecycle events.

## Capabilities

### New Capabilities

_(none — this modifies an existing capability)_

### Modified Capabilities

- `chat-input`: Add persistence of textarea content via sessionStorage; save on send/resend, load on component mount

## Impact

- `reader-src/src/components/ChatInput.vue` — add sessionStorage save/load logic
- Existing tests for ChatInput may need updating to verify persistence behavior
- No backend changes required
- No migration needed (early-stage project, 0 users)
