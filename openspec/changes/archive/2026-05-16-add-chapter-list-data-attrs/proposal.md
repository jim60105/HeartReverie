## Why

Plugins need stable, semantic DOM selectors to discover chapter navigation elements and to mount floating panel UI without z-index collisions. Currently there are no data attributes on the chapter navigation area, and no shared container for plugin panels — each plugin must pick its own mount point and z-index, risking overlap with built-in sidebars and other plugins.

## What Changes

- Add `data-chapter-list` attribute to the chapter navigation controls container in `AppHeader.vue` (wrapping the 5 navigation elements: first/prev/progress/next/last) so plugins can locate the navigation area via `document.querySelector('[data-chapter-list]')`. This marks the navigation controls, not a full chapter list.
- Add `data-chapter-number="N"` to each of the 5 navigation elements within that container, giving plugins per-element anchors (e.g., for bookmark indicators on the current-chapter progress span).
- Add a shared `<div id="plugin-panel-slot">` element in `MainLayout.vue` for plugins to mount floating panels into, with a documented z-index tier that sits above content but below modal overlays (`PassphraseGate`, `ToastContainer`).
- **BREAKING**: DOM structure changes in `AppHeader` and `MainLayout`. No external consumers exist today, so no migration needed.

## Capabilities

### New Capabilities

- `chapter-list-data-attrs`: Data attributes on the chapter navigation controls (first/prev/progress/next/last — 5 elements, not a full chapter list) for plugin discovery and per-element anchoring.
- `plugin-panel-slot`: Shared panel mounting container with centralized z-index management for plugin floating UI.

### Modified Capabilities

- `page-layout`: The `MainLayout` grid gains the `#plugin-panel-slot` element, adding a new layer to the z-index stacking context.
- `vue-component-architecture`: `AppHeader` template changes to include data attributes on the chapter navigation section.

## Impact

- **Components**: `AppHeader.vue` (data attributes), `MainLayout.vue` (plugin panel slot).
- **Tests**: Existing `AppHeader` and `MainLayout` Vitest tests need updates to assert new attributes/elements.
- **Plugins**: Downstream consumers (e.g., `chapter-bookmark` plugin) can now rely on these DOM contracts.
- **No backend changes** — purely frontend SPA modifications.
