# prompt-editor-message-cards — Delta spec for autoresize-prompt-and-chat-textareas

## ADDED Requirements

### Requirement: Card body textarea auto-resizes to content

The body `<textarea>` inside `PromptEditorMessageCard.vue` SHALL keep itself sized to the current `card.body` content on every change. Whenever the bound value updates (via direct typing, `v-model` mutation, the "插入變數" helper, or any future programmatic mutation), the textarea SHALL recompute its height in the next animation frame so the entire body is visible without internal scrolling.

The textarea SHALL never shrink below a floor of three text lines computed from its resolved `line-height`, vertical padding, and vertical border-width (with a `1.2 × font-size` fallback when `line-height` resolves to `normal`). The textarea's CSS `resize` property SHALL be `none` (the JS-driven height is now authoritative; a manual handle would conflict with the auto-fit on the next change).

When the viewport width changes, the textarea SHALL re-measure and re-apply its height (a width change can re-wrap text and change the required line count).

#### Scenario: Long body renders without internal scroll

- **WHEN** a `PromptEditorMessageCard` is mounted with a `card.body` containing 30 newline-separated lines
- **THEN** after the initial mount frame the textarea's `clientHeight` SHALL be at least the three-line floor AND large enough to render all 30 lines without internal scrolling

#### Scenario: Editing the body re-fits the height

- **WHEN** the user types additional content into the body, taking it from 5 lines to 25 lines
- **THEN** after the keystroke event flushes, the textarea's `clientHeight` SHALL grow to render the 25 lines without internal scrolling

#### Scenario: Three-line floor for a short body

- **WHEN** a `PromptEditorMessageCard` is mounted with a `card.body` of `"hi"`
- **THEN** the textarea's `clientHeight` SHALL equal the three-line floor

#### Scenario: Inserting a variable re-fits the height

- **WHEN** the user invokes the "插入變數" helper to insert `{{ user_input }}` into a body that grows the wrapped line count past the current height
- **THEN** the textarea's `clientHeight` SHALL recompute and grow to fit the new content

## MODIFIED Requirements

### Requirement: Message card component UI

The frontend SHALL provide a `PromptEditorMessageCard.vue` Single File Component rendered by `PromptEditor.vue` for each card in cards mode. Each card SHALL render in a visually distinct container with:

- A header row containing a "傳送者" (Sender) label, a `<select>` element bound via `v-model` to `card.role` whose options are exactly `system | user | assistant` (option text in zh-TW: "系統" / "使用者" / "助理"; underlying value is the English keyword), and the up/down/delete action buttons aligned to the right.
- A body editor: a `<textarea>` bound via `v-model` to `card.body`. Its height SHALL be JS-managed per the "Card body textarea auto-resizes to content" requirement above (initial floor of three lines, growing automatically as the body grows). The CSS `resize` property SHALL be `none` (no manual resize handle, since the height tracks content). The textarea SHALL use a monospace font face matching the existing raw-text editor.
- An "插入變數" (Insert variable) helper above the textarea: a small dropdown/button trigger that, when activated, displays the variable list (same source as the global pills in raw-text fallback mode) and on selection inserts `{{ variable_name }}` at the textarea's current caret position via `HTMLTextAreaElement.setRangeText()`. After insertion the textarea SHALL retain focus and the caret SHALL be positioned immediately after the inserted text.

The component SHALL emit named events (or use `defineModel`) for: role change, body change, request-up, request-down, request-delete. The parent (`PromptEditor.vue`) maintains the `cards` array.

#### Scenario: Card renders role select with three options

- **WHEN** a `PromptEditorMessageCard` renders for a card with `role: "user"`
- **THEN** the `<select>` SHALL contain exactly three `<option>` elements with values `"system"`, `"user"`, `"assistant"` and zh-TW labels, and the `<select>`'s value SHALL be `"user"`

#### Scenario: Editing role updates the card

- **WHEN** the user changes the `<select>` from `"user"` to `"assistant"`
- **THEN** the bound `card.role` SHALL update to `"assistant"` and the parent `cards` array SHALL reflect the change

#### Scenario: Editing body updates the card

- **WHEN** the user types text into the body `<textarea>`
- **THEN** the bound `card.body` SHALL update on every keystroke (standard `v-model`)

#### Scenario: Insert-variable helper inserts at caret

- **WHEN** the user places the textarea caret at character offset N within `card.body` and selects a variable named `user_input` from the helper
- **THEN** the textarea content SHALL contain `{{ user_input }}` inserted at offset N (with everything before N preserved and everything from N onward pushed right), the caret SHALL be positioned immediately after the inserted text, AND focus SHALL remain on the textarea

#### Scenario: Up button disabled on first card

- **WHEN** a `PromptEditorMessageCard` renders as the first card in the list
- **THEN** the up button SHALL be disabled and SHALL have `aria-label="上移"`

#### Scenario: Down button disabled on last card

- **WHEN** a `PromptEditorMessageCard` renders as the last card in the list
- **THEN** the down button SHALL be disabled and SHALL have `aria-label="下移"`

#### Scenario: Body textarea has no manual resize handle

- **WHEN** the body `<textarea>` is rendered
- **THEN** its computed `resize` CSS property SHALL be `none`
