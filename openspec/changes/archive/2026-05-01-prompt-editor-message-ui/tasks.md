## 1. Pre-flight

- [x] 1.1 Confirm `multi-message-prompt-template` is implemented (or at minimum its `{{ message }}` tag and the `template` body field on `POST /api/stories/:series/:name/preview-prompt`); this change depends on those.
- [x] 1.2 Re-read `reader-src/src/components/PromptEditor.vue`, `reader-src/src/components/PromptPreview.vue`, `reader-src/src/composables/usePromptEditor.ts`, and `reader-src/src/types/index.ts` to confirm current shape against the spec deltas.

## 2. Frontend types

- [x] 2.1 Add `MessageCard` type to `reader-src/src/types/index.ts`: `{ id: string; role: "system" | "user" | "assistant"; body: string }`. Export it.
- [x] 2.2 Update any types in the same file that previously referenced raw template state to acknowledge the new dual-mode shape (no breaking renames; just additive).

## 3. Template parser & serialiser

- [x] 3.1 Create `reader-src/src/lib/template-parser.ts` exporting two pure functions:
  - `parseSystemTemplate(source: string): { cards: MessageCard[] | null; parseError: string | null; topLevelContentDropped: boolean }`
  - `serializeMessageCards(cards: MessageCard[]): string`
- [x] 3.2 Implement the lexer state machine in `parseSystemTemplate`: track {outside-expr, inside-expr, inside-comment, inside-string} states, recognise `{{ message "<role>" }}` openers and `{{ /message }}` closers only at top level, capture verbatim bodies. Apply the canonical-delimiter model: strip exactly one leading `\n` (or `\r\n`) immediately after the opener's `}}` if present, and exactly one trailing `\n` (or `\r\n`) immediately before the closer's `{{` if present.
- [x] 3.3 Implement unsupported-construct detection that triggers fast-fail parse error (raw fallback): `{{> ` JS-expression escape, `{{ echo }}` raw block, identifier-role openers (no double-quoted string in the role position). Each error returns the spec'd zh-TW reason verbatim.
- [x] 3.4 Accept Vento trim markers (`{{- message "..." -}}` and `{{- /message -}}`) on message tags as ordinary openers/closers; the serialiser does NOT re-emit them.
- [x] 3.5 Implement lossy-normalize: coalesce leading top-level non-whitespace into a single leading `system` card; discard inter-block and trailing top-level non-whitespace and set `topLevelContentDropped`. A no-message non-whitespace source produces a single leading `system` card with `topLevelContentDropped = false`.
- [x] 3.6 Implement parse-failure reasons (zh-TW) per spec: unbalanced tags, unknown role, nested `{{ message }}`, malformed opener, identifier-role ("動態角色訊息標籤需使用純文字模式編輯"), JS-escape ("偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯"), echo block ("偵測到 echo 區塊，需使用純文字模式編輯").
- [x] 3.7 Implement `serializeMessageCards`: emit `{{ message "<role>" }}\n<body>\n{{ /message }}` blocks joined by single blank lines; trailing newline; throw `RangeError` on invalid role. Bodies emitted verbatim as JS strings (no encoding, no normalisation of internal CRLF).
- [x] 3.8 Add tests in `reader-src/src/lib/__tests__/template-parser.test.ts`:
  - Round-trip for canonical templates (parse(serialize(cards)) ≡ cards modulo `id`).
  - String-literal containing `{{ message }}` text NOT matched.
  - Comment containing `{{ message }}` text NOT matched.
  - Unbalanced opener returns `parseError`.
  - Unknown role returns `parseError`.
  - Nested opener returns `parseError`.
  - Identifier-role opener (`{{ message dynamic_role }}`) returns the specific zh-TW reason.
  - JS-escape (`{{> expr }}`) anywhere returns the specific zh-TW reason.
  - `{{ echo }}…{{ /echo }}` block anywhere returns the specific zh-TW reason.
  - Trim-marker message tags (`{{- message "user" -}}body{{- /message -}}`) parse as ordinary message blocks.
  - Canonical-boundary newline stripping: opener-`}}\n<body>\n{{`-closer captures `body` (one leading + one trailing `\n` stripped).
  - Body starting/ending with extra newlines beyond the canonical pair preserves those extras.
  - CRLF in body content preserved verbatim; canonical boundary `\r\n` stripping works on CRLF-style sources.
  - Leading top-level text coalesced into system card; flag false.
  - Trailing top-level text dropped; flag true.
  - Inter-block top-level text dropped; flag true.
  - No-message non-whitespace source → single system card; flag false.
  - Empty source produces empty array, no error.
  - Empty cards array serialises to empty string.
  - Serialiser rejects invalid role with `RangeError` whose message names the offending index.

## 4. Composable updates

- [x] 4.1 Update `reader-src/src/composables/usePromptEditor.ts` to expose: `cards: Ref<MessageCard[]>`, `parseError: Ref<string | null>`, `useRawFallback: Ref<boolean>`, `topLevelContentDropped: Ref<boolean>`, `originalRawSource: Ref<string>`, `addCard()`, `deleteCard(id)`, `moveCardUp(id)`, `moveCardDown(id)`, `toggleRawFallback()`, `serializeCurrent(): string` helper.
- [x] 4.2 Implement `loadTemplate()` (or extend existing): after `GET /api/template`, store the body in `originalRawSource`, then run `parseSystemTemplate(source)`. If success → populate `cards` (assigning fresh UUIDs), set `topLevelContentDropped` to the parser's flag, clear `parseError`. If failure → set `parseError`, set `useRawFallback = true`, populate the raw textarea ref with the source.
- [x] 4.3 Reimplement `isDirty` to dual-track:
  - In cards mode: deep-compare current `cards` (ignoring `id`) against the last-saved cards snapshot.
  - In raw-fallback mode: string-compare textarea content against `originalRawSource` (NOT the cards-derived snapshot).
- [x] 4.4 Reimplement `save()`: in cards mode call `serializeMessageCards(cards.value)` and `PUT /api/template` with the result; in raw-fallback mode `PUT` the raw textarea contents directly. On success update the cards snapshot (deep-cloning to avoid aliasing) AND update `originalRawSource` to the just-PUT string so subsequent toggles operate against the freshly-saved baseline.
- [x] 4.5 Implement `toggleRawFallback()`:
  - cards → raw: populate the raw textarea with `originalRawSource` (NOT a re-serialisation of current cards). Keep the in-memory cards array untouched so a subsequent toggle back can return to it if no raw edits intervened.
  - raw → cards: parse the current textarea contents. On success: replace `cards`, update `originalRawSource` to the just-confirmed textarea contents, set `topLevelContentDropped` from the parser flag, clear `parseError`. On failure: surface `parseError`, remain in raw mode.
- [x] 4.6 Implement `addCard()`, `deleteCard(id)`, `moveCardUp(id)`, `moveCardDown(id)` per the spec (with no-op behaviour at array bounds).
- [x] 4.7 Verify all `localStorage`/`STORAGE_KEY`/`sessionStorage` references remain absent.
- [x] 4.8 Add tests in `reader-src/src/composables/__tests__/usePromptEditor.test.ts`:
  - Load with parseable template → cards populated, `useRawFallback=false`, `originalRawSource` equals fetched body.
  - Load with unparseable template → `useRawFallback=true`, `parseError` set, `originalRawSource` equals fetched body.
  - addCard appends with default role system, body empty, fresh UUID.
  - deleteCard removes by id.
  - moveCardUp/moveCardDown swap correctly; no-op at boundaries.
  - Editing role/body/order makes `isDirty=true` in cards mode.
  - Reordering counts as dirty (regression guard).
  - Save serialises and PUTs in cards mode; updates `originalRawSource`.
  - Save PUTs raw text directly in fallback mode; updates `originalRawSource`.
  - Snapshot updates after successful save.
  - cards → raw toggle: textarea is populated with `originalRawSource`, NOT the serialised cards. Verify via a lossy-load fixture (template with inter-block top-level text): post-toggle textarea equals the pre-load source verbatim and `isDirty=false`.
  - raw → cards toggle on parseable raw: cards replaced, `originalRawSource` updated to the textarea contents, `parseError=null`.
  - raw → cards toggle on unparseable raw: stays in raw mode, surfaces `parseError`.
  - Pre-save validity guard: empty cards array, no user-role card, or any trimmed-empty body marks save as disabled (helper returns the spec'd zh-TW tooltip per case).

## 5. PromptEditorMessageCard component

- [x] 5.1 Create `reader-src/src/components/PromptEditorMessageCard.vue` (`<script setup lang="ts">`).
- [x] 5.2 Props: `card: MessageCard`, `isFirst: boolean`, `isLast: boolean`, plus an `availableVariables: VariableDefinition[]` prop (or use a provided/injected source).
- [x] 5.3 Emits: `update:role`, `update:body`, `move-up`, `move-down`, `delete`. (Or use `defineModel<MessageCard>()` if cleaner — pick the pattern consistent with existing components.)
- [x] 5.4 Render header with zh-TW "傳送者" label, `<select>` with three options, then the action buttons (up / down / delete) with proper `aria-label`s and disabled states.
- [x] 5.5 Render the "插入變數" helper (dropdown or popover) above the body textarea, showing the variable list. The helper inserts ONLY simple `{{ var_name }}` interpolation expressions — control-flow snippets (`{{ for }}`, `{{ if }}`, etc.) remain manual entry by design.
- [x] 5.6 Render the body `<textarea>` with `min-height` ~6 rows and `resize: vertical`, monospace font, focus ring matching project conventions.
- [x] 5.7 Implement `insertAtCursor(varName)` using `HTMLTextAreaElement.setRangeText('{{ ' + varName + ' }}', start, end, 'end')`, then refocus.
- [x] 5.8 Implement the per-card delete confirmation: replace the body editor in-place with a `<div>` containing the zh-TW prompt and "確定" / "取消" buttons; only "確定" emits `delete`.
- [x] 5.9 Add scoped CSS for card visual treatment: rounded container, subtle border, internal padding, role-color accent on the header (e.g. system=neutral, user=blue, assistant=green); rely on existing theme.css custom properties where possible.
- [x] 5.10 Add tests in `reader-src/src/components/__tests__/PromptEditorMessageCard.test.ts`:
  - Renders three role options with zh-TW labels and English values.
  - Changing select emits `update:role` with new value.
  - Up button disabled when `isFirst`; down button disabled when `isLast`.
  - Clicking delete shows the inline confirmation; cancel restores the body editor; confirm emits `delete`.
  - Insert-variable inserts at caret and keeps focus on the textarea.

## 6. PromptEditor.vue rewrite

- [x] 6.1 Replace the single `<textarea>` template with a `v-if="useRawFallback"` branch (raw textarea, identical to today) and a `v-else` branch (cards mode).
- [x] 6.2 In cards mode, render the toolbar with: "新增訊息", "儲存", "回復預設", "預覽 Prompt", "進階：純文字模式" toggle. In raw-fallback mode, the toolbar SHALL also include the "結構化模式" toggle and the legacy variable-pill row above the textarea.
- [x] 6.3 Render a `<TransitionGroup name="card-move" tag="div" class="editor-cards-list">` containing `<PromptEditorMessageCard>` for each card, keyed by `card.id`.
- [x] 6.4 Wire the card events to the composable helpers: `update:role` → mutate `card.role`; `update:body` → mutate `card.body`; `move-up` → `moveCardUp(card.id)`; `move-down` → `moveCardDown(card.id)`; `delete` → `deleteCard(card.id)`.
- [x] 6.5 Render the parse-failure warning banner above the toolbar when `parseError` is non-null. The banner SHALL be dismissible (a small `×` button clears the banner without changing mode).
- [x] 6.6 Render the lossy-normalize warning strip when `topLevelContentDropped` is true. The strip SHALL be persistent (NOT dismissible) and remain visible whenever cards mode is rendered with `topLevelContentDropped===true`, so the user is reminded at every visit that saving will discard top-level content. Strip clears on next load OR on successful raw → cards toggle that sets the flag false.
- [x] 6.7 Implement the Pre-save validity guard: disable Save when (a) cards array is empty, OR (b) no card has `role==="user"`, OR (c) any card has trimmed-empty body. Each case SHALL surface the spec'd zh-TW tooltip on the Save button.
- [x] 6.7a Confirm the existing `saved` event continues to be emitted by `PromptEditor.vue` in BOTH cards mode and raw-fallback mode after a successful save (preserves the baseline `PromptEditor component events` requirement so `PromptEditorPage.vue` still refreshes the preview).
- [x] 6.8 Update the Preview button to call the composable's `serializeCurrent()` and pass the result to `PromptPreview` via the same channel as today.
- [x] 6.9 Update scoped CSS so `.editor-cards-list` is the scroll container in cards mode (`flex: 1; min-height: 0; overflow-y: auto;`); leave the existing raw-text rules untouched but scoped to the `v-if` branch.
- [x] 6.10 Add tests in `reader-src/src/components/__tests__/PromptEditor.test.ts`:
  - Initial mount with parseable template renders one card per `{{ message }}` block in document order.
  - Initial mount with unparseable template renders raw textarea + warning banner; toggle button visible.
  - Clicking "新增訊息" appends a card with default role system.
  - Save in cards mode issues `PUT /api/template` with the serialised body.
  - Save in raw mode issues `PUT /api/template` with the raw text.
  - Reset re-fetches and re-parses.
  - Pre-save validity guard: empty cards array disables Save with the empty-template tooltip.
  - Pre-save validity guard: cards with no `user` role disables Save with the no-user tooltip.
  - Pre-save validity guard: any card with trimmed-empty body disables Save with the empty-body tooltip.
  - Lossy-normalize strip: when `topLevelContentDropped===true`, the persistent warning strip is rendered in cards mode and remains rendered after cards are edited (NOT dismissible).
  - cards → raw toggle in a lossy-load fixture: textarea contents equal the pre-load source verbatim.
  - `saved` event is emitted after successful save in cards mode AND in raw-fallback mode (regression guard for the baseline `PromptEditor component events` requirement).

## 7. Variable list source

- [x] 7.1 Audit how `PromptEditor.vue` currently fetches variables from `GET /api/plugins/parameters?series=…&story=…` and reuse that fetch as the source for both the global pill row (raw-fallback mode) and the per-card "插入變數" helper.
- [x] 7.2 Provide the variable list to `PromptEditorMessageCard` either via a prop drilled from `PromptEditor.vue` or via `provide`/`inject` (pick whichever matches existing project conventions).
- [x] 7.3 Verify the existing `AbortController` cancellation behaviour for the variable fetch on story-context change still works (regression guard for the existing requirement).

## 8. Manual browser smoke (agent-browser)

- [ ] 8.1 Build the reader (`deno task build:reader`) and start the dev server.
- [ ] 8.2 Navigate to `/settings/prompt-editor`, confirm cards mode renders for a parseable `system.md`.
- [ ] 8.3 Add a card, edit role to "user", type a body with a variable inserted via the helper, save. Confirm the file on disk contains the expected `{{ message "user" }}…{{ /message }}` block.
- [ ] 8.4 Reorder cards via up/down buttons; confirm visual transition; save; reload; confirm order persisted.
- [ ] 8.5 Delete a card via the inline confirmation; cancel once, then confirm; save; reload.
- [ ] 8.6 Force a parse failure (manually edit `system.md` on disk to nest a `{{ message }}` opener); reload the page; confirm the warning banner and raw-text fallback render.
- [ ] 8.7 Toggle "進階：純文字模式" round-trip; confirm content is preserved both ways.
- [ ] 8.8 Confirm the page itself does not scroll for very long bodies (cards-list scroll only).

## 9. Tests

- [x] 9.1 Run `deno task test:frontend` and confirm all new and existing tests pass.
- [x] 9.2 Run `deno task test` to ensure backend tests (which should be unaffected) still pass.

## 10. Documentation

- [x] 10.1 Update `docs/prompt-template.md`: add a new "Editing in the Prompt Editor UI" subsection describing the cards-mode UX, the variable-insert helper, the raw-fallback toggle, and the lossy-normalize round-trip caveat (zh-TW UI strings, English doc body to match the existing file's language conventions).
- [x] 10.2 Update `AGENTS.md` Frontend section: brief mention that the prompt editor is now message-card-based and links to `docs/prompt-template.md` for details.
- [x] 10.3 Update `AGENTS.md` Project Structure listing: add `PromptEditorMessageCard.vue` and `lib/template-parser.ts`.

## 11. Validate change

- [x] 11.1 Run `openspec validate prompt-editor-message-ui --strict` and resolve any errors.

## 12. Final rubber-duck

- [ ] 12.1 Run a sync rubber-duck pass on the full change (proposal + design + spec deltas + tasks) using model `gpt-5.5`. Address any BLOCKING findings; either incorporate or justify-and-skip non-blocking findings.
- [ ] 12.2 Re-run `openspec validate prompt-editor-message-ui --strict` after addressing rubber-duck findings.
