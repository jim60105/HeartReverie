## ADDED Requirements

### Requirement: Preview content is the sole scroll container for rendered prompt text

Within `PromptPreview.vue`, `.preview-content` SHALL be the only scroll container for the rendered prompt text. The preview header (`.preview-header`, containing "📝 Prompt Preview"), the meta row (`.preview-meta`), and the error row (`.preview-error`, when present) SHALL remain pinned at the top of the preview pane and SHALL NOT scroll when the user scrolls the rendered content.

The preview's outer flex chain (`.preview-root` → `.preview-content`) SHALL guarantee that overflow stops at `.preview-content`. `.preview-root` SHALL declare `flex: 1; min-height: 0; overflow: hidden`. `.preview-content` SHALL declare `flex: 1; overflow: auto; min-height: 0; margin: 0; box-sizing: border-box`. The `margin: 0` declaration is required because `<pre>` carries a default UA stylesheet margin that would otherwise leak through the flex clip; `min-height: 0` makes the clip contract explicit; `box-sizing: border-box` is defensive against future padding additions.

The preview pane SHALL NOT cause the page itself to scroll, regardless of the length of the rendered prompt. The preview's scroll position SHALL be independent of the editor textarea's scroll position — there SHALL be no JavaScript handler that mutates one container's `scrollTop` in response to the other's scroll event.

#### Scenario: Preview content declares hardened clip rules in the source

- **WHEN** `PromptPreview.vue`'s scoped style block is read as text
- **THEN** the `.preview-content` rule SHALL declare `flex: 1`, `overflow: auto`, `min-height: 0`, `margin: 0`, and `box-sizing: border-box`
- **AND** the `.preview-root` rule SHALL declare `flex: 1`, `min-height: 0`, and `overflow: hidden`

#### Scenario: Preview header stays pinned when rendered content overflows (manual smoke)

- **WHEN** the rendered prompt is taller than the preview pane's visible height and the user scrolls inside `.preview-content` in a real browser
- **THEN** `.preview-header`, `.preview-meta`, and `.preview-error` (if present) SHALL remain visible and at the same position relative to the viewport
- **AND** `.preview-content` SHALL scroll its own rendered text internally
- **AND** this scenario is verified by manual browser smoke (Happy DOM does not perform real layout)

#### Scenario: Long preview does not scroll the page (manual smoke)

- **WHEN** the rendered prompt is many times taller than the viewport and the preview pane is open in a real browser
- **THEN** the document body's `scrollTop` SHALL remain `0` and the body SHALL produce no vertical scrollbar
- **AND** the only element that scrolls in response to the user dragging the scrollbar near the preview SHALL be `.preview-content` itself
- **AND** this scenario is verified by manual browser smoke

#### Scenario: Preview scroll does not affect editor textarea scroll (no JS sync)

- **GIVEN** the preview pane is open alongside the editor
- **WHEN** test code mutates `.preview-content`'s `scrollTop` programmatically
- **THEN** the editor textarea's `scrollTop` SHALL remain at its prior value
- **AND** the converse SHALL also hold (covered in `prompt-editor` spec)
