# Design — Auto-resize prompt-editor and chat-input textareas

## Goals

1. Long card bodies in the prompt editor stop hiding behind a 96 px slit; height tracks content.
2. A multi-line paste — or a long sessionStorage-restored draft — into the chapter chat input shows in full immediately, without the user dragging a resize handle.
3. The behaviour is implemented once as a reusable Vue composable so future textareas (e.g. story-config notes, lore-codex editor) can opt in with one line.
4. Floor of three lines is preserved so the controls never collapse to a single-line look that breaks the visual rhythm of the page.

## Decisions

### D1. Single composable, two consumers

We add `useAutoresize(textareaRef, { minLines = 3, watch? })` to `reader-src/src/composables/useAutoresize.ts`. Both consumers call it once; differences are expressed via the `watch` option:

- Prompt editor wants "always fit content" → `watch: () => props.card.body`.
- Chat input wants "fit only on paste / load / programmatic insert" → no `watch`; consumer calls `recompute()` manually.

A single composable keeps the height-measurement logic (computed line height, padding/border accounting, `requestAnimationFrame`-batched writes, resize listener lifecycle) in one tested place. Doing it inline in each component would duplicate roughly 40 lines per call site and make it easy for future drift to break only one of the two textareas.

### D2. The chat textarea does NOT auto-grow on every keystroke

The user's brief says "expand the height when pasting content into textarea or loading the content from last stored content". That excludes per-keystroke growth on purpose: the chapter page is a writing surface where the user is mostly looking at the chapter above the input, and a textarea that grows under the cursor every time the user adds a line would push the chapter content out of view mid-sentence. Pasting and loading are discrete one-shot events where seeing the full content is the user's goal; typing is continuous and benefits from a stable layout.

This is the sole reason the consumer triggers `recompute()` manually instead of subscribing to the value. Once the textarea has been grown by a paste, subsequent typing scrolls inside it. If the user wants to collapse the box back, deleting the pasted content does NOT shrink it (consistent with the "no growth on typing" rule); they can press a future "重設高度" button if we ever introduce one. For this change, that is out of scope.

### D3. Drop manual `resize` only on the prompt editor; keep it on the chat input

The prompt-editor card body re-fits on every value change, so a manual handle would be overwritten by the next `recompute()` (mixed-mode UX). We pick automatic and remove the handle (`resize: none`) there.

The chat input is different. By the deliberate design decision in D2, it does NOT auto-grow on per-keystroke input. If we ALSO took away the manual handle, a user typing a long message line-by-line from scratch would be stuck inside a three-line scrolling slit, and a paste-grown box could never be dragged back down. Both are real frustrations a single `resize: none` rule would inflict. We therefore keep `resize: vertical` on `.chat-textarea` so the user retains a manual override that complements the JS-driven growth-on-paste/load. The two height authorities never fight each other in practice: the JS-driven path fires only on paste / load / `appendText`, and the user's manual drag persists until one of those events runs again (which they triggered themselves).

### D5b. Re-measure on container width change, not just viewport resize

Window resize is a poor proxy for "the wrap width might have changed." Sidebars open or collapse, layout modes flip, parent visibility toggles, and theme swaps can all change the textarea's content width without the viewport resizing. The composable therefore observes the textarea's containing block via `ResizeObserver` and recomputes on every contentBoxSize change. We do NOT register a `window.resize` listener in addition; `ResizeObserver` already covers the viewport-resize case (the containing block resizes too).

### D4. Min-height computation lives in JS, not CSS

A CSS `min-height: calc(3em * 1.5 + 16px)` would seem simpler, but breaks for users whose body font-size or line-height differs (we already have a theme system that may override either) and for the prompt editor where `font-size: 0.85em` cascades into a different absolute value than the chat input's `var(--font-base)`. Reading the resolved style at mount and on font load is more robust and keeps a single source of truth: whatever the textarea's actual line metrics are, three of them.

`getComputedStyle(el).lineHeight` returns either a length string (e.g. `"20.4px"`) or the keyword `"normal"`. When normal, we fall back to `1.2 × parseFloat(getComputedStyle(el).fontSize)` — the conventional default the major browser engines use for `normal`. Padding and border widths are read once per `recompute()` so theme switches and DevTools tweaks pick up automatically.

### D5. Recompute is `requestAnimationFrame`-batched

Each `recompute()` touches layout twice — `el.style.height = "auto"` (forces reflow on next read), then `el.scrollHeight` (the read), then `el.style.height = X` (write). Doing this in the same microtask as a Vue reactive update can cause forced synchronous layout. We schedule the write with `requestAnimationFrame`, coalescing bursts (e.g. an IME composition end that flips two reactive values) into a single layout pass. If `recompute()` is called twice within one frame the pending callback is reused, so the cost is one measurement per frame regardless of how many triggers fired. The pending RAF id is cancelled in `onBeforeUnmount`; an `isUnmounted` flag guards against any RAF callback that already fired but not yet executed at teardown.

The `box-sizing` of both target textareas is `border-box`, so `style.height` interprets its value as the full outer height including borders and padding. `scrollHeight`, however, returns content + padding only — never borders. Setting `style.height = scrollHeight + "px"` on a border-box element therefore leaves a 1–2 px content overflow that triggers the internal scrollbar. The composable normalises this by writing `scrollHeight + borderTop + borderBottom` for `box-sizing: border-box` and `scrollHeight - paddingTop - paddingBottom` for `box-sizing: content-box`. The path is covered by an explicit unit test (textarea with `border: 1px solid` and `box-sizing: border-box`, body of N lines, assert no internal scrollbar).

### D6. Cleanup contract

The composable registers a `ResizeObserver` on the textarea's containing block, schedules an `await document.fonts.ready` (when supported) followed by a guarded recompute, and may queue at most one `requestAnimationFrame` callback at any moment. On `onBeforeUnmount` the composable disconnects the `ResizeObserver`, sets an `isUnmounted` flag (so a late `fonts.ready` resolution becomes a no-op rather than writing to a detached node), and `cancelAnimationFrame`s the pending id. `useAutoresize` is safe to call inside conditionally rendered children: when the ref is `null`, every public method short-circuits.

### D7. Testing strategy

- **Composable unit tests** (Vitest + happy-dom):
  - `recompute()` sets `height` to `Math.max(measured, minPx)` (the box-sizing-aware `measured` from D5).
  - With `minLines: 3`, a single-character body still leaves height at the three-line floor.
  - Watching a getter triggers `recompute()` after a flush.
  - Removing the component disconnects the `ResizeObserver`.
  - Calling `recompute()` on a `null` ref is a no-op.
  - **Border-box accounting**: a textarea with `box-sizing: border-box; border: 2px solid` and a content height of N lines is sized so that no internal scrollbar appears (assert `el.scrollHeight <= parseFloat(el.style.height) - borderTop - borderBottom + 1`, i.e. content fits in the inner content box).
  - **`line-height: normal` fallback**: assert the floor falls back to `1.2 × font-size`.
  - **RAF cancellation on unmount**: queue a `recompute()`, immediately unmount, and assert no further write to `style.height` occurs (verified via a `style.height` setter spy).
- **PromptEditorMessageCard tests**: mount with a 50-line body, assert the textarea ends up tall enough to show >3 lines (assert `style.height` parses to >= floor + delta, since happy-dom's `scrollHeight` returns the layout height set on the element via the existing offsetHeight shim or via direct property override in the test). Add a **shrink-back-to-floor** scenario: mount with a 50-line body, replace it with `"hi"`, assert the next `recompute()` lands the height at exactly the three-line floor.
- **ChatInput tests**:
  - On mount with a long persisted draft, height grows past floor.
  - Pasting a 20-line snippet grows the height. Drive the test by dispatching the native `paste` event AND following with an `input` event whose `inputType === "insertFromPaste"`; assert recompute fired exactly once across both (the RAF coalescing collapses the pair).
  - Typing one character does NOT change the height (regression test for D2).
  - `appendText()` triggers growth.
  - **Soft-wrap regression**: paste a single physical line that would wrap to ~10 visual lines at the current container width; assert the textarea grows past the floor (catches the wrap-not-just-newlines case).

### D8. Affected files only — no engine work

This change is pure frontend. No backend routes, no Vento template changes, no plugin contract changes. The container build is needed only because the SPA bundle is baked into the image; live development would be `cd reader-src && deno task dev:reader` but the workspace's mandatory verification protocol still applies (rebuild + browser smoke-test through the production-mode container).

## Alternatives considered

- **Always grow on every keystroke for the chat input.** Rejected per D2 — the writing surface above shifts under the user, breaking the focus on the chapter being written.
- **A pure-CSS `field-sizing: content` solution.** That CSS property is shipping but not yet baseline (no Firefox release at the time of writing). For an SPA whose primary deployment is a self-hosted container the maintainer may load in any browser, JS-driven sizing keeps behaviour uniform across engines.
- **`vue-textarea-autosize` or similar third-party package.** Adds an npm dependency and ESM-vs-CJS surface area for one ~60-line concept. The composable is small enough that owning it ourselves is cheaper than auditing an upstream.
- **Persisting the resize-handle height to `localStorage`.** Considered, rejected: it sidesteps the root problem (the default size is wrong) and adds new state to manage per textarea.

## Risks & mitigations

- **happy-dom `scrollHeight` quirks** — happy-dom does not lay text out, so `scrollHeight` defaults to 0 unless we override it in tests. Mitigation: set `Object.defineProperty(el, "scrollHeight", { get: () => N })` per scenario, the same pattern existing tests use for `clientHeight`.
- **Theme-induced font-size changes** — covered by listening for `document.fonts.ready` and re-running the calculation; users who hot-swap themes during a session may need to interact with the textarea once before height re-syncs in the rare case the platform fires no font event. Acceptable for v1.
- **IME composition** — the composable does NOT intercept composition events; it relies on the native value updates that fire after composition end. Tested via the explicit "type one char does not grow" test on the chat input and the "watch fires on body change" test on the prompt editor.
