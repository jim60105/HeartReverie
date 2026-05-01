## Context

The Prompt Editor (`reader-src/src/components/PromptEditor.vue`, route `/settings/prompt-editor`) is currently a single `<textarea>` over the entire raw Vento source loaded from `GET /api/template`. The user types Vento by hand and clicks Save (`PUT /api/template`) or Reset (`DELETE /api/template`). After `multi-message-prompt-template`, the template's primary structural unit becomes the `{{ message "<role>" }}…{{ /message }}` block. Authoring multi-turn prompts in a flat textarea is error-prone — the user must hand-balance openers/closers, remember the role allow-list, and reorder turns by cut/paste.

This change makes the editor's representation match the template's logical structure: a list of message cards. The page loads `system.md`, parses the message blocks into cards, lets the user edit/reorder/add/delete cards, then serialises back on save.

## Goals / Non-Goals

**Goals:**
- Each `{{ message }}` block in `system.md` maps to one editable card in the UI.
- Adding, deleting, reordering, and changing the role of a message is a one-click operation.
- The body of each card remains free-form Vento source — authors can still write `{{ for }}`, `{{ if }}`, `{{ user_input }}`, etc.
- The variable-insert helper makes the most common Vento expressions discoverable without referring to docs.
- A user who lands on the page with a parseable `system.md` sees their existing turns as cards immediately.
- A user with a non-parseable `system.md` still has a working editor (raw-text fallback) and a clear warning message.

**Non-Goals:**
- Byte-exact round-trip. Comments outside `{{ message }}` blocks, blank-line counts, and trailing whitespace MAY be normalised on save. Authors needing fidelity use the raw-text fallback toggle.
- Drag-and-drop reordering (buttons-only per user decision; revisit in a follow-up).
- Per-card live preview. The existing `PromptPreview` (assembled-messages cards) continues to be the preview UI.
- Tag-aware syntax highlighting inside the body textarea.
- Schema-level validation of Vento expressions inside the body — that's the server's job at render time.

## Decisions

### D1. Card model

`MessageCard = { id: string; role: "system" | "user" | "assistant"; body: string }`. `id` is a frontend-generated UUID (`crypto.randomUUID()`) used purely as a stable key for `<TransitionGroup>` and reorder operations — never persisted to disk. `role` is constrained to the same allow-list as the `{{ message }}` tag. `body` is the raw Vento source between the opener and closer (verbatim — leading/trailing whitespace stripped only by the serialiser, not by the parser, so editor round-trips don't trim user content unexpectedly).

### D2. Parser strategy: hand-rolled scanner, NOT ventojs in the browser

The frontend parser walks the source character-by-character looking for `{{ message "<role>" }}` openers and matching `{{ /message }}` closers. It tracks a few mutually-exclusive lexer states to skip false positives:
- **Inside a Vento expression** (`{{` … `}}`): tag tokens are recognised here.
- **Inside a Vento comment** (`{{# … #}}`): everything until `#}}` is skipped.
- **Inside a string literal within an expression** (`"…"` or `'…'`): skipped so a literal containing `{{ message }}` doesn't match.

The parser does NOT need to fully parse Vento — it only needs to find balanced `{{ message }}` / `{{ /message }}` pairs at top level. A nested `{{ message }}` (which the backend rejects at compile time) is treated as a parse failure, triggering raw fallback.

**Rationale:** importing ventojs into the browser would bloat the bundle and create a divergence risk between server- and client-side parsing. A small hand-rolled scanner is enough because we only care about message boundaries, not full template semantics. All complex edge cases are covered by `template-parser.test.ts`.

### D3. Top-level content handling: lossy normalize

Anything outside any `{{ message }}` block (free text, `{{ for }}`/`{{ if }}` blocks, comments, whitespace) is concatenated in source order, trimmed of leading/trailing whitespace, and produced as a single leading `system` card. Adjacent free-text segments around a message block are merged into the surrounding leading-system card if non-empty; any free text appearing AFTER the first `{{ message }}` block is discarded with a warning entry in the parser result. This matches the user-confirmed "lossy normalize" semantics.

**Rationale:** preserving every interstitial segment as a separate "raw card" would clutter the UI for the common case (most templates either have everything inside `{{ message }}` blocks or have a single header preamble). Authors who need fidelity have the raw-text toggle.

### D4. Parse-failure fallback

If the parser detects (a) unbalanced `{{ message }}` / `{{ /message }}` pairs, (b) an unknown role string in an opener, (c) a nested `{{ message }}` opener inside another, or (d) any unexpected token sequence the scanner cannot recover from, it returns `{ cards: null, parseError: string }`. The editor then renders the original raw source in a fullscreen `<textarea>` (the legacy editor) plus a non-blocking warning banner ("範本解析失敗，已切換為純文字模式：<reason>"). The Save flow in raw-fallback mode just `PUT`s the textarea contents directly — no serialisation step.

The user can ALWAYS opt into raw-fallback mode manually via a "進階：純文字模式" toggle in the toolbar, even when parsing succeeded. Toggling back to card mode re-runs the parser; if it now fails (because the user's manual edits broke balance), the editor stays in raw mode with a warning.

### D5. Serialiser shape

`serializeMessageCards(cards: MessageCard[]): string` produces:

```
{{ message "<role>" }}
<body>
{{ /message }}

{{ message "<role>" }}
<body>
{{ /message }}
```

with: a trailing newline at the end of the file; a single blank line between blocks; the body inserted exactly as-is (no auto-indent, no entity escaping); roles always written as double-quoted string literals (matching the template's allow-list and the SSTI whitelist's literal-role pattern). If `body` is empty the block is still emitted (the user explicitly created a placeholder card).

If a card's `role` value is not in the allow-list at save time (shouldn't happen — the role `<select>` constrains input — but defensive), the serialiser refuses with an error displayed inline near the offending card; Save is blocked until the user picks a valid role.

### D6. Reorder UX: up/down buttons

Each card has an up button (disabled on the first card) and a down button (disabled on the last card). Clicking swaps the card with its adjacent sibling in the `cards` array. Vue's `<TransitionGroup>` provides a brief slide animation keyed off `card.id`. Buttons keep keyboard accessibility cheap (`<button>` elements with explicit `aria-label`) and avoid the `vuedraggable` dependency.

**Rationale:** `vuedraggable` is ~30 KB and adds touch-handling complexity. Up/down buttons are good enough for the typical case (5–15 messages) and align with the user's stated preference.

### D7. Variable-insert helper

A "插入變數" dropdown above each card's body textarea lists the variables exposed by the existing PromptPreview "variables" pills. The list is loaded once per page-mount via the same fetch that already powers `PromptPreview` and is shared across all cards via the composable. Selecting an item calls `insertAtCursor(cardId, "{{ var_name }}")` which uses `HTMLTextAreaElement.setRangeText()` to insert at the caret position and refocuses. The dropdown closes on selection.

The helper is a UX nicety — authors can always type Vento manually. The helper is read-only (it does not modify the variable list — that comes from the server).

### D8. Delete confirmation

A small confirm dialog ("確定刪除這則訊息？") fires on the delete-button click. The user explicitly accepted some friction here because accidental deletion of a 50-line system message would be painful. Implementation: a tiny inline confirmation card replacing the message card body for that one item (no modal overlay) — keeps focus and screen-reader flow predictable.

### D9. Preview integration

`PromptPreview` continues to render the assembled `ChatMessage[]` (per the `multi-message-prompt-template` change). When the user clicks the existing "預覽" button in the toolbar:
1. The frontend serialises the current cards (or uses the raw textarea contents when in fallback mode).
2. It POSTs the result to `/api/stories/:series/:name/preview-prompt` exactly as today (the body now includes the `template` override field already specified in `multi-message-prompt-template`).
3. The response's `messages: ChatMessage[]` is rendered as per-message preview cards.

This means the editor and the preview agree on the structure: the user sees their authored cards translated to the actual messages the server will send.

### D10. Save semantics with `isDirty`

`isDirty` is recomputed reactively from a deep comparison of the current `cards` array against a snapshot taken at last load/save. Because `MessageCard.id` is internal (not persisted), the comparison ignores `id` — it diffs only `role` and `body` for each card, plus card count and order. Reorders count as dirty.

In raw-fallback mode, `isDirty` reverts to the pre-existing string comparison against the loaded source.

### D11. Empty-state handling

If `parseSystemTemplate()` returns an empty card array (e.g. the user had a completely empty `system.md`), the editor renders a single empty placeholder card (role: `system`, body: `""`) and a hint above the toolbar: "從新增訊息開始編寫範本". Saving an empty array is rejected with an inline error — every saved template must have at least one card so the assembled `messages[]` can satisfy the server's `multi-message:no-user-message` check.

### D12. Test coverage

`template-parser.test.ts` covers:
- Round-trip: `serialize(parse(source)).cards == parse(source).cards` for a representative library of templates.
- Parser edge cases: `{{# {{ message "user" }} #}}` (commented-out tag), `"{{ message \"user\" }}"` (string literal), unbalanced openers, unknown role, nested openers, no `{{ message }}` blocks at all, only top-level content.
- Lossy-normalize: a template with mixed top-level text + message blocks produces exactly the expected leading-system card content.

`PromptEditor.test.ts` covers:
- Load → edit role → reorder → save → assert PUT body is the expected serialised string.
- Add card → assert new card is appended with default role `system`.
- Delete → confirm dialog accepted → assert card removed.
- Parse failure → raw-fallback banner is shown and the textarea contains the original source.
- Toggle raw-fallback manually → toggle back → re-parse runs.

## Risks / Trade-offs

- **Round-trip lossiness can surprise users.** Mitigations: warning banner on first save after a load that lost content; "進階：純文字模式" toggle is always available; the docs explicitly call out the limitation.
- **Hand-rolled parser maintenance**: if Vento adds new comment / string-literal syntax in a future upgrade, the scanner could miss-skip and false-match a `{{ message }}` token inside a string. Mitigation: tests cover today's syntax exhaustively; CI catches breakage when ventojs is upgraded; raw-fallback mode is the safety net.
- **No drag-and-drop**: power users with 20+ messages may dislike up/down clicking. Mitigation: deferred to a follow-up; the buttons are keyboard-accessible.
- **Variable list staleness**: the variable-insert helper caches the variable list at page mount. If the user installs a new plugin while editing without reloading, the new variables won't show up. Mitigation: a small refresh button next to the dropdown (low effort) or accept the limitation in v1 (the variable list is ALSO available from the existing PromptPreview pills, which already have this behaviour).
- **Scoped CSS overflow**: long bodies inside cards can balloon the page height. Mitigation: each card's body textarea has a `min-height` of ~6 rows and is `resize: vertical` so the user controls expansion; the card list uses the existing settings-content scroll container.

## Open Questions

- Should we preserve top-level template comments (`{{# … #}}`) as a special non-editable "備註" card so they survive save? Currently scoped out (lossy normalize). Revisit if user feedback reports lost comments.
- Should the role `<select>` show role labels in zh-TW (e.g. "系統" / "使用者" / "助理") or the literal English role keywords? Current default: zh-TW labels in the option text, but the underlying value is the English role keyword that the serialiser writes.
