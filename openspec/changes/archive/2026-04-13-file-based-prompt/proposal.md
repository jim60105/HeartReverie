## Why

The prompt template is currently persisted in the browser's `localStorage`, which is fragile (cleared on cache wipe), invisible to external tools, and impossible to version-control. Because this project targets self-hosted programmers, storing the custom prompt as a server-side file lets users edit it with their local IDE (e.g., VSCode), diff it in git, and mount it into containers — all without touching the web UI.

## What Changes

- **New backend route `PUT /api/template`** — accepts the template body, validates it, and writes it to a configurable file path on disk.
- **Modified `GET /api/template`** — reads the custom file first; falls back to `system.md` (the built-in default) when the custom file does not exist.
- **New environment variable `PROMPT_FILE`** — absolute or relative path where the custom prompt is stored (default: `playground/prompts/system.md`). Container users mount this path; local users let it default.
- **Frontend composable `usePromptEditor` rewritten** — replaces all `localStorage` reads/writes with `GET`/`PUT /api/template` calls. Adds an explicit "Save" button and dirty-state tracking instead of save-on-type.
- **PromptEditor UI gains a save button** — a visible "儲存" (Save) button that is enabled only when the editor content differs from the last-saved version. Provides success/error feedback.
- **Reset behaviour preserved** — "Reset to default" re-reads `system.md` (the built-in template) and deletes the custom file so subsequent loads fall back to the default again.
- **`localStorage` fallback removed** — no more `STORAGE_KEY` or `localStorage.getItem/setItem` in prompt editor code.

## Capabilities

### New Capabilities

- `file-based-prompt-storage`: Server-side file persistence for the custom prompt template, including the `PUT /api/template` write endpoint, the `PROMPT_FILE` environment variable, and the read-with-fallback logic in `GET /api/template`.

### Modified Capabilities

- `prompt-editor`: Add explicit save/dirty-state UI, remove `localStorage` dependency, drive persistence through `PUT /api/template` instead of client-side storage.
- `env-example`: Add `PROMPT_FILE` variable entry with default value and description.

## Impact

- **Backend (`writer/`)**: `writer/routes/prompt.ts` gains the `PUT` handler; `writer/lib/config.ts` reads `PROMPT_FILE`.
- **Frontend (`reader-src/`)**: `usePromptEditor.ts` composable rewritten; `PromptEditor.vue` updated for save button.
- **Configuration**: `.env.example` updated; `AGENTS.md` env table updated.
- **No breaking changes**: The chat and preview routes already accept an optional `template` body field, so existing clients are unaffected. The default behaviour (use `system.md`) is preserved when no custom file exists.
