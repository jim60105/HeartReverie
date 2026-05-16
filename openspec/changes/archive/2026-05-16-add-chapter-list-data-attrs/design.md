## Context

The reader SPA (`reader-src/`) has no convention for plugins to discover chapter navigation DOM or to mount floating panels. Plugins that need chapter-level DOM anchors (e.g., a bookmark indicator next to each chapter button) must scrape class names, which are unstable. Plugins that render floating panels pick ad-hoc z-index values, risking collisions with `AppHeader` (z-index 10), `StorySelector` (20), `LoreEditor` (1000), or `ToastContainer`/`PassphraseGate` (9999).

## Goals / Non-Goals

**Goals:**

- Provide stable, semantic data attributes on the chapter navigation area for plugin DOM queries.
- Provide a single shared mount point for plugin floating panels with a well-defined z-index tier.

**Non-Goals:**

- Building a chapter list dropdown/sidebar (this adds discovery attributes to the existing navigation).
- Managing plugin panel lifecycle (plugins mount/unmount their own content in the slot).
- Backward compatibility with prior DOM structure (0 external consumers).

## Decisions

### D1: Data attributes on AppHeader chapter navigation controls

The `<template v-if="hasChapters">` block in `AppHeader.vue` will be wrapped in a `<nav data-chapter-list>` element. This marks the 5 navigation controls (first, prev, progress span, next, last) — it is **not** a full chapter list/table-of-contents. Each navigation element receives `data-chapter-number` — the first/prev buttons get the target chapter number they navigate to, the progress span gets the current chapter number, and next/last buttons get their target. This gives plugins like `chapter-bookmark` a stable `[data-chapter-list]` selector and per-element `[data-chapter-number="N"]` anchors.

Because the `<nav>` wrapper becomes a flex child of `.header-row` (replacing the 5 individual flex children), it must use `display: contents` or `display: flex; align-items: center; gap: inherit` to preserve the existing flex layout. `display: contents` is preferred for simplicity — it makes the `<nav>` invisible to flex layout so its children remain direct flex participants.

**Alternative considered:** Adding attributes to `MainLayout` or `ContentArea` instead. Rejected because the chapter navigation lives in `AppHeader` and that's where plugins need anchors for indicators.

### D2: Plugin panel slot in MainLayout

A `<div id="plugin-panel-slot">` will be added as a direct child of `.main-layout` in `MainLayout.vue`, after `<main>`. It uses `position: fixed` (or `absolute` relative to the layout) and a z-index of **100** — above content and sidebar (10–20) but well below modals like `LoreEditor` (1000), `ToastContainer` (9999), and `PassphraseGate` (9999). The element is empty by default; plugins append their panel DOM into it.

**Alternative considered:** Using a Vue `<Teleport>` target. Rejected because plugin panels are rendered as raw HTML strings via `frontend.js`, not Vue components — `<Teleport>` requires Vue component context.

### D3: CSS containment for plugin-panel-slot

The `#plugin-panel-slot` will have `pointer-events: none` on the container itself (so it doesn't block clicks on content below) and `pointer-events: auto` on direct children (the actual plugin panels). This is a common pattern for overlay containers.

**Scoping caveat:** `MainLayout.vue` uses `<style scoped>`. The container rule (`#plugin-panel-slot { pointer-events: none }`) works fine in scoped CSS because the element is part of the Vue template. However, the child selector (`#plugin-panel-slot > * { pointer-events: auto }`) will NOT match plugin-appended DOM because those children lack Vue's scoped attribute (`data-v-xxxxx`). This rule MUST use `:deep()` (i.e., `#plugin-panel-slot > :deep(*) { pointer-events: auto }`) or be placed in an unscoped `<style>` block.

## Risks / Trade-offs

- **[Risk] Plugin panels may still set their own z-index** → Mitigation: Document the z-index tier (100) in the spec; plugins that override it do so at their own risk.
- **[Risk] Data attribute contract becomes a public API** → Mitigation: Spec the attribute names so they can be versioned if needed. Currently 0 consumers, so low risk.
- **[Trade-off] `data-chapter-number` on nav buttons reflects target chapter, not a full chapter list** → Acceptable for the bookmark use case; a full chapter list UI is out of scope.
