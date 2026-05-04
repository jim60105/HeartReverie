## Why

The reader currently hard-codes a single dark, rose-tinted colour palette in `reader-src/src/styles/theme.css` and exposes only the background image as a runtime knob (`BACKGROUND_IMAGE` env var, surfaced through `useBackground` and `/api/config`). Operators who want a light scheme, a softer dark scheme, or a different atmospheric image have no way to switch without editing the source. Plugins already consume the same CSS custom properties (`--border-color`, `--panel-bg`, `--text-main`, …), so a proper theme system that swaps these tokens at runtime gives operators full visual customisation in a single mechanism while keeping plugin styling stable.

This change introduces user-defined themes as plain-text TOML files discovered from a configurable directory, served through new `/api/themes` endpoints, applied to `:root` by the SPA, persisted in `localStorage`, and selectable from a dropdown in the existing settings UI. The current `frontend-background` capability is fully subsumed and removed (the project is pre-release; no backward compatibility is required).

## What Changes

- **NEW** Theme files: plain-text TOML, one per theme, declaring `id`, `label`, the full set of CSS custom properties currently defined in `reader-src/src/styles/theme.css` (36 properties — see design.md §D2 for the exhaustive list), and an optional `backgroundImage` URL constrained to same-origin paths or `data:` URLs (matching the existing `img-src 'self' data:` CSP).
- **NEW** Theme directory: `THEME_DIR` env var (default `./themes/`) — backend discovers `*.toml` files at startup and on a refresh request.
- **NEW** Backend endpoints (no auth, like `/api/config`):
  - `GET /api/themes` → `[{ id, label }]` list
  - `GET /api/themes/:id` → full parsed theme JSON (palette + backgroundImage)
- **NEW** Three built-in themes shipped under `themes/`: `default.toml` (verbatim migration of the current palette + `BACKGROUND_IMAGE` default `/assets/heart.webp`), `light.toml`, `dark.toml`.
- **NEW** Static FOUC boot script `reader-src/public/theme-boot.js` (served from `/theme-boot.js`, satisfies `script-src 'self'`) loaded via `<script src="/theme-boot.js"></script>` *before* the Vite module entry. Reads `localStorage["heartReverie.themeId"]` and applies cached CSS variables to `document.documentElement.style` before Vue mounts, eliminating FOUC on theme switch. (An inline script is **not** an option — the existing CSP `script-src 'self'` with no nonce blocks inline scripts.)
- **NEW** `useTheme` composable replacing `useBackground`: fetches `/api/themes/:id`, applies CSS custom properties to `:root`, sets `body` background image, persists selection, caches the parsed theme in `localStorage` for the next-load FOUC guard.
- **NEW** Theme dropdown in the existing Settings page (new `ThemeSettingsPage.vue` under `/settings/theme`) — lists themes from `/api/themes` and lets the user switch.
- **REMOVED** `BACKGROUND_IMAGE` env var, `/api/config` background plumbing, `useBackground` composable, and the `frontend-background` capability. The default visual must be byte-for-byte identical: `default.toml` reproduces every value currently in `theme.css` and the `/assets/heart.webp` background.
- **STABLE** All CSS custom property names are preserved verbatim so plugin stylesheets continue to work without changes.

## Capabilities

### New Capabilities

- `theme-system`: User-selectable themes via TOML files in `THEME_DIR`, exposed through `GET /api/themes` + `GET /api/themes/:id`, applied to `:root` CSS custom properties on the SPA, persisted in `localStorage`, with an inline boot script for FOUC prevention and a dropdown selector in the Settings page.

### Modified Capabilities

- `frontend-background`: **REMOVED**. Subsumed by `theme-system` — background image is now part of each theme's TOML payload, no longer a top-level env var or `/api/config` field.
- `env-example`: Remove the `BACKGROUND_IMAGE` row; add a `THEME_DIR` row.
- `writer-backend`: Replace the `/api/config` background plumbing with `/api/themes` and `/api/themes/:id` route registration; add `THEME_DIR` to the config module.
- `settings-page`: Add a new `/settings/theme` child route and tab entry pointing to `ThemeSettingsPage.vue`.

## Impact

- **Backend**: `writer/lib/config.ts` (drop `BACKGROUND_IMAGE`, add `THEME_DIR`), new `writer/lib/themes.ts` (TOML loader using Deno std `@std/toml`), new `writer/routes/themes.ts`, simplified or removed `writer/routes/config.ts`, `writer/types.ts` updates, `.env.example`, `helm/heart-reverie/values.yaml`, `README.md`, `AGENTS.md`.
- **Frontend**: new `reader-src/src/composables/useTheme.ts`, deleted `useBackground.ts`, new `ThemeSettingsPage.vue` and routing entry, new static FOUC boot script at `reader-src/public/theme-boot.js` referenced from `reader-src/index.html`, updated `App.vue` to call `useTheme().applyTheme()` on mount.
- **Themes**: new `themes/default.toml`, `themes/light.toml`, `themes/dark.toml`.
- **Tests**: new `tests/writer/lib/themes_test.ts` (TOML parsing, directory discovery, malformed file handling), new `tests/writer/routes/themes_test.ts`, new `reader-src/src/composables/__tests__/useTheme.test.ts` (apply, persistence), removed `frontend-background` tests.
- **Specs**: add `openspec/specs/theme-system/`, remove `openspec/specs/frontend-background/`, edit `env-example`, `writer-backend`, `settings-page` deltas.
- **Plugins**: zero changes — CSS variable names unchanged.
