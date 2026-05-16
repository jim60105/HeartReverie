## ADDED Requirements

### Requirement: Plugin panel slot container

`MainLayout.vue` SHALL render a `<div id="plugin-panel-slot">` element as a direct child of the `.main-layout` root, positioned after the `<main>` element. This container serves as a shared mount point for plugin floating panels.

The container SHALL have the following CSS properties:

- `position: fixed` with `inset: 0` (covering the full viewport).
- `z-index: 100` — above content areas (z-index 10–20) and below modal-tier elements (`LoreEditor` at 1000, `ToastContainer`/`PassphraseGate` at 9999).
- `pointer-events: none` on the container itself so it does not intercept clicks on underlying content.
- `pointer-events: auto` on direct children (`#plugin-panel-slot > *`) so plugin panels remain interactive.

The container SHALL always be present in the DOM (not conditionally rendered) so plugins can mount into it at any time after the SPA boots.

#### Scenario: Plugin panel slot exists in the DOM

- **WHEN** `MainLayout` is rendered after authentication
- **THEN** `document.getElementById('plugin-panel-slot')` SHALL return the container element

#### Scenario: Plugin panel slot does not block content interaction

- **WHEN** the plugin panel slot is empty (no plugin panels mounted)
- **THEN** clicks on the chapter content, sidebar, header, and chat input SHALL pass through to those elements without interception

#### Scenario: Plugin panels inside the slot are interactive

- **WHEN** a plugin appends a `<div>` child element into `#plugin-panel-slot`
- **THEN** the child element SHALL receive pointer events (clicks, hover) normally

#### Scenario: Plugin panels render above content but below modals

- **WHEN** a plugin panel is mounted in `#plugin-panel-slot` and the `PassphraseGate` overlay or `ToastContainer` is also visible
- **THEN** the plugin panel SHALL appear below `PassphraseGate` (z-index 9999) and `ToastContainer` (z-index 9999)
- **AND** the plugin panel SHALL appear above `AppHeader` (z-index 10) and `StorySelector` (z-index 20)
