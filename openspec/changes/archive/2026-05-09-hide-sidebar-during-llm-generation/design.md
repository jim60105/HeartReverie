## Context

The reader page renders chapter content in `ContentArea.vue` and a host `<aside class="sidebar">` in `Sidebar.vue`. Plugin frontends inject `.plugin-sidebar` elements into the chapter HTML; `ContentArea.vue` relocates them into `<aside>` via a `watchPostEffect` that runs whenever the chapter content mutates.

During streaming, the chapter content updates many times per second (one update per token batch). Each update re-runs the relocation effect, and the relocated plugin DOM (e.g., `sd-webui-image-gen`'s thumbnail strip) re-renders. The visual result is right-edge flicker that competes with the streaming text for the reader's attention.

`useChatApi.ts` exports a module-level `isLoading: Ref<boolean>` that is `true` exactly while a streaming request is in flight (set `true` at start, `false` on success / error / abort / cancel).

## Goals / Non-Goals

**Goals:**

- Eliminate sidebar flicker during streaming by hiding `<aside class="sidebar">` while `isLoading === true`.
- Sidebar re-appears immediately when streaming completes, errors, is aborted, or is cancelled.
- Plugin DOM, polling timers, and event listeners SHALL NOT be unmounted or rebuilt as a side effect of hiding.
- Hidden state SHALL NOT survive a full page reload — every fresh page load starts with the sidebar visible.
- Behaviour applies to all viewports (desktop and mobile).

**Non-Goals:**

- Pausing plugin polling or metadata fetches during streaming (out of scope; plugins remain a black box).
- Animating the show/hide transition (out of scope; immediate is acceptable and avoids extra re-renders).
- Toggle / preference for the user to disable this behaviour (not requested; can be added later if needed).
- Hiding the streaming preview area, header navigation, or any other UI surface — only `<aside class="sidebar">` is affected.

## Decisions

### D1. Hide via CSS class toggle on the existing `<aside>`, never via `v-if`

Bind a class (`.sidebar--hidden-during-stream`) onto the existing `<aside>` element when `isLoading === true`. Apply CSS rules `visibility: hidden; opacity: 0; pointer-events: none`. Keep `display` unchanged so the layout slot the sidebar normally occupies remains stable (no horizontal jump on the chapter column).

**Why not `v-if` or `display: none`:**

- `v-if` would unmount `<aside>`, destroy its DOM children, and invalidate `ContentArea.vue`'s relocation map. When the sidebar re-mounts, the `watchPostEffect` would need to re-find and re-move plugin panels — fragile and forces plugins to rebuild.
- `display: none` would force a re-layout each time `isLoading` toggles. `visibility: hidden` keeps the layout box and is cheaper.
- `pointer-events: none` is added so a hidden sidebar cannot receive accidental clicks (e.g., a hover-revealed lightbox button) during streaming.

### D2. Drive the state from `useChatApi().isLoading`, not a new store

`isLoading` already encodes exactly the state we want ("an LLM stream is in flight"). It is a module-level `ref` reset to `false` in every flow path on completion / error / abort / cancel — including the streaming-cancellation cases covered by the existing `streaming-cancellation` capability. Reusing it gives us perfect synchronisation with the streaming lifecycle for free.

**Alternatives considered:**

- A dedicated Pinia store / new `ref`. Rejected — adds a parallel state to keep in sync with `isLoading`; race risk (e.g., we forget to reset in one error branch).
- Subscribing to backend SSE events directly. Rejected — duplicates work `useChatApi` already does and ignores client-side aborts.

### D3. Non-persistence is achieved by *not implementing persistence*

The proposal mandates that the hidden state must not survive a reload. We satisfy this trivially by deriving the state from a module-level `ref` that re-initialises to `false` whenever the JS bundle is freshly evaluated. There is no `localStorage` / `sessionStorage` write, no query-string mirroring, no IndexedDB record. A unit test SHALL assert that mounting `Sidebar.vue` in a fresh test environment produces a *visible* sidebar even when no chat activity has happened.

### D4. Apply uniformly to desktop and mobile

The mobile layout (under 768 px) makes the sidebar `position: static` and lets it flow below the chapter content. While streaming is active on mobile, hiding the sidebar leaves an empty vertical gap below the chapter — undesirable. To avoid the gap, the mobile rule SHALL also apply `display: none` (instead of `visibility: hidden`) when the hidden class is present, collapsing the gap. The desktop rule retains `visibility: hidden` to keep the right-column slot stable.

This means *one* class but *two* CSS rules — desktop and mobile via media query.

### D5. Test surface

Three behavioural tests cover the contract:

1. **Hides while loading**: mount `Sidebar.vue` with `isLoading = true`; assert `<aside>` carries the class and (via computed style or attribute) is hidden.
2. **Shows when done**: flip `isLoading` to `false`; assert class is removed.
3. **Always visible on fresh mount**: mount `Sidebar.vue` after re-importing `useChatApi` (simulating a page load); assert no hidden class is present even before any chat activity.

DOM stability (no unmount) is implicitly tested by the existing `ContentArea.test.ts` "moves plugin-sidebars to Sidebar" suite — that suite SHALL continue to pass unchanged.

## Risks / Trade-offs

- **Hidden but interactive**: A screen reader could still reach the sidebar's contents via the DOM tree even while `visibility: hidden`. Mitigation: `visibility: hidden` *does* remove the subtree from the accessibility tree per the CSSWG spec, so this is automatically handled.
- **Flash on stream start**: If the streaming request completes in <100 ms, the user might perceive a brief sidebar flash. Mitigation: not animating means the only "flash" is one render frame — imperceptible in practice. No timer-based debounce is added.
- **Plugin authors expecting visibility**: A plugin that explicitly checks `getBoundingClientRect()` for layout would see a zero-rect during hidden state and might mis-react. Mitigation: documented in the spec as expected behaviour; plugins should not rely on visibility while `chat:streaming` is active. Existing in-tree plugins do not exhibit this pattern (verified by code reading).
- **Mobile layout collapse**: D4 collapses the sidebar slot on mobile, which means content below it (if any) shifts up at stream start and shifts back down at stream end. Acceptable — and arguably better than a static blank gap.
