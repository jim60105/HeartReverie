## Why

Once the `multi-message-prompt-template` change lands, `system.md` becomes a multi-message document where each `{{ message "<role>" }}…{{ /message }}` block declares a discrete chat turn. The current Prompt Editor (`/settings/prompt-editor`) is a single `<textarea>` over the raw Vento source — it gives no visibility into the message structure and no UX for the most common authoring tasks: adding a turn, picking its sender role, reordering turns, deleting a turn. Authors who want to shape multi-turn prompts must hand-edit `{{ message }}` syntax in plain text, including matching openers/closers — error-prone and tedious.

This change rebuilds `PromptEditor.vue` as a structured per-message editor: each chat turn is rendered as its own card with a sender selector, a body editor, and per-card delete + up/down reorder controls. A toolbar provides "Add message" plus the existing Save / Reset / Preview controls. Loading the page parses `system.md` into the cards; saving re-serialises the cards back into Vento source.

This UI is the natural consumer of the `{{ message }}` tag and makes the new authoring model tractable for non-technical prompt designers.

**Depends on**: `multi-message-prompt-template` (provides the `{{ message }}` tag and parsable `system.md` shape).

## What Changes

- **REWRITE**: `reader-src/src/components/PromptEditor.vue` becomes a structured editor instead of a single `<textarea>`. The editor renders an ordered list of "message cards", a toolbar above the list, and the existing inline `PromptPreview` toggle.
- **NEW UI — Message card**: each card displays:
  - A **sender selector** (`<select>`) restricted to the three allowed roles `system | user | assistant`, defaulting to `system` when adding a new card.
  - A **body editor** (a multi-line `<textarea>`) holding the Vento source between `{{ message "<role>" }}` and `{{ /message }}` (raw text — Vento expressions are opaque to the UI).
  - A **variable-insert helper** (a small dropdown/button group above the body) that, on selection, inserts a Vento interpolation (`{{ user_input }}`, `{{ previous_context }}`, `{{ isFirstRound }}`, lore variables, plugin dynamic variables) at the current caret position. The variable list comes from the same source as the existing PromptPreview "variables" pills.
  - An **up button** (move the card one slot earlier; disabled on the first card).
  - A **down button** (move the card one slot later; disabled on the last card).
  - A **delete button** with a per-card confirmation prompt ("Delete this message?") to avoid accidental loss.
- **NEW UI — Toolbar**: gains an "Add message" button that appends a new card at the end (default role `system`, empty body). Existing Save / Reset / Preview controls remain unchanged in behaviour but their wiring moves to the new state shape.
- **NEW UI — Save flow**: when the user clicks Save, the frontend serialises the ordered card list into Vento source (one `{{ message "<role>" }}…{{ /message }}` block per card, joined by a single `\n`), wraps the result with any unchanged file-level prelude/coda the parser preserved (none in v1 — see "lossy normalize" decision), then `PUT`s it to `/api/template` exactly as the current editor does. No backend route shape change.
- **NEW UI — Load flow**: when the page mounts, it `GET`s `/api/template`, then runs a frontend `parseSystemTemplate(source)` function that walks the string for `{{ message "<role>" }}` openers and matching `{{ /message }}` closers, producing a `MessageCard[]` array. **Top-level content (anything outside any `{{ message }}` block) is silently coalesced into a single leading `system` card** — this is the "lossy normalize" semantics the user accepted: comments and inter-block whitespace MAY be repositioned by the round-trip. If parsing fails for any reason (unbalanced tags, unknown role, nested `{{ message }}`), the editor SHALL fall back to a raw-text mode (the existing `<textarea>` over the full source) with a non-blocking warning banner so the user can still edit and recover.
- **NEW frontend type**: `MessageCard = { id: string; role: "system" | "user" | "assistant"; body: string }` in `reader-src/src/types/index.ts` (`id` is a frontend-only client-side UUID for `<TransitionGroup>` keys).
- **NEW composable surface**: `usePromptEditor` (or a sibling composable) gains structured-state helpers: `cards: Ref<MessageCard[]>`, `addCard()`, `deleteCard(id)`, `moveCardUp(id)`, `moveCardDown(id)`, `serializeCards(): string`, `parseTemplate(source): { cards, parseError }`, plus `parseError: Ref<string | null>` and a `useRawFallback: Ref<boolean>` flag.
- **NEW i18n strings** (zh-TW, per project convention): "新增訊息", "刪除訊息", "確定刪除這則訊息？", "上移", "下移", "傳送者", "插入變數", "範本解析失敗，已切換為純文字模式".
- **REMOVED**: nothing from the existing route/API. The `PUT /api/template` endpoint is reused; only the frontend representation changes.
- **NON-GOAL**: byte-exact round-trip. Comments and blank lines outside `{{ message }}` blocks MAY be lost on save (per user-confirmed "lossy normalize"). Authors who need byte fidelity SHALL switch to raw fallback mode (always available behind a "進階：純文字模式" toggle).

## Capabilities

### New Capabilities

- `prompt-editor-message-cards`: The structured per-message editor UI (cards with sender selector + body + reorder/delete + add toolbar), the load-side `parseSystemTemplate()` parser with lossy-normalize semantics for top-level content, the save-side `serializeCards()` formatter, the variable-insert helper inside each card body, and the raw-text fallback when parsing fails.

### Modified Capabilities

- `prompt-editor`: The Editor UI requirement changes — the editor is no longer a single `<textarea>` over the entire template; it is a list of message cards plus a raw-text fallback. Save/reset semantics, the route path, the keyboard shortcuts, and the integration with `PromptPreview` remain unchanged in behaviour.

## Impact

- **Code (frontend)**:
  - `reader-src/src/components/PromptEditor.vue` — full rewrite of the template; replaces the single `<textarea>` with a `<TransitionGroup>` of message-card components + a toolbar; conditionally renders a raw `<textarea>` fallback when parsing fails or the user opts in.
  - `reader-src/src/components/PromptEditorMessageCard.vue` (new) — single message card component with role `<select>`, body `<textarea>`, variable-insert helper, up / down / delete buttons.
  - `reader-src/src/composables/usePromptEditor.ts` — extended with `cards` state, `addCard / deleteCard / moveCardUp / moveCardDown / serializeCards / parseTemplate`, parse-error tracking, raw-fallback flag.
  - `reader-src/src/lib/template-parser.ts` (new) — pure functions `parseSystemTemplate(source: string)` and `serializeMessageCards(cards: MessageCard[])`. Encapsulates the lossy-normalize parser/formatter so it can be unit-tested.
  - `reader-src/src/types/index.ts` — `MessageCard` type and updated `usePromptEditor` return type.
  - `reader-src/src/components/__tests__/PromptEditor.test.ts` and a new `template-parser.test.ts` — tests for the load/save round-trip, reorder/delete actions, fallback path, and lossy-normalize coalescing rules.
- **Code (backend)**: NONE. `GET /api/template` and `PUT /api/template` remain unchanged.
- **Plugin contract**: NONE. Plugins do not interact with the editor.
- **Docs**:
  - `docs/prompt-template.md` — add a "Editing in the Prompt Editor UI" subsection alongside the existing raw-template syntax reference, documenting the per-card model, the variable-insert helper, the raw-fallback toggle, and the lossy-normalize round-trip caveat.
  - `AGENTS.md` — brief mention under the Frontend section that the prompt editor is now message-card-based.
- **Risks**:
  - **Round-trip lossiness**: comments and top-level whitespace are silently coalesced. Mitigated by (a) advertising "進階：純文字模式" raw fallback toggle, (b) the warning banner on parse failure, (c) docs callout.
  - **Parser brittleness**: the frontend parser is a hand-rolled scanner over Vento source; it does NOT use ventojs in the browser. It must correctly skip `{{ message }}`-like text inside Vento string literals (`{{ "{{ message }}" }}` style) and inside `{{# … #}}` comments. Test coverage in `template-parser.test.ts` enumerates these edge cases. If the parser cannot recover, the editor falls back to raw mode — no data loss.
  - **Bundle size**: no new dependency (up/down buttons reuse existing Heroicons or unicode arrows; no `vuedraggable`).
- **Out-of-scope**:
  - Drag-and-drop reordering (deferred — buttons-only per user decision).
  - Per-message preview rendering (deferred — `PromptPreview` continues to show the assembled `messages` array as before).
  - Tag-aware syntax highlighting in the body textarea.
  - Multi-file template support.
