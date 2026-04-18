## 1. Backend: types and helpers

- [ ] 1.1 Add `StoryExportJson` response shape to `writer/types.ts` (`{ series, name, exportedAt, chapters: { number, content }[] }`)
- [ ] 1.2 Add a small `writer/lib/export.ts` module exporting `renderMarkdown(series, name, chapters)`, `renderJson(series, name, chapters)`, `renderPlainText(series, name, chapters)`, and a `stripMarkdown(text)` helper
- [ ] 1.3 In `writer/lib/export.ts`, export a `buildContentDisposition(series, name, ext)` helper that emits both ASCII-safe `filename=` and RFC 5987 `filename*=UTF-8''<percent-encoded>` parameters
- [ ] 1.4 Add `PluginManager.getCombinedStripTagPatterns()` in `writer/lib/plugin-manager.ts` that iterates all loaded plugin manifests and collects patterns from BOTH `promptStripTags` and `displayStripTags`, reusing the existing regex-vs-plain-tag handling from `getStripTagPatterns()`. Deduplicate identical raw entries before compiling into a single combined `RegExp | null`. Leave the existing `getStripTagPatterns()` method unchanged.
- [ ] 1.5 Add unit tests in `tests/writer/lib/plugin-manager_test.ts` (or equivalent) for `getCombinedStripTagPatterns()` covering: plugin with only `promptStripTags`, plugin with only `displayStripTags`, plugin with both, regex-form entries in either field, and the null case when neither is declared.

## 2. Backend: route

- [ ] 2.1 Create `writer/routes/export.ts` that registers `GET /api/stories/:series/:name/export`
- [ ] 2.2 Use `validateParams` middleware and `safePath(series, name)` to resolve and validate the story directory
- [ ] 2.3 Read the directory, filter `^\d+\.md$`, sort numerically, load contents, strip plugin tags via `pluginManager.getCombinedStripTagPatterns()` (NOT `getStripTagPatterns()`, which only covers `promptStripTags`), and drop empty-after-trim chapters
- [ ] 2.4 Validate `format` query param (`md` | `json` | `txt`, default `md`); return RFC 9457 400 for unsupported formats
- [ ] 2.5 Dispatch to the matching renderer, set `Content-Type` and `Content-Disposition` headers, return body
- [ ] 2.6 Handle errors: 404 on `Deno.errors.NotFound`, 500 on other read failures, 400 on invalid path
- [ ] 2.7 Register `registerExportRoutes(app, deps)` from `writer/app.ts` alongside the other route registrars

## 3. Backend: tests

- [ ] 3.1 Add `tests/writer/routes/export_test.ts` with a helper that scaffolds a temporary playground directory + stub plugin manager
- [ ] 3.2 Test: default Markdown export returns `text/markdown` with expected chapter ordering
- [ ] 3.3 Test: JSON export matches the `StoryExportJson` shape and is sorted ascending
- [ ] 3.4 Test: plain-text export strips Markdown syntax (heading marks, emphasis, links, code fences)
- [ ] 3.5 Test: unknown format returns 400 Problem Details
- [ ] 3.6 Test: plugin-declared tags from BOTH `promptStripTags` (e.g., `<thinking>`, `<user_message>`) and `displayStripTags` (e.g., `<imgthink>`) are stripped from all three formats, including regex-form patterns declared in either field
- [ ] 3.7 Test: system-reserved `_lore/` directory and non-chapter files are excluded; empty chapters omitted
- [ ] 3.8 Test: missing story returns 404; path traversal (`..`) returns 400
- [ ] 3.9 Test: missing / invalid `X-Passphrase` returns 401 (auth middleware integration)
- [ ] 3.10 Test: `Content-Disposition` header contains ASCII `filename=` and RFC 5987 `filename*=UTF-8''` for non-ASCII names

## 4. Frontend: API client

- [ ] 4.1 Add `exportStory(series, name, format)` to `reader-src/src/composables/useStorySelector.ts` (or a new `useStoryExport.ts` composable)
- [ ] 4.2 Implementation performs `fetch` with `X-Passphrase` header via `useAuth().getAuthHeaders()`, reads response as `Blob`, triggers download using a temporary `<a download>` element and object URL cleanup
- [ ] 4.3 Extend `UseStorySelectorReturn` (in `reader-src/src/types/index.ts`) if the export function is added to the existing composable

## 5. Frontend: UI

- [ ] 5.1 Add an "匯出" section inside the story-selector dropdown in `reader-src/src/components/StorySelector.vue` with three buttons: Markdown / JSON / TXT
- [ ] 5.2 Buttons are disabled when `selectedSeries` or `selectedStory` is empty
- [ ] 5.3 Clicking a button calls `exportStory(series, story, format)` and closes the dropdown on success
- [ ] 5.4 Show a lightweight error state (non-blocking) when export fails (e.g., 404 on a never-saved story)

## 6. Frontend: tests

- [ ] 6.1 Add a Vitest unit test for `exportStory` that mocks `fetch` and asserts the correct URL, headers, and Blob-download path
- [ ] 6.2 Add a component test for `StorySelector.vue` verifying that export buttons are rendered and disabled appropriately

## 7. Docs and final validation

- [ ] 7.1 Update `README.md` (and/or `docs/`) with a short note about the export endpoint and UI control
- [ ] 7.2 Update `AGENTS.md` route list if applicable (mention new `export.ts` route file)
- [ ] 7.3 Run `deno task test` (backend + frontend) and confirm all new + existing tests pass
- [ ] 7.4 Run `deno task build:reader` to confirm the frontend still builds
- [ ] 7.5 Manual smoke test: start server, create a story with a couple of chapters, use the UI to download each format, verify filenames and contents
