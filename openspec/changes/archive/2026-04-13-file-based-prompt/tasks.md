## 1. Backend Configuration

- [x] 1.1 Add `PROMPT_FILE` to `writer/lib/config.ts` with default `playground/prompts/system.md` (relative to `ROOT_DIR`)
- [x] 1.2 Add `PROMPT_FILE` entry to `.env.example` with description and default value comment
- [x] 1.3 Update `AGENTS.md` environment variables table with `PROMPT_FILE`

## 2. Backend API Routes

- [x] 2.1 Modify `GET /api/template` in `writer/routes/prompt.ts` to read `PROMPT_FILE` first, fall back to `system.md`, and include `source` field (`"custom"` or `"default"`) in response
- [x] 2.2 Add `PUT /api/template` route: accept `{ content: string }`, validate with `validateTemplate()`, create parent directories if needed, write to `PROMPT_FILE`, return `{ ok: true }`
- [x] 2.3 Add `DELETE /api/template` route: remove the file at `PROMPT_FILE` (idempotent), return `{ ok: true }`
- [x] 2.4 Modify chat route to read prompt from `PROMPT_FILE` (with `system.md` fallback) when no `template` body field is provided, instead of always reading `system.md`

## 3. Frontend Composable

- [x] 3.1 Rewrite `usePromptEditor.ts`: remove all `localStorage` references (`STORAGE_KEY`, `getItem`, `setItem`, `removeItem`)
- [x] 3.2 Add `isDirty` computed ref comparing `templateContent` against `lastSaved` snapshot
- [x] 3.3 Add `isCustom` ref set from `GET /api/template` `source` field
- [x] 3.4 Add `isSaving` ref for loading state during save operations
- [x] 3.5 Implement `save()` method: call `PUT /api/template`, update `lastSaved` snapshot on success, set `isCustom` to `true`
- [x] 3.6 Rewrite `resetTemplate()`: call `DELETE /api/template`, re-fetch via `GET /api/template`, set `isCustom` to `false`
- [x] 3.7 Remove `savedTemplate` computed — frontend no longer sends template in chat body
- [x] 3.8 Update `loadTemplate()` to read `source` field from response and set `isCustom`

## 4. Frontend UI Components

- [x] 4.1 Add "儲存" (Save) button to `PromptEditor.vue` toolbar, disabled when `!isDirty || isSaving`, shows loading indicator when saving
- [x] 4.2 Update "回復預設" (Reset) button: disabled when `!isCustom`, calls rewritten `resetTemplate()`
- [x] 4.3 Update chat submission in `useChatInput.ts` (or equivalent) to stop sending `template` field in chat request body
- [x] 4.4 Remove `savedTemplate` usage from any component that references it

## 5. Backend Tests

- [x] 5.1 Test `GET /api/template` returns `source: "default"` when no custom file exists
- [x] 5.2 Test `GET /api/template` returns `source: "custom"` and custom content when custom file exists
- [x] 5.3 Test `PUT /api/template` writes file and returns `{ ok: true }`
- [x] 5.4 Test `PUT /api/template` rejects unsafe template with HTTP 422
- [x] 5.5 Test `PUT /api/template` creates parent directories
- [x] 5.6 Test `DELETE /api/template` removes file and returns `{ ok: true }`
- [x] 5.7 Test `DELETE /api/template` is idempotent when file doesn't exist
- [x] 5.8 Test chat route uses server-side file when no template body field provided

## 6. Frontend Tests

- [x] 6.1 Test `usePromptEditor` `isDirty` tracks content changes
- [x] 6.2 Test `usePromptEditor` `save()` calls `PUT /api/template` and resets dirty state
- [x] 6.3 Test `usePromptEditor` `resetTemplate()` calls `DELETE /api/template` and re-fetches
- [x] 6.4 Test `usePromptEditor` `isCustom` set from `source` field
- [x] 6.5 Test `usePromptEditor` contains no `localStorage` references
- [x] 6.6 Test `PromptEditor.vue` save button disabled/enabled states
- [x] 6.7 Test `PromptEditor.vue` reset button disabled when not custom

## 7. Documentation

- [x] 7.1 Update `AGENTS.md` environment variables table with `PROMPT_FILE`
- [x] 7.2 Update `Containerfile` if needed to ensure `playground/prompts/` directory exists in image
