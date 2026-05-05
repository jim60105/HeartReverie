## Why

Three components (`StorySelector.vue`, `LoreEditor.vue`, `LoreBrowser.vue`) hardcode the dark-red background color `#1a0810` / its gradient variant instead of using the existing CSS custom property `var(--panel-bg)`. This breaks theme switching — switching to light or dark theme leaves these panels painted with the default theme's colour. Additionally, `PluginActionBar` renders (and runs its composable) even when `ChatInput` is hidden, which is visually inconsistent and wastes resources on pages where the chat interface is not available.

## What Changes

- Replace all hardcoded `#1a0810` and `linear-gradient(145deg, #1a0810, #220c16)` occurrences in scoped component styles with the theme variable `var(--panel-bg)`.
  - `StorySelector.vue`: dropdown panel background
  - `LoreEditor.vue`: tag-suggestion list background, confirm-dialog background
  - `LoreBrowser.vue`: search results dropdown background
- Gate `PluginActionBar` rendering in `MainLayout.vue` with the same `v-if="showChatInput"` condition that already gates `ChatInput`, so the action bar only appears when the chat interface is visible. This intentionally narrows the effective visibility of `backend-only` buttons to match `last-chapter-backend` when the outer layout gate is applied. No existing plugin uses `backend-only`, so this is a non-breaking change in practice.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `theme-system`: Components that previously hardcoded `#1a0810` SHALL use `var(--panel-bg)` so all panels follow the active theme palette.
- `plugin-action-buttons`: The action bar container in `MainLayout` SHALL only render when `showChatInput` is true, matching `ChatInput` visibility. The visibility filter requirement is also updated to document that `backend-only` is now effectively equivalent to `last-chapter-backend` due to the outer layout gate.

## Impact

- **Frontend styles**: 4 CSS declarations across 3 Vue components change from literal values to variable references.
- **Layout template**: 1 line change in `MainLayout.vue` adding `v-if`.
- **No API / backend / dependency changes.**
- **Risk**: Low — purely presentational + template gating; existing tests cover button visibility logic.
