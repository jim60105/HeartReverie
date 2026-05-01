## ADDED Requirements

### Requirement: Editor textarea is the sole scroll container for template text

Within `PromptEditor.vue`, `.editor-textarea` SHALL be the only scroll container for the template content. The toolbar (`.editor-toolbar`) and variable pills row SHALL remain pinned at the top of the editor pane and SHALL NOT scroll when the user scrolls the textarea content. The editor's outer flex chain (`.editor-root` → `.editor-textarea-wrap` → `<textarea class="editor-textarea">`) SHALL guarantee that overflow stops at the textarea: `.editor-textarea-wrap` SHALL declare `flex: 1; min-height: 0; overflow: hidden`, and `.editor-textarea` SHALL keep `width: 100%; height: 100%; resize: none`, allowing the native `<textarea>` element to manage its own internal scroll for long content.

The page itself (the `PromptEditorPage.vue` route component and its ancestors up to `.settings-layout`) SHALL NOT scroll as a result of long textarea content. Pasting or typing content longer than the viewport SHALL produce textarea-internal scroll only. This page-level guarantee depends on the `:has(.editor-page)` cap defined in `settings-page` and is verified by manual browser smoke (see Decision 6 in design.md).

#### Scenario: Editor textarea wrap declares clip rules in the source

- **WHEN** `PromptEditor.vue`'s scoped style block is read as text
- **THEN** the `.editor-textarea-wrap` rule SHALL declare `flex: 1`, `min-height: 0`, and `overflow: hidden`
- **AND** the `.editor-textarea` rule SHALL declare `width: 100%`, `height: 100%`, and `resize: none`

#### Scenario: Toolbar stays pinned when textarea content overflows (manual smoke)

- **WHEN** the textarea contains text longer than its visible height and the user scrolls inside the textarea in a real browser
- **THEN** the editor toolbar (`.editor-toolbar`, including the "儲存" / "預覽 Prompt" buttons and variable pills) SHALL remain visible and at the same position relative to the viewport
- **AND** the textarea SHALL scroll its own content internally
- **AND** this scenario is verified by manual browser smoke (Happy DOM does not perform real layout)

#### Scenario: Long template does not scroll the page (manual smoke)

- **WHEN** the user pastes a template that is many times taller than the viewport into the editor in a real browser
- **THEN** the document body's `scrollTop` SHALL remain `0` and the body SHALL produce no vertical scrollbar
- **AND** the only element that scrolls in response to the user dragging the scrollbar near the textarea SHALL be the `<textarea class="editor-textarea">` itself
- **AND** this scenario is verified by manual browser smoke

#### Scenario: Textarea scroll does not affect preview scroll (no JS sync)

- **GIVEN** the preview pane is open alongside the editor
- **WHEN** test code mutates the textarea's `scrollTop` programmatically
- **THEN** `.preview-content`'s `scrollTop` SHALL remain at its prior value (proving no JS scroll-sync handler exists)
- **AND** the converse SHALL also hold: mutating `.preview-content`'s `scrollTop` SHALL NOT change the textarea's `scrollTop`
