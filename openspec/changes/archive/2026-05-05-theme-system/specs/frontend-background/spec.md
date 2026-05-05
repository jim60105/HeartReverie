# Frontend Background

## REMOVED Requirements

### Requirement: BACKGROUND_IMAGE environment variable
**Reason**: Subsumed by the new `theme-system` capability. The background image is now a per-theme TOML field, not a top-level env var.
**Migration**: Move the previous `BACKGROUND_IMAGE` value into the relevant theme file's `backgroundImage` key (or into a new theme file under `THEME_DIR`). Operators who relied on the default value get the same image automatically because `themes/default.toml` ships with `backgroundImage = "/assets/heart.webp"`.

### Requirement: Assets static route
**Reason**: The static `/assets/` route is unchanged in the codebase, but it is no longer scoped to this capability — it is part of the unified-server static routing surface and remains available for theme-referenced URLs and other assets.
**Migration**: None. The `/assets/*` route continues to serve `<ROOT_DIR>/assets/` exactly as before; the requirement is simply re-homed and is no longer this capability's responsibility.

### Requirement: Public config endpoint
**Reason**: The `GET /api/config` endpoint's only payload was `backgroundImage`, which is now delivered through `GET /api/themes/:id`. The endpoint is removed.
**Migration**: Replace any client call to `GET /api/config` with `GET /api/themes/:id` (id from `localStorage.heartReverie.themeId`, default `"default"`). The new endpoint additionally provides the full palette and label.

### Requirement: Fixed viewport-covering background image
**Reason**: Re-homed into `theme-system`. The body still displays the configured background image as `center/cover no-repeat fixed`, but the value comes from the active theme rather than a single env-derived path.
**Migration**: None for end users — the visual behaviour is identical. The CSS rules in `reader-src/src/styles/base.css` remain unchanged; only the source of the `background-image` URL changes.

### Requirement: Semi-transparent overlay
**Reason**: Re-homed into `theme-system` (the `body::before` 50 %-opacity overlay is independent of which theme is active and is part of the base reading-experience styling).
**Migration**: None — the `body::before` rule in `reader-src/src/styles/base.css` is preserved verbatim.

### Requirement: Frontend config fetching
**Reason**: Replaced by `useTheme()` (see `theme-system` capability), which fetches `GET /api/themes/:id`, applies CSS custom properties, and updates the body background. The `useBackground` composable is deleted.
**Migration**: Code that imported `useBackground` MUST import `useTheme` instead. The `applyBackground()` call in `App.vue` MUST be replaced with `applyTheme()`.
