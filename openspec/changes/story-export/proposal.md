## Why

HeartReverie stores stories as numbered chapter `.md` files in `playground/<series>/<story>/`, but there is no way for users to take their stories out of the system. Readers cannot download a finished story for offline reading, sharing, archival, or further editing in external tools. Adding export endpoints and a UI affordance turns the playground directory into a usable publication source rather than an opaque internal format.

## What Changes

- Add a backend endpoint `GET /api/stories/:series/:name/export?format=md|json|txt` that concatenates all numbered chapters for a story and returns a single downloadable file.
- Support three export formats:
  - `md` (default): single Markdown file with a title header and chapter separators.
  - `json`: structured payload with `series`, `name`, `exportedAt`, and an array of `{ number, content }` chapter entries.
  - `txt`: plain-text version with Markdown syntax stripped, suitable for distraction-free reading.
- Strip plugin-declared tags from chapter content before export, reusing the existing `promptStripTags` / `displayStripTags` mechanisms so `<thinking>`, `<user_message>`, and other internal markup do not leak into exported output.
- Require passphrase authentication on the export endpoint (same auth middleware as other `/api/*` routes).
- Exclude system-reserved directories (names starting with `_`, e.g. `_lore/`) from export — only numeric `NNN.md` chapter files are included.
- Add an "匯出" (Export) control to the story selector UI that lets users choose a format and triggers a browser download of the current story.
- Set appropriate `Content-Type` and `Content-Disposition: attachment; filename=...` headers so the browser saves the file with a predictable name (`<series>-<name>.<ext>`).

## Capabilities

### New Capabilities
- `story-export`: Download a complete story in Markdown, JSON, or plain-text format via an authenticated API endpoint, with a frontend control to trigger the download.

### Modified Capabilities
<!-- None. Existing story listing, chapter read, and plugin tag-stripping capabilities are reused but their requirements are not changing. -->

## Impact

- **Backend**: new route file `writer/routes/export.ts` (or an export route added alongside `writer/routes/stories.ts`) registered from `writer/app.ts`; reuses `safePath`, auth middleware, and `PluginManager.getStripTagPatterns()` from `writer/lib/plugin-manager.ts`.
- **Types**: new shared response shape for JSON export added to `writer/types.ts`.
- **Frontend**: additions to `reader-src/src/composables/useStorySelector.ts` (export action) and `reader-src/src/components/StorySelector.vue` (UI control); optional small helper for triggering browser downloads.
- **Tests**: new backend test file under `tests/writer/routes/` covering all three formats, tag stripping, auth enforcement, 404 on missing story, and path-traversal rejection.
- **Docs**: README / user-facing docs updated to mention the export feature; no changes required to the prompt template or plugin system contracts.
- **Out of scope**: EPUB format, bulk export of multiple stories, and server-side archival; these can be layered on later without breaking the endpoint contract.
