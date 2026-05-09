## Why

While an LLM response is streaming, the sidebar (`<aside class="sidebar">` in `Sidebar.vue`, hosting plugin-rendered `.plugin-sidebar` panels relocated by `ContentArea.vue`) recalculates and re-renders on every chapter-content mutation. Plugins like `sd-webui-image-gen` re-build their thumbnail strip whenever chapter text changes, and during streaming the chapter text changes many times per second. The result is visible flicker and jank on the right edge of the page that distracts the reader from the streaming chapter.

This change is a **visual-only mitigation**: hiding the `<aside>` while `useChatApi().isLoading === true` masks the flicker from the reader. Underlying relocation work in `ContentArea.vue` and plugin re-renders still happen during streaming — they are simply not visible. The sidebar re-appears (with up-to-date contents) the moment streaming finishes. A deeper fix (deferring or batching relocation while streaming) is **out of scope** for this change.

## What Changes

- `Sidebar.vue` SHALL accept a transient "hidden during LLM generation" visual state driven by `useChatApi().isLoading`. When that ref is `true`, `<aside class="sidebar">` SHALL be visually suppressed (CSS `visibility: hidden` plus `opacity: 0` and `pointer-events: none`) so it occupies no visible/interactive space but remains in the DOM. When the ref returns to `false`, the sidebar SHALL re-appear immediately.
- The hidden state SHALL be derived purely from the in-memory `isLoading` ref. It SHALL NOT be persisted to `localStorage`, `sessionStorage`, IndexedDB, cookies, or query strings. On page reload the sidebar SHALL always start visible (the new in-memory `isLoading` defaults to `false` per `useChatApi.ts`).
- The sidebar SHALL remain mounted and SHALL NOT be `v-if`-removed: removing and re-adding the host node would force `ContentArea.vue`'s `watchPostEffect` to re-relocate plugin panels and would tear down plugin-rendered DOM and event listeners. The change is visual-only (CSS class toggle).
- The hide rule SHALL apply on both desktop and mobile layouts.
- `streaming-cancellation` flow SHALL be respected: when the user aborts a request and `isLoading` flips back to `false`, the sidebar SHALL re-appear without delay.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `page-layout`: The "Content area and sidebar responsive layout" requirement gains a scenario describing transient sidebar hiding while `useChatApi().isLoading` is `true`, including non-persistence across reloads and DOM-stability (no unmount).

## Impact

- Affected files (host project):
  - `HeartReverie/reader-src/src/components/Sidebar.vue`: subscribe to `useChatApi().isLoading`, bind a CSS class (e.g., `.sidebar--hidden-during-stream`) to the `<aside>`, define the suppression rule.
  - `HeartReverie/reader-src/src/components/__tests__/Sidebar.test.ts` (new or extended): cover hide-on-loading, show-on-finish, no-persistence-on-mount, DOM-not-removed.
- No backend / Deno changes.
- No plugin changes: plugin `.plugin-sidebar` panels are children of `<aside>` and are hidden transitively; their polling and metadata fetches are unaffected.
- No persisted state, so no migration. (Project policy: 0 users in the wild — no backward-compatibility considerations.)
