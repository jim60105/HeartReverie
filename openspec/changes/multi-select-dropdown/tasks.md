## 1. Reactive State & Data

- [x] 1.1 Add reactive state objects `comboboxOpen: Record<string, boolean>`, `comboboxFilter: Record<string, string>`, and `comboboxHighlight: Record<string, number>` for per-field dropdown open/close, filter text, and keyboard highlight index
- [x] 1.2 Bind input value to `comboboxFilter[field.key]` via `:value` and update on `@input` (controlled input pattern); clear both reactive filter AND DOM input on click-to-add and Enter-to-add
- [x] 1.3 Add helper function `getFilteredOptions(field)` that returns options filtered by `comboboxFilter[field.key]` (case-insensitive substring match)
- [x] 1.4 Add helper function `isOptionSelected(field, opt)` that checks if opt is already in `getArrayValue(field.key)`
- [x] 1.5 Add helper function `openCombobox(field)` that sets open=true for the given field AND closes all other open comboboxes (only one dropdown open at a time)

## 2. Template — Replace Datalist with Custom Dropdown

- [x] 2.1 Remove `<datalist>` element and `list` attribute from the multi-combobox input
- [x] 2.2 Wrap input + chevron button in an `.input-row` container (dropdown is positioned relative to this row, not the full tag list above)
- [x] 2.3 Add ▼ chevron button after the input as a dropdown toggle affordance
- [x] 2.3 Add `<div class="dropdown-panel" v-show="comboboxOpen[field.key] && field.options.length">` below the input containing filtered option items
- [x] 2.4 Each option item renders as `<div class="dropdown-option">` with click handler to add, and a dimmed class when already selected
- [x] 2.5 Add `role="listbox"` to dropdown panel and `role="option"` to each option item for basic ARIA support

## 3. Interaction Handlers

- [x] 3.1 Implement click-to-add handler: clicking a dropdown option calls `addToArray(field.key, opt)`, clears filter text, resets highlight index, keeps dropdown open
- [x] 3.2 Prevent adding duplicates: if `isOptionSelected(field, opt)` is true, the click handler does nothing
- [x] 3.3 Implement open-on-focus: `@focus` on input sets `comboboxOpen[field.key] = true`
- [x] 3.4 Implement chevron button click: opens dropdown and focuses the input
- [x] 3.5 Implement click-outside dismiss: use `event.target.closest('.multi-combobox')` check in a shared document `mousedown` listener (avoids wrapper ref issues in v-for); close all open dropdowns when click is outside any combobox
- [x] 3.6 Implement Escape key handler: `@keydown.escape` closes dropdown, retains input focus
- [x] 3.7 Update existing Enter handler: if highlight index is valid (user navigated with arrows), add highlighted option; otherwise add typed text from filter; clear input and filter text after adding; reset highlight to -1

## 4. Keyboard Navigation

- [x] 4.1 Implement `@keydown.down` handler: increment `comboboxHighlight[field.key]`, wrap at end of filtered list, open dropdown if closed
- [x] 4.2 Implement `@keydown.up` handler: decrement highlight index, wrap to last item from first
- [x] 4.3 Scroll highlighted option into view using `scrollIntoView({ block: 'nearest' })` via template ref
- [x] 4.4 Reset highlight index to -1 when filter text changes

## 5. Scoped CSS

- [x] 5.1 Add `.dropdown-panel` styles: `position: absolute`, `z-index: 100`, `max-height: 200px`, `overflow-y: auto`, border, background using `var(--bg-*)` and `var(--border-*)` CSS variables
- [x] 5.2 Add `.dropdown-option` styles: padding, cursor pointer, hover highlight using `var(--bg-hover)` or similar theme variable
- [x] 5.3 Add `.dropdown-option.dimmed` styles: reduced opacity or muted text color for already-selected items
- [x] 5.4 Add `.dropdown-option.highlighted` styles: background highlight for keyboard-navigated item
- [x] 5.5 Add `.chevron-btn` styles: inline button with ▼ character, matching input height, themed border/background
- [x] 5.6 Ensure `.multi-combobox` wrapper has `position: relative` for absolute dropdown positioning

## 6. Validation

- [x] 6.1 Run `deno task build:reader` — frontend builds successfully with no TypeScript errors
- [x] 6.2 Run `deno test` — all backend tests pass (no regressions)
- [x] 6.3 Run frontend tests in `reader-src/` if they exist (vitest)
- [x] 6.4 Browser test: verify dropdown appears on sd-webui-image-gen settings page for styles and VAE fields
- [x] 6.5 Browser test: click an option adds it immediately without pressing Enter
- [x] 6.6 Browser test: typing filters the dropdown options in real time
- [x] 6.7 Browser test: clicking outside or pressing Escape closes the dropdown
- [x] 6.8 Browser test: arrow keys navigate options, Enter selects highlighted option
- [x] 6.9 Browser test: already-selected options appear dimmed in dropdown
