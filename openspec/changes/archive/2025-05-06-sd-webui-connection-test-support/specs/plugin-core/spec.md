## MODIFIED Requirements

### Requirement: SPA fallback does not shadow async plugin routes

The SPA fallback (`app.get("*")` serving `index.html`) SHALL be registered only AFTER all async plugin routes are initialized via `initPluginRoutes()`. This ensures plugin GET routes registered during async `registerRoutes()` (which may use dynamic imports) take precedence over the catch-all fallback.

#### Scenario: Async plugin GET route takes precedence

- **GIVEN** a plugin whose `registerRoutes()` awaits a dynamic import before registering `GET /api/plugins/example/data`
- **WHEN** `initPluginRoutes(app)` completes and `registerSpaFallback(app, config)` is called afterward
- **THEN** `GET /api/plugins/example/data` returns the plugin's response (not 404 or index.html)

#### Scenario: Plugin POST routes unaffected (no regression)

- **GIVEN** plugin POST routes (which were never shadowed by GET catch-all)
- **WHEN** the SPA fallback is registered
- **THEN** POST routes continue to work as before

#### Scenario: Non-API paths still serve SPA

- **WHEN** a GET request is made to a non-API, non-asset path (e.g., `/settings/plugins/foo`)
- **THEN** the SPA fallback serves `index.html`

#### Scenario: Missing API routes return proper errors

- **WHEN** a GET request is made to an API-prefixed path that no route handles
- **THEN** the response is determined by Hono's notFound handler (not the SPA fallback serving index.html for API paths)

### Requirement: registerSpaFallback is a separate exported function

The SPA fallback registration SHALL be extracted from `createApp()` into an independently-callable `registerSpaFallback(app, config)` function exported from `writer/app.ts`.

#### Scenario: Called after initPluginRoutes in server.ts

- **GIVEN** the server startup sequence in `server.ts`
- **THEN** `registerSpaFallback(app, config)` is called after `await initPluginRoutes(app)` completes
