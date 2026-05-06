## Why

The plugin settings page lacks support for action buttons — plugins cannot provide interactive operations (like testing a connection) within their settings UI. Additionally, a pre-existing routing bug causes all GET routes registered by async plugins (those using dynamic imports in `registerRoutes`) to return 404, because Hono's `app.get("*")` catch-all registered earlier shadows them.

## What Changes

- Add generic **`x-actions` support** to `PluginSettingsPage.vue` — plugins can define action buttons in their `settingsSchema` that call backend endpoints with current form values, show results, and optionally trigger reload of dynamic options.
- Fix **async plugin route shadowing** — extract the SPA fallback from `createApp()` into a new `registerSpaFallback()` function called after `initPluginRoutes()` in server.ts, ensuring plugin GET routes take priority.

## Capabilities

### New Capabilities

- `plugin-settings-actions`: Generic x-actions schema extension for plugin settings pages, allowing plugins to define action buttons that call backend endpoints with form field values and display results

### Modified Capabilities

- `plugin-core`: Fix SPA fallback registration order to not shadow async plugin GET routes

## Impact

- `reader-src/src/components/PluginSettingsPage.vue` — new UI section, new logic for action buttons
- `writer/app.ts` — SPA fallback extracted to separate exported function
- `writer/server.ts` — call new function after initPluginRoutes
- `tests/writer/routes/spa_fallback_test.ts` — updated for new API
