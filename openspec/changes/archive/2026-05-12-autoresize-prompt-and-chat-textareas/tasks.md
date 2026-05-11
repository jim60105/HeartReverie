# Tasks — Auto-resize prompt-editor and chat-input textareas

## 1. Composable

- [x] 1.1 Create `reader-src/src/composables/useAutoresize.ts` exposing `useAutoresize(elRef, { minLines = 3, watch? })` with the contract from `design.md` (D1, D4–D6).
- [x] 1.2 Implement `recompute()` using `requestAnimationFrame` batching: read computed line-height / padding / borders, set `height: auto`, read `scrollHeight`, write `height = max(measured, minPx) + "px"` where `measured` = `scrollHeight + borderTop + borderBottom` for `box-sizing: border-box` and `scrollHeight - paddingTop - paddingBottom` for `box-sizing: content-box` (D5).
- [x] 1.3 Observe the textarea's containing block with `ResizeObserver` (D5b); await `document.fonts.ready` once when supported and recompute behind an `isUnmounted` guard. Disconnect the observer in `onBeforeUnmount` and `cancelAnimationFrame` any pending write. Treat a `null` ref as a no-op.
- [x] 1.4 When `watch` is provided, call `recompute()` on mount AND whenever the watched value changes (use Vue `watch` with `flush: "post"`).

## 2. Composable tests

- [x] 2.1 Add `reader-src/src/composables/__tests__/useAutoresize.test.ts` covering: floor of `minLines` lines on a tiny body, growth past floor on a long body, growth on `watch` value change, no-op on a `null` ref, `ResizeObserver` cleanup on unmount.
- [x] 2.2 Cover the `line-height: normal` fallback (the composable SHALL fall back to `1.2 × font-size`).
- [x] 2.3 Cover the **box-sizing accounting**: assert that on a `box-sizing: border-box; border: 2px solid` textarea with N content lines the written `style.height` exactly accommodates the inner content (no internal scrollbar).
- [x] 2.4 Cover **RAF cancellation on unmount**: spy on `el.style.height`'s setter, queue `recompute()`, immediately unmount, assert no further writes occur.

## 3. PromptEditorMessageCard wiring

- [x] 3.1 In `reader-src/src/components/PromptEditorMessageCard.vue`, import `useAutoresize` and call it in `<script setup>` with `{ minLines: 3, watch: () => props.card.body }`.
- [x] 3.2 Update the scoped `<style>` for `.card-body`: drop `min-height: 96px`; replace `resize: vertical` with `resize: none`.
- [x] 3.3 Update `reader-src/src/components/__tests__/PromptEditorMessageCard.test.ts` and `PromptEditorMessageCard.extra.test.ts` so existing assertions still hold and add: (a) one assertion that emitting an `update:body` with a long string sets `style.height` past the three-line floor; (b) a **shrink-back-to-floor** assertion — start with a 50-line body, replace it with `"hi"`, assert the next post-flush height equals exactly the three-line floor.

## 4. ChatInput wiring

- [x] 4.1 In `reader-src/src/components/ChatInput.vue`, add a template ref `chatTextareaRef` on the `<textarea>` and call `useAutoresize(chatTextareaRef, { minLines: 3 })` in `<script setup>` (no `watch` — explicit triggers only).
- [x] 4.2 Add `@paste="onPaste"` AND `@input="onInput"` listeners. In `onPaste`, schedule `recompute()` (the existing RAF batching guarantees measurement runs after the browser's default paste insertion). In `onInput`, schedule `recompute()` ONLY when `event.inputType === "insertFromPaste"` (defence-in-depth for browsers that re-order the paste / input pair).
- [x] 4.3 Trigger `recompute()` on `onMounted` (after the persisted-draft restore) and from inside `appendText()` after the `inputText.value` mutation.
- [x] 4.4 Keep `resize: vertical` on the scoped `.chat-textarea` style (manual-handle override per design D3).
- [x] 4.5 Add `reader-src/src/components/__tests__/ChatInput.test.ts` covering: a long persisted draft grows past floor on mount; a multi-line paste grows past floor (dispatch native `paste` AND a follow-up `input` event with `inputType: "insertFromPaste"`, assert the recompute fires exactly once); a single physical line that wraps to ~10 visual lines at the container width grows the textarea (soft-wrap regression); a single-character keystroke does NOT change the height; `appendText()` triggers growth.

## 5. Lint, typecheck, tests

- [x] 5.1 Run `cd reader-src && deno task test:frontend` and confirm the new and existing suites pass.
- [x] 5.2 Run `cd reader-src && deno run -A npm:eslint@^9.27.0 src` (or whatever lint task already exists in `reader-src/`) and resolve any new diagnostics on the touched files. If no lint task exists in the reader subproject, fall back to `deno fmt --check reader-src/src/composables/useAutoresize.ts reader-src/src/components/{PromptEditorMessageCard,ChatInput}.vue`.
- [x] 5.3 Run `deno check writer/` from the repo root to confirm no upstream type breakage (none expected).

## 6. Container integration verification (BLOCKING)

- [x] 6.1 Build and run via `scripts/podman-build-run.sh`; confirm clean startup (no errors / warnings beyond the known npm/sharp ones).
- [x] 6.2 Use `agent-browser` against `http://localhost:8080/settings/prompt-editor`:
  - Take a snapshot, locate at least one `textarea.card-body`, capture its measured height.
  - Type a 30-line block into the body via `fill`, re-snapshot, confirm the textarea now shows >3 lines (its `clientHeight` exceeds the three-line floor by a clear margin).
- [x] 6.3 Use `agent-browser` against a story chapter page (use the canonical `/test/test` story):
  - Confirm the chat textarea opens at three lines for an empty draft.
  - Set a long persisted draft via `sessionStorage.setItem("heartreverie:chat-input:test:test", longText)`, reload the page, confirm the textarea opens past the three-line floor.
  - Paste a 20-line block, confirm growth.
  - Type a single space, confirm no growth.
- [x] 6.4 Capture before/after screenshots from `agent-browser` for the proposal record.

## 7. Specs and changelog

- [x] 7.1 `openspec validate autoresize-prompt-and-chat-textareas --strict` passes.
- [x] 7.2 No CHANGELOG entry is required (project is pre-release; per workspace policy CHANGELOG/Vento templates are excluded from formatting changes).
