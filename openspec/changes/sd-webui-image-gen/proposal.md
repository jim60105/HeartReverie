## Why

The HeartReverie plugin system lacks infrastructure for plugins that generate and serve binary assets (images), and for plugins that need persistent user-configurable settings exposed through a settings UI. The upcoming sd-webui-image-gen plugin needs these capabilities.

## What Changes

1. Add a **plugin settings API** — `GET /api/plugins/:name/settings` and `PUT /api/plugins/:name/settings`. Settings stored in `playground/_plugins/<name>/config.json`. Plugins declare settings schema in `plugin.json` via a new `settingsSchema` field.
2. Add a **plugin settings page** extension point in the frontend settings router — plugins with `settingsSchema` get a dedicated settings tab at `/settings/plugins/:name`. The settings layout sidebar discovers and lists these plugins.
3. Add a **story image serving route** — `GET /api/stories/:series/:story/images/:filename` serving binary files from `playground/<series>/<story>/_images/`. Protected by passphrase. Content-type inferred from extension.
4. Add an **image metadata API** — `GET /api/stories/:series/:story/image-metadata` returning JSON metadata about generated images for a chapter (title, filename, prompt, status).
5. **Remove `plugins/imgthink/`** directory — its functionality (displayStripTags for `<imgthink>`) migrates to the new sd-webui-image-gen plugin in HeartReverie_Plugins.
6. Increase `/api/*` body limit to accommodate image data transfer (base64 images from sd-webui can be large).

## Capabilities

### New Capabilities

- `plugin-settings` — Plugin settings storage, API, and frontend settings page
- `story-image-serving` — Serving generated binary images from story directories + metadata API

### Modified Capabilities

- `plugin-core` — Add `settingsSchema` manifest field, add settings discovery to plugin loader
- `settings-page` — Add dynamic plugin settings tabs

## Impact

- `writer/app.ts` — new routes, body limit increase
- `writer/lib/plugin-manager.ts` — settings schema validation, settings file I/O
- `reader-src/src/router/` — new `/settings/plugins/:name` route
- `reader-src/src/components/SettingsLayout.vue` — dynamic plugin tabs in sidebar
- `plugins/imgthink/` — removed (migration)
- `playground/_plugins/` — new directory for plugin settings storage
