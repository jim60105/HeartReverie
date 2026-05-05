## 1. Plugin Manager Infrastructure

- [ ] 1.1 Add `settingsSchema` field support to plugin manifest validation in `plugin-manager.ts`
- [ ] 1.2 Implement `registerRoutes` discovery and invocation for plugin backend modules
- [ ] 1.3 Create settings file I/O helpers: read/write `playground/_plugins/<name>/config.json`
- [ ] 1.4 Add JSON Schema validation for plugin settings payloads against declared `settingsSchema`
- [ ] 1.5 Ensure `playground/_plugins/` directory is created on startup if missing

## 2. Plugin Settings API

- [x] 2.1 Implement `GET /api/plugins/:name/settings` returning current config merged with schema defaults
- [x] 2.2 Implement `PUT /api/plugins/:name/settings` with schema validation and persistence
- [x] 2.3 Implement `GET /api/plugins/:name/settings-schema` returning the plugin's declared JSON Schema
- [x] 2.4 Return 404 when plugin has no `settingsSchema` declared
- [x] 2.5 Wire settings routes into `app.ts` router

## 3. Plugin API Routes

- [x] 3.1 Add route mounting logic in `app.ts` to call `registerRoutes(ctx)` per plugin with enriched context (`{ app, basePath, logger, getSettings, config }`)
- [x] 3.2 Mount plugin routes at `/api/plugins/${name}` namespace
- [x] 3.3 Ensure plugin routes are loaded after core middleware but before catch-all handlers
- [x] 3.4 Pass plugin settings helpers to route handlers so plugins can read their own config without reimplementing path logic

## 4. Story Image Serving

- [x] 4.1 Implement `GET /api/stories/:series/:story/images/:filename` endpoint
- [x] 4.2 Add path traversal protection with `^[\w\-\.]+$` regex validation on filename
- [x] 4.3 Apply passphrase auth middleware to image serving route
- [x] 4.4 Infer and set Content-Type from file extension
- [x] 4.5 Set `Cache-Control: public, immutable` response header

## 5. Image Metadata API

- [x] 5.1 Implement `GET /api/stories/:series/:story/image-metadata` endpoint
- [x] 5.2 Accept `chapter` query parameter to filter metadata by chapter number
- [x] 5.3 Read and parse `_images/_metadata.json` from the story directory
- [x] 5.4 Return JSON response with images array (filename, title, status, prompt fields)
- [x] 5.5 Apply passphrase auth middleware to metadata route

## 6. Body Limit and App Configuration

- [x] 6.1 Increase body size limit from 1 MB to 10 MB on `/api/*` routes in `app.ts`
- [x] 6.2 Verify existing routes still function correctly with the new limit

## 7. Frontend Plugin Settings Page

- [x] 7.1 Add `/settings/plugins/:name` route to `reader-src/src/router/`
- [x] 7.2 Update `SettingsLayout.vue` sidebar to dynamically list plugins that have `settingsSchema`
- [x] 7.3 Fetch schema from `GET /api/plugins/:name/settings-schema` for form generation
- [x] 7.4 Implement form auto-generation from JSON Schema (text, number, select, checkbox, password inputs)
- [x] 7.5 Support `x-options-url` schema extension for dynamic dropdown population via fetch (graceful fallback to text input on fetch failure)
- [x] 7.6 Wire form submission to `PUT /api/plugins/:name/settings`
- [x] 7.7 Ensure all fetch calls include passphrase auth headers

## 8. Frontend Hook Context Extension

- [x] 8.1 Extend `frontend-render` hook context to include `{ series, story, chapterNumber }` so plugins can make story-aware API calls
- [x] 8.2 Extend `chapter:dom:ready` hook context to include `{ series, story, chapterNumber }`
- [x] 8.3 Verify existing plugins still function with the extended context

## 9. Legacy Plugin Removal

- [ ] 9.1 Delete `plugins/imgthink/` directory entirely (only after verifying sd-webui-image-gen plugin loads and declares equivalent stripTags)
- [ ] 9.2 Remove any references to `imgthink` in plugin loading or configuration files
- [ ] 9.3 Verify no remaining imports or dependencies on removed plugin code

## 10. Validation

- [ ] 10.1 Run TypeScript type checking across backend (`tsc --noEmit`)
- [ ] 10.2 Run frontend build to verify no compilation errors
- [ ] 10.3 Manually verify plugin settings round-trip: PUT then GET returns saved values
- [ ] 10.4 Manually verify image serving returns correct file with proper headers
- [ ] 10.5 Manually verify path traversal attempts (e.g. `../`) are rejected with 400
- [ ] 10.6 Confirm settings page renders and submits for a plugin with `settingsSchema`
- [ ] 10.7 Verify frontend hook contexts expose series/story/chapterNumber to plugin JS
