## Context

The HeartReverie system prompt is a Vento template (`system.md`) that governs how the LLM generates story content. Currently the frontend stores a user-customised copy of this template in `localStorage` via the `usePromptEditor` composable. On every chat or preview request the frontend sends the full template text in the HTTP body; the backend validates it (SSTI checks) and uses it for that single render.

This architecture has shortcomings for a self-hosted, single-user, programmer-oriented product:

1. **Volatility** — `localStorage` is wiped when the user clears browser data.
2. **Invisibility** — The customised prompt cannot be edited in an IDE, diffed in git, or mounted into a container.
3. **Redundant transfer** — Every chat request sends the entire template (~10-50 KB) over the wire even though it rarely changes.

The backend already has `GET /api/template` (reads `system.md` from disk) and both chat/preview routes accept an optional `template` body override. Adding a `PUT /api/template` endpoint and a `PROMPT_FILE` env var is the minimal change to persist prompts server-side.

## Goals / Non-Goals

**Goals:**

- Persist the custom prompt as a server-side file so it survives browser cache clears.
- Allow users to edit the prompt via external tools (IDE, `vim`, `sed`) outside the web UI.
- Keep the built-in `system.md` untouched as the "factory default" for reset.
- Support container deployments where `PROMPT_FILE` is a mounted volume path.
- Provide explicit save UX with dirty-state feedback (not auto-save on keystroke).

**Non-Goals:**

- Multi-user / multi-prompt support (only one custom prompt file).
- Prompt version history or undo stack on the backend.
- Changing the chat/preview request flow — they continue to send the template in the body for preview, and use the server-side file for chat.
- Real-time file-watch sync (if the user edits the file externally, the editor picks it up on next load, not live).

## Decisions

### Decision 1: Single `PROMPT_FILE` env var with sensible default

**Choice**: Introduce `PROMPT_FILE` env var defaulting to `playground/prompts/system.md` (relative to `ROOT_DIR`).

**Rationale**: Keeping the default inside `playground/` means the existing `playground` volume mount in container deployments automatically captures the custom prompt. An absolute path override supports advanced setups.

**Alternatives considered**:
- *Store next to `system.md`* — rejected because `system.md` is tracked in git and the custom file should not be.
- *No env var, hardcoded path* — rejected because container users need flexibility.

### Decision 2: `PUT /api/template` writes the file; `DELETE /api/template` removes it

**Choice**: `PUT /api/template` accepts `{ content: string }`, validates via `validateTemplate()`, and writes to `PROMPT_FILE`. `DELETE /api/template` removes the custom file so `GET /api/template` falls back to `system.md`.

**Rationale**: PUT is idempotent and maps naturally to "save file". DELETE for "reset to default" is cleaner than writing `system.md` content into the custom file (avoids drift if `system.md` is updated).

**Alternatives considered**:
- *POST for create, PUT for update* — unnecessary complexity for a single-file resource.
- *Reset via PUT with system.md content* — rejected; leaves a file that drifts from the real default over time.

### Decision 3: `GET /api/template` returns custom file with fallback

**Choice**: `GET /api/template` reads `PROMPT_FILE` first; if the file does not exist, reads `system.md`. Response includes a `source` field (`"custom"` or `"default"`) so the frontend knows which is active.

**Rationale**: The frontend needs to know whether a custom prompt is in effect to show the correct UI state (e.g., "modified" badge, enable/disable reset button).

### Decision 4: Chat uses server-side file, not body override

**Choice**: Modify the chat route so that when no `template` body field is sent, it reads from `PROMPT_FILE` (then falls back to `system.md`), instead of always reading `system.md`. The frontend stops sending `template` in the chat body — the server-side file is the source of truth.

**Rationale**: Eliminates redundant template transfer on every chat request. The preview route continues to accept `template` in the body for live preview of unsaved edits.

**Alternatives considered**:
- *Keep sending template in body* — wasteful; the saved file is already there.

### Decision 5: Explicit save button with dirty-state tracking

**Choice**: The `usePromptEditor` composable tracks `isDirty` (content differs from last-saved version). The UI shows a "儲存" button that is enabled only when dirty. Save calls `PUT /api/template`; success resets dirty state. No auto-save, no debounced write.

**Rationale**: Avoids disk wear from keystroke-level writes. Users expect explicit save for file operations. Matches IDE mental model.

### Decision 6: SSTI validation on PUT, not on chat

**Choice**: `PUT /api/template` runs `validateTemplate()` before writing. The chat route trusts the already-validated file.

**Rationale**: Validate once at write time, not on every request. The file can only be written via the validated PUT endpoint (or manually by the user, who is trusted as a self-hosted operator).

## Risks / Trade-offs

- **[External edits bypass validation]** → A user editing `PROMPT_FILE` directly in an IDE can introduce unsafe Vento expressions. Mitigation: `renderSystemPrompt()` already catches Vento evaluation errors gracefully. Self-hosted users are trusted operators.
- **[Directory creation on first save]** → `PROMPT_FILE` parent directory may not exist. Mitigation: `PUT /api/template` calls `Deno.mkdir` with `{ recursive: true }` before writing.
- **[Breaking change if client expects localStorage]** → The `localStorage` key `story-editor-template` will be ignored. Mitigation: On first load, if `localStorage` contains a saved template and the server reports `source: "default"`, offer a one-time migration prompt. (Low priority — can be deferred.)
