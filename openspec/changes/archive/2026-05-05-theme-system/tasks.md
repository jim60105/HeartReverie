## 1. Backend — Config & Theme Loader

- [x] 1.1 Add `THEME_DIR` to `writer/lib/config.ts` (default `./themes/`, resolve relative paths against `Deno.cwd()`); add corresponding readonly field to `AppConfig` in `writer/types.ts`.
- [x] 1.2 Remove `BACKGROUND_IMAGE` from `writer/lib/config.ts` and `writer/types.ts`.
- [x] 1.3 Create `writer/lib/themes.ts` with `loadThemes(dir)`, `getTheme(id)`, `refreshThemes()`, and an in-memory `Map<string, Theme>` index. Use Deno std `@std/toml` for parsing.
- [x] 1.4 Validate each theme: `id` matches filename stem, kebab-case, non-empty; `label` non-empty string; `colorScheme` ∈ `{"light","dark",undefined}`; `backgroundImage` matches `/^(?:\/(?!\/)[^\s]*|data:[^\s]+)$/` or is empty (reject off-origin URLs, protocol-relative URLs, and relative paths with a clear log line); `palette` is `Record<string, string>`. On any validation failure, log and skip the file (do NOT crash startup).
- [x] 1.5 Convert palette keys: each `[palette]` key is stored without the leading `--`; the loader prepends `--` when emitting JSON.
- [x] 1.6 Log a startup banner reporting `themes loaded: N (skipped: M)`.

## 2. Backend — Theme Routes

- [x] 2.1 Create `writer/routes/themes.ts` exporting `registerThemeRoutes(app, deps)`.
- [x] 2.2 Implement `GET /api/themes` returning `[{id,label}]` sorted alphabetically by id.
- [x] 2.3 Implement `GET /api/themes/:id` returning the parsed theme JSON `{id,label,colorScheme,backgroundImage,palette}` with palette keys including the leading `--`. 404 with RFC 9457 Problem Details for unknown id.
- [x] 2.4 Mount `registerThemeRoutes` in `writer/app.ts` BEFORE the passphrase auth middleware (parity with the previous `/api/config` placement).
- [x] 2.5 Call `loadThemes(config.THEME_DIR)` during server startup; tolerate missing directory by logging a warning and starting with an empty index.
- [x] 2.6 Delete `writer/routes/config.ts` and remove its import + `registerConfigRoutes` call from `writer/app.ts`.

## 3. Built-in Theme Files

- [x] 3.1 Create `themes/default.toml`: copy every CSS custom-property from `reader-src/src/styles/theme.css` into a `[palette]` block (keys without leading `--`), preserving values byte-for-byte. Set `id="default"`, `label="心夢預設"`, `colorScheme="dark"`, `backgroundImage="/assets/heart.webp"`.
- [x] 3.2 Create `themes/light.toml`: light scheme (cream/parchment panels, ink-grey text, muted rose accent for branding), `colorScheme="light"`, `backgroundImage=""`.
- [x] 3.3 Create `themes/dark.toml`: neutral dark scheme (slate panels, off-white text, teal accent), `colorScheme="dark"`, `backgroundImage=""`.
- [x] 3.4 Verify by parsing each TOML: every key in `default.toml`'s `[palette]` exists in `theme.css` and vice versa; values match string-equal after trim.

## 4. Frontend — FOUC Boot Script (CSP-compliant)

- [x] 4.1 Create `reader-src/public/theme-boot.js` (Vite copies `public/` verbatim to the dist root → served at `/theme-boot.js` as a same-origin script that satisfies `script-src 'self'`).
- [x] 4.2 The script reads `localStorage.heartReverie.themeId`; if present, reads `localStorage["heartReverie.themeCache." + id]`, parses JSON, applies palette to `document.documentElement.style.setProperty(name, value)`, sets `color-scheme`, and sets `body.style.backgroundImage` (escaping single quotes in the URL value).
- [x] 4.3 If `document.body` is not yet available, defer the body-style write via `document.addEventListener("DOMContentLoaded", applyBg, { once: true })` inside the same script.
- [x] 4.4 Wrap the entire script body in `try/catch` that swallows errors silently.
- [x] 4.5 Add `<script src="/theme-boot.js"></script>` to `reader-src/index.html`, placed **before** `<script type="module" src="/src/main.ts">`. Do NOT inline the script — the existing `<meta http-equiv="Content-Security-Policy" content="...; script-src 'self'; ...">` blocks inline scripts.

## 5. Frontend — useTheme Composable

- [x] 5.1 Create `reader-src/src/composables/useTheme.ts` with:
  - `currentThemeId: Ref<string>` (default `"default"`).
  - `themes: Ref<Array<{id,label}>>` populated by `listThemes()`.
  - `listThemes()`: `GET /api/themes`, populates `themes`.
  - `applyTheme(theme)`: sets palette via `document.documentElement.style.setProperty`, sets `color-scheme`, sets `document.body.style.backgroundImage = theme.backgroundImage ? \`url('\${escape(theme.backgroundImage)}')\` : ""`.
  - `selectTheme(id)`: persists id, fetches `GET /api/themes/:id`, applies, refreshes localStorage cache. On 404 falls back to `"default"`.
  - `applyOnMount()`: read id from localStorage, fetch + apply (called from `App.vue.onMounted`).
- [x] 5.2 Add `UseThemeReturn` interface to `reader-src/src/types/`.
- [x] 5.3 Use `CSS.escape` (or a single-quote escape) when interpolating `backgroundImage` into the `url(...)` string.
- [x] 5.4 Update `App.vue` to call `useTheme().applyOnMount()` from `onMounted`. Remove the `useBackground` import + `applyBackground()` call.
- [x] 5.5 Delete `reader-src/src/composables/useBackground.ts` and its `__tests__` files.
- [x] 5.6 Remove the `UseBackgroundReturn` type alias from `reader-src/src/types/`.

## 6. Frontend — Theme Settings Page

- [x] 6.1 Create `reader-src/src/components/ThemeSettingsPage.vue` rendering a `<select v-model="currentThemeId">` populated from `themes`. All UI strings in zh-TW.
- [x] 6.2 Register the route in `reader-src/src/router/index.ts` as a child of `/settings`: `{ path: 'theme', component: () => import('@/components/ThemeSettingsPage.vue'), meta: { title: '主題' } }`.
- [x] 6.3 The select's `@change` handler MUST call `selectTheme(id)`.

## 7. Documentation

- [x] 7.1 Update `.env.example`: remove the `BACKGROUND_IMAGE` entry; add a `# THEME_DIR=./themes/` entry with a comment.
- [x] 7.2 Update `helm/heart-reverie/values.yaml`: remove `BACKGROUND_IMAGE`; add `THEME_DIR` (commented).
- [x] 7.3 Update `README.md` env var table: replace the `BACKGROUND_IMAGE` row with a `THEME_DIR` row.
- [x] 7.4 Update `AGENTS.md` env var table: same replacement; add a short paragraph describing the theme system and pointing to `themes/`.
- [x] 7.5 Add a brief "Themes" section to `README.md` (zh-TW) explaining the TOML format and how to add a new theme.

## 8. Tests

- [x] 8.1 `tests/writer/lib/themes_test.ts`: parses a valid TOML; rejects id/filename mismatch; skips malformed TOML without throwing; ignores non-`.toml` files; missing directory yields empty index; **rejects off-origin `backgroundImage`** (`https://…`, `//…`, relative paths) with a logged error and the file skipped; **accepts** `backgroundImage` values that are same-origin paths starting with `/` (and not `//`) or `data:` URLs.
- [x] 8.2 `tests/writer/routes/themes_test.ts`: `GET /api/themes` returns the list (no auth); `GET /api/themes/:id` returns full payload with `--` prefixed palette keys; unknown id returns 404 Problem Details; both routes accessible without `X-Passphrase`.
- [x] 8.3 `tests/themes/default_parity_test.ts`: parse `themes/default.toml` and assert that for every CSS custom-property declared in `reader-src/src/styles/theme.css` there is a matching `[palette]` key whose value is string-equal (post-trim).
- [x] 8.4 `reader-src/src/composables/__tests__/useTheme.test.ts`: `applyTheme` writes palette to `document.documentElement.style`; `selectTheme` persists to `localStorage` and refreshes the cache; 404 fallback clears `themeId`.
- [x] 8.5 `reader-src/src/components/__tests__/ThemeSettingsPage.test.ts`: renders one option per theme; selecting an option triggers `selectTheme` and updates `localStorage`.
- [x] 8.6 Delete `tests/writer/routes/config_test.ts` (the `/api/config` route is gone) — or replace its contents with an explicit assertion that `GET /api/config` returns 404.
- [x] 8.7 Run `deno task test` and `cd reader-src && deno task test` (or equivalents) and confirm a green tree.

## 9. Verification

- [x] 9.1 Boot the app with `localStorage` cleared and confirm pixel parity with the pre-change visual (default palette + heart.webp background).
- [x] 9.2 Switch to `light` and `dark` from `/settings/theme`, reload the page, and confirm the FOUC boot script paints the chosen theme on the first frame (no flash of dark default). **Open the browser DevTools Console during reload and confirm zero CSP violations are logged for `/theme-boot.js`** (no "Refused to execute inline script", no "Refused to load the script").
- [x] 9.3 Manually edit `localStorage.heartReverie.themeCache.default` to malformed JSON and reload — page must still mount.
- [x] 9.4 Set `localStorage.heartReverie.themeId = "vanished"` and reload — SPA must recover by falling back to `default` and clearing the stale id.
- [x] 9.5 Confirm no plugin in `HeartReverie_Plugins/` renders incorrectly under any of the three built-in themes (variable names preserved).
- [x] 9.6 Run `openspec validate theme-system --strict` and confirm zero errors.
