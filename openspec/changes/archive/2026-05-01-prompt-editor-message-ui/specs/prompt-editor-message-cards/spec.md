# Prompt Editor Message Cards (delta)

## ADDED Requirements

### Requirement: Message card model

The frontend SHALL define a `MessageCard` type in `reader-src/src/types/index.ts` shaped exactly:

```ts
type MessageCard = {
  id: string;          // frontend-only stable key for v-for; never persisted
  role: "system" | "user" | "assistant";
  body: string;        // raw Vento source between {{ message }} and {{ /message }}
};
```

`id` SHALL be generated client-side via `crypto.randomUUID()` when a card is created (either by the parser or by `addCard()`). The `id` field SHALL NOT be written to disk by `serializeMessageCards()`. The `role` field SHALL be constrained at the type level to the same allow-list used by the `{{ message }}` Vento tag.

#### Scenario: Card type declared

- **WHEN** `reader-src/src/types/index.ts` is inspected
- **THEN** it SHALL export a `MessageCard` type with exactly the fields `id` (string), `role` (the union `"system" | "user" | "assistant"`), and `body` (string)

#### Scenario: Card id is a UUID assigned at creation

- **WHEN** the parser produces a card from a `{{ message }}` block, OR `addCard()` appends a new card
- **THEN** the resulting card's `id` SHALL be a freshly generated UUID via `crypto.randomUUID()` and SHALL be unique within the current `cards` array

### Requirement: Template parser

The frontend SHALL provide a pure function `parseSystemTemplate(source: string): { cards: MessageCard[] | null; parseError: string | null; topLevelContentDropped: boolean }` in `reader-src/src/lib/template-parser.ts`.

The parser SHALL walk the source character-by-character, tracking lexer states for: outside any expression, inside a Vento expression (`{{` … `}}`), inside a Vento comment (`{{# … #}}`), and inside a single- or double-quoted string literal that appears within an expression. The parser SHALL recognise `{{ message "<role>" }}` openers and `{{ /message }}` closers ONLY at the top level (i.e. not inside an already-open `{{ message }}` block).

The parser is intentionally a minimal, conservative scanner — NOT a full Vento parser. It therefore SHALL NOT attempt to interpret arbitrary JavaScript inside expressions. To avoid silently mis-parsing valid Vento templates that exceed its lexer's coverage, the parser SHALL detect the following unsupported constructs and SHALL fail fast with a parse error (which the editor surfaces as raw-text fallback):

- A JS-expression escape opener `{{> ` (Vento's "JavaScript expression" mode, where the body is JavaScript that the simple scanner cannot tokenise without backtick / regex / nested-brace handling).
- An `{{ echo }}` opener (Vento's raw-block mode, in which the contents until `{{ /echo }}` are NOT parsed and could legally contain `{{ message }}`-shaped text that must not be treated as a tag).
- An identifier-role message opener (e.g. `{{ message dynamic_role }}` — valid per the `multi-message-prompt-template` spec but unrepresentable in cards mode).

For each balanced top-level message pair, the parser SHALL capture the role string literal (the only role form supported in cards mode is a double-quoted string literal `"system" | "user" | "assistant"`) and the body. **Body extraction follows the canonical-delimiter model**: the parser SHALL strip exactly one leading `\n` (or `\r\n`) immediately after the opener's `}}` if present, and exactly one trailing `\n` (or `\r\n`) immediately before the closer's `{{` if present. All other content between opener and closer (including additional newlines, leading/trailing spaces, and the full body) SHALL be captured verbatim into `card.body`. Bodies retain their internal line endings (LF or CRLF) byte-for-byte; the serialiser (see "Template serialiser") always uses LF for delimiter newlines but preserves whatever line endings the body carries. The parser SHALL accept Vento trim markers on message tags (`{{- message "..." -}}` and `{{- /message -}}`) — they are parsed as ordinary openers/closers; the serialiser does NOT re-emit them (lossy normalisation).

Top-level content (text outside any `{{ message }}` block) SHALL be handled per the lossy-normalize rule:
- Any non-whitespace text appearing BEFORE the first `{{ message }}` block SHALL be coalesced (trimmed of outer whitespace) into a single leading `system` card, prepended to the cards array.
- Any non-whitespace text appearing BETWEEN or AFTER `{{ message }}` blocks SHALL be discarded; the parser SHALL set `topLevelContentDropped = true`.
- A source that contains NO `{{ message }}` blocks AND non-whitespace top-level content SHALL produce exactly one leading `system` card with that content as its body, and `topLevelContentDropped` SHALL be `false` (no content was lost — it became the system card).
- A source that is empty or whitespace-only SHALL produce `cards: []` with `topLevelContentDropped: false` and `parseError: null`.

The parser SHALL return `{ cards: null, parseError: <zh-TW reason>, topLevelContentDropped: false }` on any of:
- An unbalanced opener/closer pair.
- A role string outside the allow-list `{ "system", "user", "assistant" }`.
- A nested `{{ message }}` opener inside another `{{ message }}` block.
- An opener with malformed syntax that the scanner cannot recover from.
- An identifier-role opener (per the unsupported-constructs list above) — error reason "動態角色訊息標籤需使用純文字模式編輯".
- A JS-expression escape (`{{> …`) anywhere in the source — error reason "偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯".
- An `{{ echo }}` block anywhere in the source — error reason "偵測到 echo 區塊，需使用純文字模式編輯".

When the parser succeeds with `cards: []` (empty/whitespace source), the editor SHALL render an empty placeholder card per the Editor UI requirement.

#### Scenario: Round-trip stability for canonical templates

- **WHEN** `parseSystemTemplate()` is run on the output of `serializeMessageCards(cards)` for any `cards: MessageCard[]` whose roles are in the allow-list and whose bodies contain no `{{ message }}` substrings outside Vento strings/comments and no JS-escape / echo / identifier-role constructs
- **THEN** the parser SHALL produce a `cards` array equal to the input modulo `id` regeneration

#### Scenario: Parser ignores `{{ message }}` inside string literals

- **WHEN** the source contains `{{ "{{ message \"user\" }}" }}` as a Vento string literal
- **THEN** the parser SHALL NOT treat it as an opener; the surrounding template SHALL parse normally

#### Scenario: Parser ignores `{{ message }}` inside Vento comments

- **WHEN** the source contains `{{# {{ message "user" }} should-not-match #}}`
- **THEN** the parser SHALL NOT treat the inner text as an opener

#### Scenario: Parser rejects unbalanced openers

- **WHEN** the source contains `{{ message "user" }}` with no matching `{{ /message }}`
- **THEN** the parser SHALL return `{ cards: null, parseError: <zh-TW reason mentioning unbalanced tags>, topLevelContentDropped: false }`

#### Scenario: Parser rejects unknown roles

- **WHEN** the source contains `{{ message "tool" }}…{{ /message }}`
- **THEN** the parser SHALL return `{ cards: null, parseError: <zh-TW reason naming the rejected role>, topLevelContentDropped: false }`

#### Scenario: Parser rejects nested message tags

- **WHEN** the source contains a `{{ message }}` opener nested inside another open `{{ message }}` block
- **THEN** the parser SHALL return `{ cards: null, parseError: <zh-TW reason mentioning nesting>, topLevelContentDropped: false }`

#### Scenario: Parser rejects identifier-role openers

- **WHEN** the source contains `{{ message dynamic_role }}…{{ /message }}` (an identifier rather than a string literal in the role position — valid per the `multi-message-prompt-template` spec but unrepresentable as a card)
- **THEN** the parser SHALL return `{ cards: null, parseError: "動態角色訊息標籤需使用純文字模式編輯", topLevelContentDropped: false }`

#### Scenario: Parser rejects JavaScript-expression escapes

- **WHEN** the source contains `{{> someJsExpression() }}` anywhere
- **THEN** the parser SHALL return `{ cards: null, parseError: "偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯", topLevelContentDropped: false }`

#### Scenario: Parser rejects echo blocks

- **WHEN** the source contains `{{ echo }}…{{ /echo }}` anywhere (Vento's raw-block syntax that legally contains arbitrary `{{ message }}`-shaped text the simple scanner cannot disambiguate)
- **THEN** the parser SHALL return `{ cards: null, parseError: "偵測到 echo 區塊，需使用純文字模式編輯", topLevelContentDropped: false }`

#### Scenario: Parser accepts trim markers on message tags

- **WHEN** the source contains `{{- message "system" -}}body{{- /message -}}`
- **THEN** the parser SHALL produce one `system` card with body `"body"`; the trim markers are accepted and not preserved in the parsed card (the serialiser does not re-emit them)

#### Scenario: Parser strips serialiser-inserted boundary newlines

- **WHEN** the source contains `'{{ message "system" }}\nS\n{{ /message }}'`
- **THEN** the produced card SHALL have `body: "S"` (one leading and one trailing newline stripped per the canonical-delimiter model)

#### Scenario: Parser preserves body line endings beyond the canonical boundary newlines

- **WHEN** the source contains `'{{ message "system" }}\n\n S \n\n{{ /message }}'`
- **THEN** the produced card SHALL have `body: "\n S \n"` (only one leading and one trailing newline stripped; the remaining newlines and spaces are preserved verbatim)

#### Scenario: Parser preserves CRLF in body content

- **WHEN** the source contains `'{{ message "system" }}\r\nline1\r\nline2\r\n{{ /message }}'`
- **THEN** the produced card SHALL have `body: "line1\r\nline2"` (one leading `\r\n` and one trailing `\r\n` stripped per the canonical-delimiter model; the inner `\r\n` between `line1` and `line2` is preserved)

#### Scenario: Parser coalesces leading top-level content into a system card

- **WHEN** the source begins with non-whitespace text (e.g. `"Hello\n{{ message \"user\" }}…{{ /message }}"`)
- **THEN** the parser SHALL produce a `system` card whose body is `"Hello"` as the first element of the returned `cards` array, followed by the parsed user card, AND `topLevelContentDropped` SHALL be `false`

#### Scenario: Parser drops trailing top-level content with the warning flag

- **WHEN** the source contains non-whitespace text AFTER a `{{ /message }}` closer (e.g. `"{{ message \"system\" }}…{{ /message }}\n\nleftover-text"`)
- **THEN** the parser SHALL discard the trailing text from the produced cards AND SHALL set `topLevelContentDropped` to `true`

#### Scenario: Parser drops inter-block top-level content with the warning flag

- **WHEN** the source contains non-whitespace text BETWEEN two `{{ message }}` blocks (e.g. `"{{ message \"system\" }}…{{ /message }}\n\nbetween-text\n\n{{ message \"user\" }}…{{ /message }}"`)
- **THEN** the parser SHALL discard the inter-block text and produce two cards (system + user), AND `topLevelContentDropped` SHALL be `true`

#### Scenario: Parser maps a no-message non-whitespace source to a single system card

- **WHEN** the source contains non-whitespace top-level content AND no `{{ message }}` blocks at all (e.g. a legacy single-text template loaded after upgrade)
- **THEN** the parser SHALL return `{ cards: [{ id, role: "system", body: <trimmed source> }], parseError: null, topLevelContentDropped: false }`

#### Scenario: Empty source produces empty cards with no error

- **WHEN** the source is empty or whitespace-only
- **THEN** the parser SHALL return `{ cards: [], parseError: null, topLevelContentDropped: false }`

### Requirement: Template serialiser

The frontend SHALL provide a pure function `serializeMessageCards(cards: MessageCard[]): string` in `reader-src/src/lib/template-parser.ts`. The serialiser SHALL emit one Vento block per card in array order, using the exact format `{{ message "<role>" }}\n<body>\n{{ /message }}`. Adjacent blocks SHALL be joined by a single blank line (i.e. `"\n\n"` between the closer of one block and the opener of the next). The output SHALL end with a trailing newline.

The serialiser SHALL NOT mutate or escape the body — it is written verbatim. The serialiser SHALL ALWAYS double-quote the role literal. If any card has a `role` outside the allow-list, the serialiser SHALL throw a `RangeError` with a message identifying the offending card index; the caller is expected to catch this and surface an inline error in the UI rather than swallowing it.

The serialiser SHALL NOT emit any wrapping prelude or coda — the output represents the entire `system.md` content.

#### Scenario: Serialiser emits canonical block format

- **WHEN** `serializeMessageCards([{id, role: "system", body: "S"}, {id, role: "user", body: "U"}])` is called
- **THEN** the returned string SHALL equal `'{{ message "system" }}\nS\n{{ /message }}\n\n{{ message "user" }}\nU\n{{ /message }}\n'` exactly (a single trailing newline)

#### Scenario: Serialiser preserves bodies verbatim

- **WHEN** a card body contains Vento expressions (e.g. `"Hello {{ user_input }} world"`) or arbitrary whitespace (`"\n\n  spaced  \n\n"`)
- **THEN** the serialised block SHALL include that body byte-for-byte between the opener-newline and the closer-newline

#### Scenario: Serialiser rejects invalid role

- **WHEN** any card's `role` is not in `{ "system", "user", "assistant" }`
- **THEN** the serialiser SHALL throw `RangeError` whose message identifies the offending card index

#### Scenario: Empty cards array serialises to empty string

- **WHEN** `serializeMessageCards([])` is called
- **THEN** the returned string SHALL be `""` (the empty string)

### Requirement: Message card component UI

The frontend SHALL provide a `PromptEditorMessageCard.vue` Single File Component rendered by `PromptEditor.vue` for each card in cards mode. Each card SHALL render in a visually distinct container with:

- A header row containing a "傳送者" (Sender) label, a `<select>` element bound via `v-model` to `card.role` whose options are exactly `system | user | assistant` (option text in zh-TW: "系統" / "使用者" / "助理"; underlying value is the English keyword), and the up/down/delete action buttons aligned to the right.
- A body editor: a `<textarea>` bound via `v-model` to `card.body`, with `min-height` sufficient to show approximately six rows, `resize: vertical` so the user can expand it for long content, and a monospace font face matching the existing raw-text editor.
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

### Requirement: Card actions

The `usePromptEditor` composable SHALL implement the card-list manipulation helpers as follows. Each helper SHALL operate on the in-memory `cards` array (no network calls) and SHALL leave dirty tracking to recompute reactively.

- `addCard()`: appends a new `MessageCard` to the end of the array with `id = crypto.randomUUID()`, `role = "system"`, and `body = ""`.
- `deleteCard(id)`: removes the card whose `id` matches; this helper is called only after the per-card confirmation flow has resolved positively.
- `moveCardUp(id)`: swaps the card with its immediate predecessor; no-op if the card is at index 0.
- `moveCardDown(id)`: swaps the card with its immediate successor; no-op if the card is at the last index.

Reorder helpers SHALL preserve all card fields (including `id`) — only the array position changes.

#### Scenario: Add card appends with default role system

- **WHEN** `addCard()` is called on a cards array of length N
- **THEN** the array length SHALL become N+1, the new last element SHALL have `role: "system"` and `body: ""`, AND the new element's `id` SHALL be a freshly generated UUID distinct from all other cards' `id` values

#### Scenario: Delete card removes by id

- **WHEN** `deleteCard("abc-123")` is called and a card with `id: "abc-123"` exists in the array
- **THEN** the array SHALL no longer contain any card with `id: "abc-123"` and the relative order of all other cards SHALL be unchanged

#### Scenario: Move-up swaps with predecessor

- **WHEN** `moveCardUp(id)` is called for the card at index 2 (out of indices 0..3)
- **THEN** that card SHALL move to index 1 and the previous index-1 card SHALL move to index 2

#### Scenario: Move-up no-op at first index

- **WHEN** `moveCardUp(id)` is called for the card at index 0
- **THEN** the array SHALL be unchanged

#### Scenario: Move-down swaps with successor

- **WHEN** `moveCardDown(id)` is called for the card at index 1 (out of indices 0..3)
- **THEN** that card SHALL move to index 2 and the previous index-2 card SHALL move to index 1

#### Scenario: Move-down no-op at last index

- **WHEN** `moveCardDown(id)` is called for the card at the last index
- **THEN** the array SHALL be unchanged

### Requirement: Per-card delete confirmation

Before a card is removed, the editor SHALL display a per-card inline confirmation prompt with the zh-TW message "確定刪除這則訊息？" and two buttons "確定" (Confirm) and "取消" (Cancel). The confirmation SHALL replace the body editor of the targeted card in-place (NOT a modal overlay) so focus and screen-reader flow remain on the card. Only on "確定" SHALL the composable's `deleteCard(id)` be called.

#### Scenario: Delete-button shows inline confirmation

- **WHEN** the user clicks the delete button on a card
- **THEN** the card body SHALL be replaced in-place by the confirmation prompt with "確定" and "取消" buttons; the rest of the card list SHALL remain rendered

#### Scenario: Cancel returns to editing

- **WHEN** the user clicks "取消" on the confirmation prompt
- **THEN** the card SHALL re-render its normal body editor with the same `body` content, AND `deleteCard()` SHALL NOT have been called

#### Scenario: Confirm triggers delete

- **WHEN** the user clicks "確定" on the confirmation prompt
- **THEN** `deleteCard(card.id)` SHALL be called and the card SHALL be removed from the rendered list

### Requirement: Pre-save validity guard

The editor SHALL block save in cards mode when the cards array would, after serialisation, fail the backend's `multi-message:no-user-message` or `multi-message:empty-message` checks. Specifically, the "儲存" button SHALL be disabled in cards mode unless ALL of the following hold:

- `cards.length >= 1`.
- At least one card has `role === "user"`.
- Every card has `body.trim().length > 0` (no card whose body is empty or contains only whitespace — these would assemble into empty messages and trip `multi-message:empty-message` at render time).

When the guard blocks save, the disabled button SHALL display a context-appropriate zh-TW tooltip:
- `cards.length === 0` → "請至少新增一則訊息".
- No user-role card → "請至少包含一則使用者訊息（傳送者：使用者）".
- One or more empty-body cards → "請填入所有訊息的內容".

The guard does NOT apply in raw-text fallback mode (the user is editing source directly and may legitimately rely on Vento control flow / runtime-resolved roles to satisfy the backend rules; the backend re-runs its own validation on save and on render).

#### Scenario: Empty cards array disables save

- **WHEN** the cards array is `[]` in cards mode
- **THEN** the "儲存" button SHALL be disabled with the zh-TW tooltip "請至少新增一則訊息"

#### Scenario: No user-role card disables save

- **WHEN** the cards array contains one or more cards but none has `role === "user"`
- **THEN** the "儲存" button SHALL be disabled with the zh-TW tooltip "請至少包含一則使用者訊息（傳送者：使用者）"

#### Scenario: Empty-body card disables save

- **WHEN** the cards array contains a user-role card but at least one card has `body.trim() === ""`
- **THEN** the "儲存" button SHALL be disabled with the zh-TW tooltip "請填入所有訊息的內容"

#### Scenario: Cards array with user message and non-empty bodies permits save

- **WHEN** the cards array contains at least one `system` and one `user` card and every card body has non-whitespace content
- **THEN** the "儲存" button SHALL be enabled (subject to the normal `isDirty` and `isSaving` checks)

#### Scenario: Validity guard does not apply in raw-text fallback mode

- **WHEN** the editor is in raw-text fallback mode
- **THEN** the validity guard SHALL NOT disable the "儲存" button — the button's enablement is governed only by `isDirty`/`isSaving` and the standard non-empty-string check on the textarea
