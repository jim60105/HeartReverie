## Context

The reader app is a single-page application where chapter content is rendered as HTML. Chapters may contain `<options>` blocks that render as clickable button grids. The options panel (`options-panel.js`) and chat input (`chat-input.js`) are independent ES modules with no direct coupling. Currently, clicking an option button only copies its text to the clipboard via an inline `onclick` handler.

The chat input module manages a textarea element (`els.textarea`) through a private `els` object populated at init time. The options panel generates HTML strings with inline event handlers since it produces markup that is injected via the rendering pipeline (`md-renderer.js` → `renderChapter`).

## Goals / Non-Goals

**Goals:**

- Allow option button clicks to append text directly into the chat textarea, eliminating the manual paste step.
- Preserve the existing clipboard copy behavior alongside the new append behavior.
- Keep module coupling minimal — the options panel should not directly import or reference the chat input's internal state.

**Non-Goals:**

- Changing the visual layout or styling of option buttons.
- Auto-submitting the chat message after appending an option.
- Supporting undo/revert of appended text.

## Decisions

### Decision 1: Export `appendToInput(text)` from `chat-input.js`

**Choice:** Add a new exported function `appendToInput(text)` to `chat-input.js` that appends text to `els.textarea`.

**Rationale:** This keeps the textarea access encapsulated within `chat-input.js`. The function handles newline logic (prepend `\n` if content exists) and is available for any future caller. This is the simplest approach with minimal coupling.

**Alternatives considered:**
- *Custom DOM event*: Would require the options panel to dispatch an event and a listener to be set up somewhere. More indirection for a simple operation.
- *Callback injection during init*: Would require changing the options panel's `renderOptionsPanel` signature and the rendering pipeline. The options panel generates static HTML strings, not live DOM — callbacks can't be attached at render time.

### Decision 2: Use a global bridge function for inline handlers

**Choice:** Register `appendToInput` on `window` (e.g., `window.__appendToInput`) from the `index.html` wiring script, so the inline `onclick` handler in generated HTML can call it.

**Rationale:** The options panel generates HTML strings with inline `onclick` handlers (not live DOM). ES module exports are not accessible from inline handlers. A thin global bridge is the pragmatic solution given the current architecture. The wiring in `index.html` already imports from `chat-input.js`, so it can register the function on `window` at init time.

**Alternatives considered:**
- *Refactoring to use event delegation*: Would require significant rework of the rendering pipeline to attach event listeners after DOM insertion. Out of scope for this change.
- *Importing chat-input directly in options-panel*: Creates a circular or tight coupling between modules that are currently independent.

## Risks / Trade-offs

- **[Global namespace pollution]** → Mitigated by using a namespaced property (`window.__appendToInput`) that is clearly internal. Only one function is exposed.
- **[Textarea may not exist when option is clicked]** → The `appendToInput` function will check if `els.textarea` exists before writing. The chat input area is shown on the last chapter, which is the same condition for options rendering, so in practice they coexist.
