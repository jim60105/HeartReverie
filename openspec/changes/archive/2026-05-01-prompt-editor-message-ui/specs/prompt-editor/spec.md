# Prompt Editor (delta)

## MODIFIED Requirements

### Requirement: Editor UI

The frontend SHALL provide a `PromptEditor.vue` Single File Component as the main editor widget for editing the system prompt template. The `PromptEditor.vue` component SHALL be rendered within a `PromptEditorPage.vue` routed component that fills the settings content area of `SettingsLayout`. The editor SHALL operate in two mutually-exclusive modes:

- **Cards mode (default)**: the editor SHALL render an ordered list of message cards, one per `{{ message "<role>" }}…{{ /message }}` block parsed from the template loaded via `GET /api/template`. Each card is rendered by a `PromptEditorMessageCard.vue` child component (see capability `prompt-editor-message-cards`). Above the list, a toolbar SHALL render an "新增訊息" (Add message) button that appends a new empty card with default role `system` to the end of the list.
- **Raw-text fallback mode**: the editor SHALL render the entire template source in a single `<textarea>` bound via `v-model` to the raw string, identical in behaviour to the legacy editor. This mode SHALL be entered automatically when `parseSystemTemplate()` returns a parse error, and SHALL be toggleable manually via a "進階：純文字模式" toggle in the toolbar.

When the editor first loads, the composable SHALL preserve the original raw template source as `originalRawSource` for the lifetime of the editor session (until the next successful save or reset). The dirty-tracking baselines (`originalCards` and `originalRawSource`) SHALL be mutated ONLY on (a) a successful Load, (b) a successful Save, or (c) a Reset. Mode toggles SHALL NOT mutate the baselines — this is what guarantees that dirty edits in either view survive a round-trip through the other view without being silently promoted to "saved".

When the user manually toggles cards → raw, the textarea SHALL be populated with `serializeMessageCards(cards)` (the lossy serialisation of the CURRENT cards array, including any in-flight edits). To preserve in-flight card edits across a cards → raw → cards round-trip when the raw text is not modified, the composable SHALL also snapshot a deep clone of the current cards array and the just-produced raw text into internal scratch state. When the user toggles raw → cards, if the textarea is byte-identical to the snapshot AND the scratch holds pending cards, the composable SHALL restore those pending cards verbatim (preserving in-flight edits). Otherwise the parser SHALL be re-run against the textarea contents; on success the cards array is replaced with the parser output. On any successful exit from raw mode the scratch is cleared. Neither path mutates `originalCards` or `originalRawSource`. This avoids "lossy round-trip masquerading as clean" AND "round-trip silently discards pending card edits" simultaneously.

When parsing fails on initial load OR on a manual raw → cards toggle attempt, the editor SHALL display a non-blocking warning banner above the toolbar with the parser-supplied reason (zh-TW, e.g. "範本解析失敗，已切換為純文字模式：發現未配對的訊息標籤"). The banner SHALL be dismissible.

Whenever a load OR a successful raw → cards toggle yields `topLevelContentDropped === true`, the editor SHALL display a persistent warning strip in cards mode (visible until the editor is reloaded or reset, NOT dismissible) with text "範本中有部分內容（訊息區塊之外的文字）將在儲存時被捨棄；如要保留，請使用「進階：純文字模式」". This guarantees the user is informed at every point in the session — not just on first load — that a save will be lossy.

The editor content SHALL fill the available width and height of the settings content area (no fixed `width: 33vw`). The component SHALL NOT include a close button or emit a `close` event — navigation away from the editor is handled by the settings sidebar or the back button. `PromptPreview` SHALL be rendered inline within `PromptEditorPage.vue` as a toggleable section in a flex layout (e.g., side-by-side or stacked), instead of as a separate Teleported overlay panel. Lazy DOM creation previously used in vanilla JS SHALL be replaced by Vue's conditional rendering (`v-if` or `v-show`) to control preview visibility within the page.

The editor toolbar SHALL include a "儲存" (Save) button that calls the composable's `save()` method. In cards mode, `save()` SHALL first run `serializeMessageCards(cards)` to produce the Vento source string before issuing `PUT /api/template`. In raw-text fallback mode, `save()` SHALL `PUT` the textarea contents directly. The save button SHALL be disabled when `isDirty` is `false` or `isSaving` is `true`. The save button SHALL display a loading indicator while `isSaving` is `true`.

The editor toolbar SHALL include a "回復預設" (Reset to default) button that calls the composable's `resetTemplate()` method. The reset button SHALL be disabled when `isCustom` is `false` (no custom file to reset). After a successful reset, the editor SHALL re-run `parseSystemTemplate()` against the freshly loaded default content and re-enter cards mode if parsing succeeds.

#### Scenario: View current template in cards mode

- **WHEN** the user navigates to `/settings/prompt-editor` and `system.md` parses successfully
- **THEN** the `PromptEditorPage.vue` route component SHALL render `PromptEditor.vue` in cards mode, with one `PromptEditorMessageCard` per `{{ message }}` block found by the parser, in document order

#### Scenario: View current template in raw-text fallback when parse fails

- **WHEN** the user navigates to `/settings/prompt-editor` and `system.md` contains unbalanced `{{ message }}` tags, an unknown role, or a nested `{{ message }}` block
- **THEN** the editor SHALL render in raw-text fallback mode with the full template content in a `<textarea>`, AND a warning banner above the toolbar SHALL display the zh-TW reason for the fallback

#### Scenario: Manual toggle into raw-text fallback serialises current cards

- **WHEN** the user clicks the "進階：純文字模式" toggle while in cards mode
- **THEN** the editor SHALL populate the raw-text `<textarea>` with `serializeMessageCards(cards)` (a lossy serialisation of the current cards array — top-level inter-block text from the original `originalRawSource` is NOT re-introduced), switch the rendered mode to raw-text fallback, AND leave `originalRawSource` and `originalCards` unchanged so dirty tracking continues to compare against the last-loaded/saved baselines
- **AND** the composable SHALL snapshot a deep clone of the current cards plus the just-produced raw text into internal scratch state so that an unmodified raw → cards round-trip can restore those pending edits

#### Scenario: Manual toggle back from raw-text fallback to cards (unmodified raw)

- **WHEN** the user clicks the "結構化模式" toggle while in raw-text fallback mode and the textarea contents are byte-identical to the snapshot taken at the most recent cards → raw transition
- **THEN** the editor SHALL restore the cards array from the round-trip snapshot verbatim (including any in-flight card edits made before the cards → raw toggle), switch back to cards mode, clear the round-trip scratch, AND leave `originalRawSource` and `originalCards` unchanged

#### Scenario: Manual toggle back from raw-text fallback to cards (re-parse)

- **WHEN** the user clicks the "結構化模式" toggle while in raw-text fallback mode and the textarea contents differ from the round-trip snapshot (or no snapshot exists, e.g. raw mode entered automatically on initial load) and the textarea contents parse successfully
- **THEN** the editor SHALL replace the cards array with the parser output, switch the rendered mode to cards mode, clear the round-trip scratch, AND leave `originalRawSource` and `originalCards` unchanged (so any structural change in the textarea remains visible as `isDirty`)

#### Scenario: Manual toggle back from raw-text fallback fails on parse

- **WHEN** the user clicks the "結構化模式" toggle while in raw-text fallback mode and the current textarea contents do NOT parse
- **THEN** the editor SHALL remain in raw-text fallback mode and display the warning banner with the parser reason

#### Scenario: Save button enabled when dirty

- **WHEN** the editor content (cards or raw textarea, whichever mode is active) differs from the last-saved snapshot
- **THEN** the "儲存" button SHALL be enabled and clickable

#### Scenario: Save button disabled when clean

- **WHEN** the editor content matches the last-saved snapshot
- **THEN** the "儲存" button SHALL be disabled

#### Scenario: Save button shows loading state

- **WHEN** a save operation is in progress
- **THEN** the "儲存" button SHALL be disabled and display a loading indicator

#### Scenario: Save serialises cards before PUT

- **WHEN** the user clicks "儲存" in cards mode
- **THEN** the composable SHALL run `serializeMessageCards(cards)` to produce a Vento source string, send that string as the body of `PUT /api/template`, and on success update the last-saved snapshot to the same cards array

#### Scenario: Save sends raw textarea content in fallback mode

- **WHEN** the user clicks "儲存" in raw-text fallback mode
- **THEN** the composable SHALL send the raw textarea contents directly as the body of `PUT /api/template`, identical to the legacy editor's save flow

#### Scenario: Reset button disabled when no custom file

- **WHEN** the template source is `"default"` (no custom file exists)
- **THEN** the "回復預設" button SHALL be disabled

#### Scenario: Reset template

- **WHEN** the user clicks the "回復預設" button in the editor
- **THEN** the component SHALL call `DELETE /api/template`, re-fetch the template from the server, run `parseSystemTemplate()` against the result, populate the cards array if parsing succeeds (otherwise enter raw-text fallback), and set `isCustom` to `false`

#### Scenario: Editor fills settings content area

- **WHEN** the prompt editor page is rendered within `SettingsLayout`
- **THEN** the editor SHALL expand to fill the available width and height of the settings content area, without fixed viewport-relative sizing (no `width: 33vw`)

#### Scenario: No close button or close emit

- **WHEN** the `PromptEditor.vue` component is inspected
- **THEN** it SHALL NOT contain a close button and SHALL NOT emit a `close` event — leaving the editor is done via sidebar navigation or the back button

#### Scenario: Inline preview toggle

- **WHEN** the user toggles the preview within the prompt editor page
- **THEN** `PromptPreview` SHALL appear inline in a flex layout alongside or below the editor textarea, not as a Teleported fixed-position overlay

#### Scenario: Preview reloads on save

- **WHEN** the user clicks the "儲存" (Save) button while the preview panel is open
- **THEN** the `PromptEditorPage.vue` component SHALL trigger `PromptPreview` to re-fetch the rendered prompt from the server, reflecting the newly saved template content

#### Scenario: Saved event still emitted in both modes (regression guard)

- **WHEN** a save completes successfully in EITHER cards mode OR raw-text fallback mode
- **THEN** the `PromptEditor.vue` component SHALL emit a `saved` event (preserving the baseline `PromptEditor component events` requirement) so `PromptEditorPage.vue` can refresh the preview

### Requirement: Variable insertion pills

In raw-text fallback mode, the editor SHALL display clickable pills above the textarea showing all available Vento template variables. Clicking a pill SHALL insert the `{{ variable_name }}` reference at the current cursor position in the textarea via a component method. Pills SHALL be color-coded by source type: blue for core variables, green for plugin-contributed variables, and amber/gold for lore-contributed variables. The `scenario` variable SHALL NOT appear in the core pills (it was replaced by the lore codex system). Lore pills SHALL be dynamically fetched based on the current story context and SHALL update when the story context changes.

In cards mode, the global pill row SHALL NOT be rendered. Instead, each `PromptEditorMessageCard` SHALL render an inline "插入變數" (Insert variable) helper above its body editor, populated from the same variable list (see capability `prompt-editor-message-cards`).

#### Scenario: Display variable pills with three color categories in raw-text fallback

- **WHEN** the `PromptEditor.vue` component is in raw-text fallback mode and loads with an active story context that has lore passages
- **THEN** it SHALL fetch variables from `GET /api/plugins/parameters` and render them as clickable pill buttons with blue for core, green for plugin, and amber/gold for lore variables

#### Scenario: Insert variable from pill in raw-text fallback

- **WHEN** the user is in raw-text fallback mode and clicks a variable pill
- **THEN** the component method SHALL insert `{{ variable_name }}` at the textarea cursor position and update the `v-model` ref accordingly

#### Scenario: scenario variable not present in pills

- **WHEN** the pills are rendered from the parameters endpoint response
- **THEN** no pill with the variable name `scenario` SHALL be displayed

#### Scenario: Lore pills update on story context change

- **WHEN** the user switches from story "quest" (with tags ["character", "world"]) to story "journey" (with tags ["location", "npc"])
- **THEN** the lore pills SHALL re-fetch from `GET /api/plugins/parameters` with the new story context and display `lore_all`, `lore_tags`, `lore_location`, and `lore_npc` instead of the previous lore variables

#### Scenario: Cards mode does not render global pill row

- **WHEN** the editor is in cards mode
- **THEN** the global variable-pill row above the toolbar SHALL NOT be rendered; the per-card "插入變數" helper takes its place

### Requirement: Live preview integration

Changes made in the prompt editor SHALL be previewable using the prompt preview endpoint. The editor SHALL provide a "Preview" action that, in cards mode, runs `serializeMessageCards(cards)` to produce a Vento source string and sends that string to `POST /api/stories/:series/:name/preview-prompt` (via the `template` body field). In raw-text fallback mode, the editor SHALL send the textarea contents directly to the same endpoint. The rendered result SHALL be displayed in the preview panel.

#### Scenario: Preview edited template from cards

- **WHEN** the user clicks "Preview" in the editor while in cards mode
- **THEN** the component SHALL serialise the current cards via `serializeMessageCards(cards)`, send the resulting string as `template` to the preview endpoint, and display the rendered prompt in the preview panel

#### Scenario: Preview edited template from raw-text fallback

- **WHEN** the user clicks "Preview" in the editor while in raw-text fallback mode
- **THEN** the component SHALL send the current textarea content as `template` to the preview endpoint and display the rendered prompt in the preview panel

#### Scenario: Preview with custom message

- **WHEN** the user has typed a message in the chat input and triggers preview from the editor
- **THEN** the preview SHALL render the prompt using that message as `user_input`

### Requirement: localStorage sync via composable

The `usePromptEditor` composable SHALL persist the template through the backend `PUT /api/template` endpoint instead of `localStorage`. The composable SHALL track dirty state by comparing the current editor representation against the last-saved snapshot:

- In cards mode, dirty tracking SHALL deep-compare the current `cards` array against the snapshot, ignoring the internal `id` field on each card and considering `role`, `body`, count, and order. Reorders count as dirty.
- In raw-text fallback mode, dirty tracking SHALL string-compare the textarea content against the snapshot.

The composable SHALL expose an `isDirty` computed ref and an async `save()` method that calls `PUT /api/template` with the appropriate serialised body for the active mode. The composable SHALL expose an `isSaving` ref for loading state. On load, the composable SHALL fetch the template via `GET /api/template`, run `parseSystemTemplate()` against the response body, populate the `cards` array on success or set the `parseError` ref on failure, and use the `source` field to determine whether a custom prompt is active. The `savedTemplate` computed SHALL remain absent — the chat route reads from the server-side file directly. The `localStorage` key `story-editor-template` SHALL no longer be read or written.

The composable SHALL additionally expose:
- `cards: Ref<MessageCard[]>` — the current ordered list of message cards.
- `parseError: Ref<string | null>` — the most recent parse failure reason, or `null` when parsing succeeded.
- `useRawFallback: Ref<boolean>` — `true` when the editor is in raw-text fallback mode (either auto-entered or manually toggled).
- `topLevelContentDropped: Ref<boolean>` — `true` when the most recent successful parse coalesced or discarded top-level content; surfaces the persistent warning strip in cards mode.
- `originalRawSource: Ref<string>` — the unmodified template source as last loaded from `GET /api/template` or last successfully PUT. Mutated ONLY on Load / Save / Reset; never mutated by mode toggles.
- `addCard()`, `deleteCard(id)`, `moveCardUp(id)`, `moveCardDown(id)` — card manipulation helpers.
- `toggleRawFallback()` — manual mode toggle. Cards → raw populates the textarea with `serializeMessageCards(cards)` and snapshots a round-trip scratch (deep-clone of cards + the just-produced raw text). Raw → cards: if textarea matches the scratch raw text exactly AND scratch holds pending cards, restores the cards verbatim; otherwise re-parses the textarea, replacing the cards on success or surfacing a parse error on failure. Neither direction mutates `originalCards` or `originalRawSource`.

#### Scenario: Save via API in cards mode

- **WHEN** the user clicks the "儲存" (Save) button in the editor while in cards mode
- **THEN** the composable SHALL call `serializeMessageCards(cards)` to build the body, call `PUT /api/template` with that body, and on success update the last-saved snapshot to a deep clone of the current cards array (ignoring `id` for future comparison) and update `originalRawSource` to the just-PUT serialised string

#### Scenario: Save via API in raw-text fallback mode

- **WHEN** the user clicks the "儲存" (Save) button in the editor while in raw-text fallback mode
- **THEN** the composable SHALL call `PUT /api/template` with the current textarea content and on success update the last-saved snapshot to that string and update `originalRawSource` to the just-PUT string

#### Scenario: Dirty state tracking in cards mode

- **WHEN** the user edits any card's `role` or `body`, adds a card, deletes a card, or reorders cards in cards mode
- **THEN** the `isDirty` computed ref SHALL be `true` and the save button SHALL be enabled

#### Scenario: Dirty state tracking in raw-text fallback mode

- **WHEN** the user modifies the textarea content so it differs from the last-saved version in raw-text fallback mode
- **THEN** the `isDirty` computed ref SHALL be `true` and the save button SHALL be enabled

#### Scenario: Clean state after save

- **WHEN** a save completes successfully
- **THEN** `isDirty` SHALL be `false` and `isSaving` SHALL be `false`

#### Scenario: Load detects custom vs default

- **WHEN** the composable fetches the template on mount
- **THEN** it SHALL use the `source` field from `GET /api/template` to set an `isCustom` ref indicating whether a custom prompt file exists

#### Scenario: Load runs parser

- **WHEN** the composable fetches the template on mount
- **THEN** it SHALL store the response body in `originalRawSource`, run `parseSystemTemplate(source)` against it, populate `cards` AND set `topLevelContentDropped` to the parser's flag if parsing succeeds, OR set `parseError` and `useRawFallback = true` if parsing fails

#### Scenario: Reset calls DELETE

- **WHEN** the user clicks "回復預設" (Reset to default)
- **THEN** the composable SHALL call `DELETE /api/template`, then re-fetch via `GET /api/template`, then re-run `parseSystemTemplate()` against the freshly loaded content

#### Scenario: No localStorage usage

- **WHEN** the composable code is inspected
- **THEN** it SHALL contain no references to `localStorage`, `STORAGE_KEY`, or `sessionStorage`

### Requirement: Editor textarea is the sole scroll container for template text

In raw-text fallback mode, `.editor-textarea` SHALL be the only scroll container for the template content. The toolbar (`.editor-toolbar`) and warning banner SHALL remain pinned at the top of the editor pane and SHALL NOT scroll when the user scrolls the textarea content. The editor's outer flex chain (`.editor-root` → `.editor-textarea-wrap` → `<textarea class="editor-textarea">`) SHALL guarantee that overflow stops at the textarea: `.editor-textarea-wrap` SHALL declare `flex: 1; min-height: 0; overflow: hidden`, and `.editor-textarea` SHALL keep `width: 100%; height: 100%; resize: none`, allowing the native `<textarea>` element to manage its own internal scroll for long content.

In cards mode, the cards-list scroll container (`.editor-cards-list`) SHALL fill the same flex slot and SHALL be the only scroll container for the cards. Each individual card body textarea SHALL NOT independently force the page to scroll — its `min-height` SHALL be bounded so a single very-long message does not push the toolbar offscreen; long bodies become scrollable inside their own card's textarea (vertical-resize allowed via `resize: vertical`).

The page itself (the `PromptEditorPage.vue` route component and its ancestors up to `.settings-layout`) SHALL NOT scroll as a result of long template content in either mode. This page-level guarantee depends on the `:has(.editor-page)` cap defined in `settings-page` and is verified by manual browser smoke.

#### Scenario: Editor textarea wrap declares clip rules in the source (raw-text fallback)

- **WHEN** `PromptEditor.vue`'s scoped style block is read as text
- **THEN** the `.editor-textarea-wrap` rule SHALL declare `flex: 1`, `min-height: 0`, and `overflow: hidden`
- **AND** the `.editor-textarea` rule SHALL declare `width: 100%`, `height: 100%`, and `resize: none`

#### Scenario: Toolbar stays pinned when textarea content overflows in raw-text fallback (manual smoke)

- **WHEN** the editor is in raw-text fallback mode, the textarea contains text longer than its visible height, and the user scrolls inside the textarea in a real browser
- **THEN** the editor toolbar SHALL remain visible and at the same position relative to the viewport
- **AND** the textarea SHALL scroll its own content internally
- **AND** this scenario is verified by manual browser smoke (Happy DOM does not perform real layout)

#### Scenario: Cards list scrolls but page does not (manual smoke)

- **WHEN** the editor is in cards mode, the user has many cards or long bodies, and the user scrolls the cards list in a real browser
- **THEN** the `.editor-cards-list` SHALL scroll its own content internally and the document body's `scrollTop` SHALL remain `0`
- **AND** the toolbar SHALL remain pinned at the top of the editor pane
- **AND** this scenario is verified by manual browser smoke

#### Scenario: Long template does not scroll the page in raw-text fallback (manual smoke)

- **WHEN** the user pastes a template that is many times taller than the viewport into the editor in raw-text fallback mode in a real browser
- **THEN** the document body's `scrollTop` SHALL remain `0` and the body SHALL produce no vertical scrollbar
- **AND** the only element that scrolls in response to the user dragging the scrollbar near the textarea SHALL be the `<textarea class="editor-textarea">` itself
- **AND** this scenario is verified by manual browser smoke

#### Scenario: Textarea scroll does not affect preview scroll (no JS sync)

- **GIVEN** the preview pane is open alongside the editor
- **WHEN** test code mutates the textarea's `scrollTop` programmatically (raw-text fallback) or any card body's `scrollTop` (cards mode)
- **THEN** `.preview-content`'s `scrollTop` SHALL remain at its prior value (proving no JS scroll-sync handler exists)
- **AND** the converse SHALL also hold: mutating `.preview-content`'s `scrollTop` SHALL NOT change either the textarea's or any card body's `scrollTop`
