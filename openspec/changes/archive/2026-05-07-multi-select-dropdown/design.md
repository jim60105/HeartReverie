## Context

`PluginSettingsPage.vue` renders plugin settings dynamically from JSON Schema. For fields with `type: "array"` + `x-options-url`, it currently uses `<input>` bound to a `<datalist>` for suggestions. Selected items display as pill/tag chips with × remove buttons. The options are fetched at render time from the URL specified in `x-options-url`.

The datalist approach has fundamental browser limitations: inconsistent rendering across engines, no click-to-add (requires Enter), no styling control, no open/close affordance, and filter behavior that hides non-matching options entirely.

The project uses pure Vue 3 SFCs with scoped CSS and CSS variables for theming. No external UI library is used.

## Goals / Non-Goals

**Goals:**

- D1: Replace `<datalist>` with a custom dropdown panel that renders consistently across browsers
- D2: Click-to-add — clicking an option immediately adds it to the array
- D3: Type-to-filter — input text filters visible options in real time
- D4: Click-outside and Escape key dismiss the dropdown
- D5: Keyboard navigation — arrow keys to navigate options, Enter to select/add
- D6: Already-selected items are visually distinguished (dimmed) in the dropdown
- D7: Free-text entry preserved — Enter adds typed text even if not in the options list
- D8: Consistent theming via existing CSS variables

**Non-Goals:**

- Extracting a reusable component (keep changes inline in PluginSettingsPage.vue for now)
- Virtual scrolling for large option lists (options are fetched from plugin APIs, typically <50 items)
- Drag-to-reorder selected pills
- Multi-select checkboxes (use immediate add/remove pattern instead)

## Decisions

### D1: Custom `<div>` dropdown panel with `v-show`

Use a `<div class="dropdown-panel">` positioned absolutely below the input, controlled by `v-show` bound to a per-field reactive open state. The panel renders filtered options as clickable `<div>` items.

**Why:** `v-show` avoids DOM churn for frequently toggled panels. Absolute positioning with `z-index` ensures the panel overlays other fields. No teleport needed since the form is not inside an `overflow: hidden` container.

**Alternative considered:** Separate `<Teleport>` to body — rejected as over-engineering for a panel within a scrollable settings form.

### D2: Per-field reactive state via a Map keyed by field.key

Add reactive state `comboboxOpen: Record<string, boolean>` and `comboboxFilter: Record<string, string>` to track open/close and filter text per multi-combobox field.

**Why:** Multiple multi-combobox fields can exist on the same page (e.g., styles + VAE for sd-webui-image-gen). Each needs independent state.

### D3: Click-outside handler using document listener + closest()

Attach a single `mousedown` listener on `document` (registered on component mount, removed on unmount). If any dropdown is open and the event target's `closest('.multi-combobox')` is null, close all open dropdowns. This avoids wrapper ref issues in `v-for` rendering.

**Why:** Using `closest()` is robust regardless of how many multi-combobox fields exist. A single shared listener is simpler than per-field add/remove lifecycle. `mousedown` (not `click`) prevents the blur event race condition with option clicks.

**Alternative considered:** Per-field document listener managed on open/close — rejected because coordinating multiple listeners adds complexity and risks stale references in v-for.

### D4: Filtered options as a computed-like function

Create a helper function `getFilteredOptions(field)` that returns `field.options.filter(opt => opt.toLowerCase().includes(filterText))`. Already-selected options are included but marked with a CSS class for dimming.

**Why:** Including selected options (dimmed) rather than hiding them lets users see the full option set and understand what's already selected. Hiding them would cause confusing list jumps.

### D5: Keep dropdown open after selection

After clicking an option to add it, the dropdown remains open and input retains focus. This enables rapid multi-selection without repeated open gestures.

**Why:** Common pattern in tag/multi-select UIs (e.g., GitHub label picker). Closing after each selection would be tedious for adding multiple items.

### D6: Arrow key navigation with highlighted index

Track a `highlightIndex` per field. Arrow Up/Down move the index through filtered options. Enter on a highlighted option adds it. The highlighted option scrolls into view via `scrollIntoView({ block: 'nearest' })`.

**Why:** Accessibility and power-user efficiency. Standard combobox keyboard pattern (WAI-ARIA combobox).

### D7: Dropdown trigger on input focus or chevron click

Show the dropdown when the input receives focus or when a ▼ button is clicked. Opening one field's dropdown automatically closes any other open dropdown (only one open at a time). This provides a clear visual affordance that a dropdown exists.

**Why:** Focus-to-open is intuitive for keyboard users. The chevron button provides discoverability for mouse users. Single-open-at-a-time prevents visual clutter and simplifies listener management.

### D8: Input-row positioning anchor

The dropdown panel is positioned absolutely relative to an `.input-row` wrapper containing only the input + chevron button, NOT relative to the entire `.multi-combobox` wrapper (which also contains the tag chips above).

**Why:** When many tags are selected and wrap across lines, anchoring the dropdown to the full wrapper would place it far below the input. Anchoring to the input row ensures the dropdown always appears directly below where the user is typing.

## Risks / Trade-offs

- [Dropdown may be clipped by parent overflow] → The settings form uses standard overflow, not `overflow: hidden`, so this is not an issue. If future layout changes introduce clipping, a `<Teleport>` migration would be needed.
- [Large option lists may render slowly] → Plugin option lists are typically <50 items (model names, sampler names). No virtualization needed. If a plugin returns 500+ options, performance may degrade — acceptable given current usage patterns.
- [z-index conflicts with other overlays] → Use a z-index value (100) that sits above form elements but below modal dialogs. The settings page has no modals currently.
- [Accessibility: screen readers] → Adding `role="listbox"`, `role="option"`, and `aria-expanded` attributes provides basic ARIA support. Full WAI-ARIA combobox compliance is a future enhancement.
