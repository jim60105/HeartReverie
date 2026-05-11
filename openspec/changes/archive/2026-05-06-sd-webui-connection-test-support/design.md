## Context

PluginSettingsPage.vue renders plugin settings from a JSON Schema (`settingsSchema` in plugin.json). Dynamic dropdowns use `x-options-url` to fetch option lists from the backend. There was no mechanism for plugins to add interactive buttons/actions to their settings page. The sd-webui-image-gen plugin needed a "Test Connection" button to verify sd-webui API reachability before saving settings.

Separately, a routing bug was discovered: Hono's `app.get("*")` SPA fallback, registered synchronously in `createApp()`, shadows all GET routes from plugins with async `registerRoutes` (which await dynamic imports). POST routes worked because no POST catch-all exists.

## Goals / Non-Goals

**Goals:**

- D1: Allow plugins to define action buttons via `x-actions` in their settingsSchema
- D2: Actions send current (unsaved) form values to a backend URL (draft-aware)
- D3: Display action results (success/error) with clear visual indicators
- D4: Optionally reload dynamic options (x-options-url) after a successful action
- D5: Fix SPA fallback to not shadow async plugin GET routes

**Non-Goals:**

- Plugin-specific frontend components (the generic x-actions mechanism serves all plugins)
- Making existing proxy endpoints draft-aware (they continue using saved settings)
- WebSocket-based real-time connection monitoring

## Decisions

### D1: `x-actions` schema extension

Use an array at the root level of settingsSchema alongside `properties`. Each action object defines `id`, `label`, `url`, `method` (defaults to POST), `bodyFields` (which form fields to include), and `reloadOptionsOnSuccess`.

**Why:** JSON Schema supports extension keywords (`x-*`). Keeping actions at root level separates UI behavior from field definitions cleanly.

### D2: Actions use POST with `bodyFields`

Actions POST to their URL with a body containing only the fields specified in `bodyFields`, sourced from current (unsaved) form values.

**Why:** Allows plugins to receive only relevant fields. Using current form values (not saved) lets users test before committing.

### D3: Inline result display

Result shown as inline text below the button with color coding (green `✓` for success, red `✗` for error).

**Why:** Simple, non-intrusive, no modal interruption. Consistent with existing form UX patterns.

### D4: `reloadOptionsOnSuccess` flag

When set to `true`, a successful action triggers `loadDynamicOptionsForSchema()` re-run to refresh all `x-options-url` dropdowns.

**Why:** Common pattern — after verifying connection, reload available models/samplers from the newly-verified endpoint. Uses saved settings (not draft) for reload, which is acceptable since the connection test confirms reachability.

### D5: Extract SPA fallback to `registerSpaFallback()`

Move the `app.get("*")` handler from `createApp()` into a new exported `registerSpaFallback(app, config)` function. Call it in server.ts after `await initPluginRoutes(app)`.

**Why:** Minimal change, no architectural restructuring. The ordering guarantee is enforced by call sequence in server.ts. Alternative considered: middleware-based approach with priority routing — rejected as over-engineering for this issue.

### D6: Action response contract

Action endpoints return JSON: `{ ok: boolean; error?: string; message?: string }`. The core UI shows green "✓" on `ok: true` and red "✗" + `error` text on `ok: false`. Network failures show a generic "網路錯誤，無法執行操作".

**Why:** Simple, consistent contract any plugin can implement. No complex response parsing needed.

## Known Limitations

- **Hardcoded loading/success text:** The loading text "測試中…" and success text "✓ 連線成功" are currently hardcoded in `PluginSettingsPage.vue`. For truly generic actions (e.g., "clear cache", "validate token"), these should be configurable via `loadingLabel`/`successLabel` in the action schema or sourced from the backend `message` field. Acceptable for now since the only consumer is connection testing; tracked as a future improvement.
- **Dynamic options reload uses saved settings:** The action tests with draft values, but `reloadOptionsOnSuccess` triggers option reload using persisted config (not draft). Users must save before dropdowns reflect the tested endpoint. Acceptable workflow: test → save → options populate.

## Risks / Trade-offs

- [`registerSpaFallback` must always be called after `initPluginRoutes`] → Enforced by explicit call order in server.ts. Adding a JSDoc comment documents this constraint.
- [No CSRF protection on action endpoints] → Plugin action routes are behind the existing passphrase gate; no additional CSRF needed for same-origin requests. All installed plugins are considered trusted backend code; `x-actions.url` is expected to be relative/same-origin.
- [No regression test for async plugin GET shadowing] → The existing spa_fallback_test verifies fallback behavior but does not simulate a dynamic-import plugin. The real-world integration test (sd-webui-image-gen proxy routes) serves as the functional regression test.
