## Context

The reader frontend uses two keyboard-driven interactions:

1. **Arrow-key chapter navigation** (`reader/js/chapter-nav.js`): A global `keydown` listener maps ArrowLeft/ArrowRight to `loadChapter()`. This fires even when the user is typing in input fields or scrolling, causing unintended chapter changes.

2. **Ctrl+Enter chat submit** (`reader/js/chat-input.js`): The textarea requires Ctrl+Enter (or Cmd+Enter) to submit. Users expect plain Enter to submit in chat-style UIs.

Both modules are standalone ES modules with no shared state beyond DOM elements.

## Goals / Non-Goals

**Goals:**

- Remove the arrow-key chapter navigation entirely — buttons and URL hash navigation remain.
- Make Enter submit the chat message and Shift+Enter insert a newline.

**Non-Goals:**

- Adding any new keyboard shortcuts or accessibility features.
- Changing the button-based or hash-based chapter navigation logic.
- Modifying backend APIs or data flow.

## Decisions

### Decision 1: Full removal vs. focus-guarded arrow keys

Remove the arrow-key listener entirely rather than guarding it with focus checks. The user explicitly doesn't need keyboard chapter navigation, and button/hash navigation is sufficient.

**Alternative considered**: Guard with `document.activeElement` check — rejected because the feature itself is unwanted.

### Decision 2: Enter vs. Shift+Enter in textarea

Use `e.key === 'Enter'` without Shift to trigger submit. When `e.shiftKey` is true, allow default behavior (newline insertion). This matches common chat UIs (Slack, Discord, ChatGPT).

**Alternative considered**: Keep Ctrl+Enter alongside Enter — rejected because the goal is simplification, not adding more shortcuts.

## Risks / Trade-offs

- **[Risk] Users who relied on arrow-key navigation lose it** → Mitigation: Button navigation and URL hash remain fully functional. The user explicitly requested removal.
- **[Risk] Multiline input becomes less discoverable** → Mitigation: Shift+Enter for newline is a well-established convention in chat UIs.
