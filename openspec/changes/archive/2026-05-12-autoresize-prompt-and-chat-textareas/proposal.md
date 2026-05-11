# Auto-resize prompt-editor and chat-input textareas

## Why

Two long-form `<textarea>` controls in the reader SPA force users to scroll through narrow viewports while editing what is conceptually a paragraph- or page-length block of text:

1. **`/settings/prompt-editor` — message-card body** (`textarea.card-body` in `reader-src/src/components/PromptEditorMessageCard.vue`). Each card hosts a system / user / assistant template body that can run hundreds of lines (full system prompts plus Vento control blocks). Today the textarea ships with `min-height: 96px` (about four 13.6 px monospace lines) and only `resize: vertical`. Authors must drag the resize handle for every card on every visit, and the manual size never tracks the actual body length, so a long block is buried in a 96 px slit while a six-word card wastes the same vertical footprint as a 200-line one.

2. **Chapter page — chat input** (`textarea.chat-textarea` in `reader-src/src/components/ChatInput.vue`). The control persists `inputText` to `sessionStorage` per `(series, story)` and is restored on mount. Pasting a multi-line snippet (e.g. a chunk from another chapter, a directive copied from elsewhere, or the parent context exposed via `appendText()` from the slot toolbar) leaves the visible area at `rows="3"`, hiding everything past the third wrapped line and quietly defeating the persistence feature when users return to a story whose stored draft is already long.

Both flows are friction the user notices on every interaction and that no existing setting fixes. There is no released build to migrate, so we can change the layout behaviour outright without a flag.

## What Changes

- Introduce a single Vue 3 composable `useAutoresize(textareaRef, options)` in `reader-src/src/composables/useAutoresize.ts` that:
  - Computes a CSS `min-height` floor of `options.minLines` rows (default `3`) using the textarea's resolved `line-height`, `padding-top`, `padding-bottom`, `border-top-width`, and `border-bottom-width`. When `line-height` resolves to `normal`, the composable SHALL fall back to `1.2 × font-size`.
  - On `recompute()` (and on a `ResizeObserver` watching the textarea's containing block, plus the document-level `fonts.ready` promise where available), sets `el.style.height = "auto"` then `el.style.height = max(measured, minPx) + "px"`. The `measured` value SHALL be `scrollHeight + borderTop + borderBottom` when the element's `box-sizing` is `border-box` (which both target textareas use), and `scrollHeight - paddingTop - paddingBottom` when `box-sizing` is `content-box`. The math is required because `scrollHeight` includes content + padding but never borders, while `style.height` interprets its value via `box-sizing`; mixing the two without correction leaves a 1–2 px scrollbar on border-box elements with non-zero borders.
  - Exposes `recompute` so callers can trigger growth from explicit events (paste, programmatic insertion).
  - Optionally accepts `watch: () => string` to auto-recompute whenever the bound value changes (used by the prompt editor where any keystroke must keep the textarea sized to its content).
  - Schedules every height write via `requestAnimationFrame`; cancels any pending frame on `onBeforeUnmount`. `document.fonts.ready` is a one-shot promise — the composable awaits it once and writes the height behind an `isUnmounted` guard so a late resolution after teardown is a no-op. Listeners on `window` (none after this change), `ResizeObserver`, and any added font-loading event are all torn down on `onBeforeUnmount`. The composable never throws if the element is `null` (covers conditional rendering and SSR-style mounts).
- Update **`PromptEditorMessageCard.vue`** to call `useAutoresize(textareaRef, { minLines: 3, watch: () => props.card.body })`. Replace `resize: vertical` with `resize: none` and drop the static `min-height: 96px`; both become unnecessary and visually conflicting once the height tracks the body. The textarea SHALL also shrink back to the three-line floor when the body is cleared.
- Update **`ChatInput.vue`** to call `useAutoresize(chatTextareaRef, { minLines: 3 })` and trigger `recompute()` from:
  - `onMounted` after the persisted text is restored (so a long stored draft opens fully visible).
  - The textarea's native `paste` event. The handler SHALL schedule the `recompute()` such that measurement happens **after** the browser's default paste insertion has run — the existing `requestAnimationFrame` batching already provides this guarantee (browser default actions run in the current task; the RAF callback runs in the next frame). The composable SHALL also recompute when an `input` event fires with `InputEvent.inputType === "insertFromPaste"`, as a defence-in-depth path for any browser that re-orders the paste / input pair.
  - The exported `appendText()` (which mutates `inputText.value` from the parent's slot toolbar).
  - The chat textarea SHALL keep `resize: vertical` (manual override preserved). Per-keystroke auto-grow is deliberately omitted (see design D2); leaving the manual handle gives the user a way to expand the box for a long message they are typing from scratch and a way to drag a paste-grown box back down.
- Add Vitest coverage for the composable (min-height floor, growth, shrink-back-to-floor, resize listener cleanup) and update the existing `PromptEditorMessageCard.test.ts` / `PromptEditorMessageCard.extra.test.ts` to assert the textarea gets sized after a body change. Add a new `ChatInput.test.ts` block exercising `loadPersistedText` + paste growth.
- Documentation: refresh the relevant lines in `docs/` (none of the existing pages cover textarea ergonomics, so no doc edits are required besides the spec deltas).

## Impact

- **Affected specs**:
  - `chat-input` — add an "Auto-resize on paste and on stored-draft restore" requirement.
  - `prompt-editor-message-cards` — add an "Auto-resize card body to content" requirement and modify the existing "Message card component UI" requirement to drop the `min-height: 96px` / manual-resize promise.
- **Affected code**:
  - `reader-src/src/composables/useAutoresize.ts` (new)
  - `reader-src/src/composables/__tests__/useAutoresize.test.ts` (new)
  - `reader-src/src/components/PromptEditorMessageCard.vue` (template hook + scoped style)
  - `reader-src/src/components/ChatInput.vue` (script + template hook + scoped style)
  - `reader-src/src/components/__tests__/PromptEditorMessageCard.test.ts` and `PromptEditorMessageCard.extra.test.ts` (assert sizing side-effect)
  - `reader-src/src/components/__tests__/ChatInput.test.ts` (new — covers paste-grow and load-grow)
- **Backwards compatibility**: not applicable. The project is pre-release with zero known external users; both behaviours (manual resize + 96 px floor) are dropped outright.
- **Performance / accessibility**: each `recompute()` reads `scrollHeight` then writes `height` — a single style mutation per change, gated by `requestAnimationFrame` to avoid layout thrash. Screen-reader and keyboard semantics are unchanged (the element remains a native `<textarea>`); no `aria-*` adjustments are required.
- **Container verification**: the change MUST be verified end-to-end with `scripts/podman-build-run.sh` and a browser-driven probe (`agent-browser`) against `http://localhost:8080/settings/prompt-editor` and a story chapter page, in line with the workspace's mandatory integration-verification protocol.
