## Why

Three components (`StorySelector.vue`, `LoreEditor.vue`, `LoreBrowser.vue`) hardcode the dark-red background color `#1a0810` / its gradient variant instead of using the existing CSS custom property `var(--panel-bg)`. This breaks theme switching — switching to light or dark theme leaves these panels painted with the default theme's colour. Additionally, `PluginActionBar` renders (and runs its composable) even when `ChatInput` is hidden, which is visually inconsistent and wastes resources on pages where the chat interface is not available. Beyond these, many more hardcoded accent colours (`#b41e3c`, `rgba(180, 30, 60, …)`, `rgba(255, 100, 140, …)`, `#c23456`, `#ffd0dc`) exist in `base.css`, reader components, and plugin stylesheets — all locked to the default theme's palette.

## What Changes

- Replace all hardcoded `#1a0810` and `linear-gradient(145deg, #1a0810, #220c16)` occurrences in scoped component styles with the theme variable `var(--panel-bg)`.
  - `StorySelector.vue`: dropdown panel background
  - `LoreEditor.vue`: tag-suggestion list background, confirm-dialog background
  - `LoreBrowser.vue`: search results dropdown background
- Gate `PluginActionBar` rendering in `MainLayout.vue` with the same `v-if="showChatInput"` condition that already gates `ChatInput`, so the action bar only appears when the chat interface is visible. This intentionally narrows the effective visibility of `backend-only` buttons to match `last-chapter-backend` when the outer layout gate is applied. No existing plugin uses `backend-only`, so this is a non-breaking change in practice.
- Introduce 11 new CSS custom properties (`--selection-bg`, `--accent-glow`, `--accent-line`, `--text-hover`, `--pill-bg`, `--pill-hover-bg`, `--accent-shadow`, `--accent-border`, `--accent-inset`, `--accent-subtle`, `--accent-solid`) to `theme.css` and all three theme TOML files.
- Replace hardcoded accent colours in `base.css` (`::selection`, `pulse-glow` animation, `.variable-pill` classes) with theme variables.
- Replace hardcoded accent colours in 8 reader components (`QuickAddPage`, `ImportCharacterCardPage`, `ToolsMenu`, `ToolsLayout`, `SettingsLayout`, `PromptEditorMessageCard`, `LoreEditor`, `LoreBrowser`) with existing or new theme variables.
- Replace hardcoded accent colours in plugin stylesheets (`status/styles.css`, `options/styles.css`) with theme variables.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `theme-system`: Components that previously hardcoded `#1a0810` SHALL use `var(--panel-bg)` so all panels follow the active theme palette. Additionally, all accent-derived colours across `base.css`, reader components, and plugin stylesheets SHALL use theme CSS variables so the entire UI adapts correctly when switching themes.
- `plugin-action-buttons`: The action bar container in `MainLayout` SHALL only render when `showChatInput` is true, matching `ChatInput` visibility. The visibility filter requirement is also updated to document that `backend-only` is now effectively equivalent to `last-chapter-backend` due to the outer layout gate.

## Impact

- **Frontend styles**: 4 CSS declarations in 3 Vue components changed from literal values to `var(--panel-bg)`. ~35 additional CSS declarations across `base.css`, 8 components, and 2 plugin stylesheets changed from hardcoded accent values to theme variable references.
- **Theme definitions**: 11 new palette entries added to `theme.css` fallback and each theme `.toml` file.
- **Layout template**: 1 line change in `MainLayout.vue` adding `v-if`.
- **No API / backend / dependency changes.**
- **Risk**: Low — purely presentational + template gating; existing tests cover button visibility logic.
