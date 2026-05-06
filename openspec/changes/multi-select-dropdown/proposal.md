## Why

The current multi-combobox field type in `PluginSettingsPage.vue` relies on `<datalist>` for suggestions, which suffers from inconsistent cross-browser rendering, requires an extra Enter keypress to add selections, cannot be styled, and provides no visual "open dropdown" affordance. This creates a confusing UX for plugin settings that use `type: "array"` + `x-options-url` (e.g., sd-webui-image-gen's styles and VAE fields).

## What Changes

- Replace the browser-native `<datalist>` with a custom dropdown panel component rendered as a styled `<div>` overlay
- Add click-to-add: clicking an option in the dropdown immediately adds it to the array (no Enter required)
- Add a filter/search mechanism within the dropdown as the user types
- Already-selected options are visually dimmed/hidden in the dropdown
- Dropdown is dismissible by clicking outside or pressing Escape
- Add keyboard navigation (arrow keys to move through options, Enter to select/add, Escape to close)
- Retain free-text entry (pressing Enter adds whatever is typed, even if not in the options list)
- Keep existing pills/tags display with × remove buttons

## Capabilities

### New Capabilities

- `multi-select-dropdown`: Custom dropdown panel for multi-combobox fields replacing browser-native datalist with click-to-add, filter, keyboard navigation, and consistent cross-browser styling

### Modified Capabilities

## Impact

- `reader-src/src/components/PluginSettingsPage.vue` — template, script, and scoped CSS changes for the multi-combobox section
- No backend changes required
- No new dependencies (pure Vue 3 + scoped CSS)
- Affects any plugin using `settingsSchema` with `type: "array"` + `x-options-url` fields
