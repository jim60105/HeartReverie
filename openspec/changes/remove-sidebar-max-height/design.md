## Context

`Sidebar.vue` renders the host `<aside class="sidebar">` used by `ContentArea.vue` to collect plugin-rendered `.plugin-sidebar` panels. A recent layout change removed the sidebar's sticky top offset while leaving `position: sticky` and the desktop `max-height: calc(100vh - var(--header-height) - 16px);` cap in place.

With no sticky anchor edge, the sidebar no longer pins to the viewport during document scroll. The remaining viewport-relative height cap therefore creates a nested scroll region inside an element that otherwise participates in the page flow. That is the mismatch this change resolves.

## Goals / Non-Goals

**Goals:**

- Remove the default desktop `.sidebar` max-height declaration from `Sidebar.vue`.
- Keep plugin relocation, hidden scrollbar styling, empty-sidebar collapse, and hide-during-stream behavior unchanged.
- Keep the mobile breakpoint behavior unchanged, including its explicit `max-height: none`.
- Update the `page-layout` contract so future work does not reintroduce the removed cap.

**Non-Goals:**

- No changes to `ContentArea.vue` relocation logic.
- No changes to plugin panel markup, plugin loading, or frontend hook APIs.
- No new layout abstraction or global CSS variable.
- No migration or backward-compatibility shim.

## Decisions

1. **Delete only the desktop max-height declaration.**

   The implementation should remove the single line `max-height: calc(100vh - var(--header-height) - 16px);` from the default `.sidebar` selector. The selector should continue to declare `position: sticky`, `overflow-y: auto`, and `scrollbar-width: none`.

   Alternative considered: replace the cap with `max-height: none`. That is noisier and unnecessary because the default CSS value is already `none`; the absence of the declaration is the clearer contract.

2. **Preserve the mobile override verbatim.**

   The mobile block currently declares `position: static`, `max-height: none`, and `overflow-y: visible`. Keeping it avoids accidental mobile regressions and makes the desktop deletion independent of mobile behavior.

   Alternative considered: delete `max-height: none` from the mobile block as redundant after the desktop removal. That would broaden the change and weaken the explicit mobile contract for no runtime benefit.

3. **Do not move scroll responsibility into `ContentArea.vue`.**

   The host sidebar should grow with its content. Plugins that need a bounded subregion, such as a thumbnail strip or lightbox side panel, should own those bounds in plugin CSS.

   Alternative considered: add a new wrapper around sidebar slot contents with an explicit scroll policy. That would change DOM structure and risk breaking plugin CSS selectors for a one-line layout fix.

## Risks / Trade-offs

- **Risk: very tall plugin sidebars increase document height.** Mitigation: this is the intended behavior after removing the internal cap; plugins can still define panel-local scroll containers where needed.
- **Risk: a future contributor re-adds the cap while adjusting sticky behavior.** Mitigation: the `page-layout` delta adds scenarios that assert the desktop selector has no viewport-relative max-height cap.
- **Risk: hidden scrollbar declarations become inert in the common case.** Mitigation: keep them because they are harmless and preserve behavior if a future style introduces vertical overflow on the aside.
