# Writer Backend

## ADDED Requirements

### Requirement: Theme route registration

The writer backend SHALL register `GET /api/themes` and `GET /api/themes/:id` from a new module `writer/routes/themes.ts` via a `registerThemeRoutes(app, deps)` helper, mounted **before** the global passphrase middleware so the routes are publicly accessible. The handlers SHALL read from an in-memory theme index populated at startup by `writer/lib/themes.ts`, which scans the directory configured by the `THEME_DIR` environment variable (default `./themes/`).

#### Scenario: Routes are mounted before auth middleware
- **WHEN** the server starts and registers routes
- **THEN** `GET /api/themes` and `GET /api/themes/:id` SHALL be reachable without an `X-Passphrase` header (HTTP 200), exactly as the previously public `GET /api/config` was

#### Scenario: THEME_DIR is loaded into config
- **WHEN** `writer/lib/config.ts` is imported
- **THEN** the exported config object SHALL contain a `THEME_DIR` field of type `string` defaulting to `./themes/` and SHALL NOT contain a `BACKGROUND_IMAGE` field

#### Scenario: Theme index is populated at startup
- **GIVEN** `THEME_DIR` points at a directory containing `default.toml`, `light.toml`, `dark.toml`
- **WHEN** the server has finished initialising
- **THEN** the in-memory theme index SHALL contain three entries keyed by id, and `GET /api/themes` SHALL return all three

## REMOVED Requirements

### Requirement: Public /api/config endpoint registration
**Reason**: The `/api/config` endpoint and its `writer/routes/config.ts` module are deleted. The single payload it returned (`backgroundImage`) is replaced by the per-theme `backgroundImage` field exposed through `GET /api/themes/:id`.
**Migration**: Remove the `registerConfigRoutes` import and call from `writer/app.ts`. Frontend callers must switch from `GET /api/config` to `GET /api/themes/:id`. No `/api/config`-shaped response remains in the codebase.
