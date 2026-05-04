## Context

The reader's visual palette is hard-coded in `reader-src/src/styles/theme.css` as a set of CSS custom properties on `:root`. The only runtime customisation today is the background image, served via `BACKGROUND_IMAGE` → `/api/config` → `useBackground()` → `document.body.style.backgroundImage`. Plugins under `HeartReverie_Plugins/` reference the same custom properties (e.g. `var(--border-color)`, `var(--text-main)`) in their scoped CSS, so the variable *names* are an implicit cross-component contract.

The project is pre-release; there are no deployed operators and no backwards-compatibility burden. We can replace `BACKGROUND_IMAGE` and the `frontend-background` capability outright.

The backend already has a clean pattern for public unauthenticated config routes (`writer/routes/config.ts` + `registerConfigRoutes`). The frontend already has a Settings page with extensible child routes registered through `meta.title` (see `settings-page` spec). We can plug into both.

## Goals / Non-Goals

**Goals**
- Operators ship arbitrary themes as plain-text files, no rebuild needed.
- A user can switch themes from the Settings UI; the choice is remembered.
- Zero FOUC on the next page load — the previously-chosen theme paints with the first frame.
- Plugin styling continues to work without any change (CSS variable names preserved verbatim).
- The default visual is byte-for-byte identical to today (palette + `/assets/heart.webp`).

**Non-Goals**
- Per-user / per-story themes — single global selection for v1.
- Font-family overrides — `--font-system-ui` and `--font-antique` may live in the theme file but UI exposure is out of scope.
- File-system watcher / hot-reload of theme files — operators restart or hit a refresh endpoint (deferred).
- Uploading or editing themes through the UI — file edits happen on the host filesystem.
- Theme inheritance / partial overrides — each theme is self-contained.

## Decisions

### D1: TOML for theme files

| Format | Pros | Cons |
| --- | --- | --- |
| **TOML** | Human-friendly for hand-edited colour palettes; comments supported; trivial nesting (`[palette]`); `@std/toml` is part of Deno's official std library, zero new dependencies; quoted-string values allow CSS expressions like `linear-gradient(...)` and `rgba(...)` without escaping ceremony. | Slightly more verbose than YAML; only one nesting style. |
| YAML | Compact; comments. | Indentation-sensitive (footgun for users hand-editing colour blocks); Deno std YAML parser exists but YAML's type coercion (`on/off/yes/no`) can corrupt string values; not currently a project dep. |
| JSON | Universally parseable; no new dep (`JSON.parse`). | No comments → poor for hand-edited config; trailing-comma noise; verbose quoting for every key. |

**Decision: TOML.** It scores best on the "operators hand-editing colour palettes" axis, which is the primary use case, and `@std/toml` adds zero supply-chain risk (it's part of Deno's std). Theme files are flat enough that TOML's restricted nesting is not a limitation.

### D2: Theme file schema

Each `*.toml` file under `THEME_DIR` declares:

```toml
id = "default"          # unique kebab-case id, must match filename stem
label = "心夢預設"       # human-readable label shown in dropdown
backgroundImage = "/assets/heart.webp"  # OPTIONAL. Same-origin path (must start with "/") or data: URL only. "" or omitted ⇒ no image. See D2a for the rationale.

[palette]
# Every CSS custom property declared in reader-src/src/styles/theme.css.
# Property name → string value applied verbatim to :root.
header-height            = "34px"
panel-bg                 = "linear-gradient(145deg, #1a0810, #220c16)"
border-color             = "#6d1a2a"
border-inner             = "rgba(255, 80, 120, 0.15)"
border-outer             = "rgba(0, 0, 0, 1)"
header-bg                = "linear-gradient(180deg, #2a0d18 0%, #1a0810 100%)"
header-border            = "#6d1a2a"
section-head-bg          = "#3a1020"
section-head-hover       = "#5a1830"
text-main                = "rgba(207, 207, 197, 1)"
text-name                = "#ff8aaa"
text-title               = "#e05070"
text-label               = "#ff7a96"
text-italic              = "rgba(145, 145, 145, 1)"
text-underline           = "rgba(145, 145, 145, 1)"
text-quote               = "rgba(198, 193, 151, 1)"
item-bg                  = "rgba(255, 255, 255, 0.04)"
item-scene-bg            = "rgba(180, 30, 60, 0.18)"
item-border              = "rgba(110, 26, 42, 0.6)"
divider                  = "rgba(110, 26, 42, 0.7)"
btn-bg                   = "rgba(255, 255, 255, 0.04)"
btn-border               = "rgba(110, 26, 42, 0.8)"
btn-hover-bg             = "rgba(180, 30, 60, 0.22)"
btn-hover-border         = "#a0243c"
btn-active-bg            = "rgba(180, 30, 60, 0.12)"
shadow-color             = "rgba(0, 0, 0, 0.9)"
shadow-width             = "2px"
reading-tint             = "rgba(29, 33, 40, 0.9)"
settings-sidebar-width   = "200px"
settings-sidebar-bg      = "linear-gradient(180deg, #2a0d18 0%, #1a0810 100%)"
settings-sidebar-active-bg     = "rgba(180, 30, 60, 0.22)"
settings-sidebar-active-border = "var(--text-title)"
settings-content-padding = "24px"
font-base                = "clamp(0.8rem, 2.5vw, 0.95rem)"
font-system-ui           = "Noto Sans TC, Noto Sans JP, Noto Sans SC, Noto Sans, Noto Color Emoji, Microsoft JhengHei, Heiti TC, system-ui, sans-serif"
font-antique             = "Iansui, Superclarendon, \"Bookman Old Style\", \"URW Bookman\", \"URW Bookman L\", \"Georgia Pro\", Georgia, serif"
```

The **36 properties** above are the **exhaustive** list audited from `reader-src/src/styles/theme.css` (verified with `grep -cE '^\s*--[a-z]' reader-src/src/styles/theme.css` ⇒ 36). Property keys appear under `[palette]` **without** the leading `--`; the loader prepends `--` when emitting JSON to the frontend. The `color-scheme` declaration (`color-scheme: dark`) is applied automatically when the theme JSON has a top-level `colorScheme` field (default: `"dark"`).

#### Deliberately excluded variables (fallback-only, not theme-controlled in v1)

A second-pass audit of `reader-src/src/components/**/*.vue`, `reader-src/src/styles/`, and the plugin repo `HeartReverie_Plugins/**/*.css` (specifically `options/`, `state/`, `status/`, `scene-info-sidebar/`) enumerated the following CSS custom properties that are *referenced* via `var(--x, fallback)` but *not declared* anywhere in `theme.css`:

| Variable | Referenced from |
| --- | --- |
| `--accent-color` | `LlmSettingsPage.vue`, plugins/state |
| `--bg-secondary` | `PromptPreview.vue` |
| `--bg-tertiary` | `PromptPreview.vue` |
| `--diff-added` | plugins/state |
| `--diff-modified` | plugins/state |
| `--diff-removed` | plugins/state |
| `--error-color` | `LlmSettingsPage.vue` |
| `--input-bg` | `LlmSettingsPage.vue` |
| `--muted-color` | `LlmSettingsPage.vue`, plugins/state |
| `--panel-bg-hover` | `PluginActionBar.vue` |
| `--scene-banner-width` | plugins/scene-info-sidebar |
| `--text-color` | plugins/state |
| `--warn-color` | `LlmSettingsPage.vue` |

These 13 variables are **explicitly excluded from the v1 theme schema**. Every consumer references them through `var(--x, <fallback>)`, so the inline fallback paints when the variable is undeclared. The fallbacks are preserved exactly as today: this change does **not** declare them, does **not** require theme files to provide them, and does **not** strip the inline fallbacks from the consumers. A future change can promote any subset to first-class theme tokens once a deliberate light/dark mapping is chosen — at that point the schema would gain new keys and the consumers' inline fallbacks could be dropped.

### D2a: `backgroundImage` is restricted to same-origin paths or `data:` URLs

The reader's CSP declares `img-src 'self' data:` — so `body { background-image: url(...) }` is only honoured by the browser when the URL is same-origin or a `data:` URL. An off-origin URL (e.g. `https://example.com/bg.jpg`) would be refused at paint time, leaving the body with no image and the user with no clue why.

**Rule**: `backgroundImage`, when non-empty, MUST satisfy one of:

1. Start with `/` and **not** start with `//` (a same-origin absolute path, e.g. `/assets/heart.webp`).
2. Start with `data:` (an inline data URL).

Anything else (a `http(s)://…` URL, a protocol-relative `//…` URL, a relative path, or a `file://` URL) is **rejected at parse time**: the loader logs an error including the offending file path and the bad value, skips the file, and excludes it from the in-memory index. The `id`, filename, and bad value all appear in the log line so operators can fix it.

The validator regex used by `writer/lib/themes.ts`:

```ts
const SAFE_BG = /^(?:\/(?!\/)[^\s]*|data:[^\s]+)$/;
function validateBackgroundImage(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || !SAFE_BG.test(v)) {
    throw new Error(`backgroundImage must be a same-origin path ("/...") or a "data:" URL; got ${JSON.stringify(v)}`);
  }
  return v;
}
```

**Alternative considered**: relax the CSP to allow `img-src https:`. Rejected — it would weaken the security posture for a feature (off-origin theme backgrounds) that no operator has asked for, and operators who really need an off-origin asset can serve it themselves under `/assets/` or inline it as a `data:` URL.



- New module `writer/lib/themes.ts`:
  - `loadThemes(dir: string): Promise<ThemeIndex>` — reads `*.toml` from `dir`, parses with `@std/toml`, validates (`id` non-empty kebab-case matching filename stem; `label` non-empty string; `palette` object of string→string; `backgroundImage` validated by the same-origin / `data:` rule from D2a).
  - `getTheme(id: string): Theme | null` — O(1) lookup.
  - `refreshThemes(): Promise<void>` — re-read directory.
  - In-memory `Map<string, Theme>` cache populated on `app.ts` startup.
  - Malformed file ⇒ logged via existing logger and skipped (does not crash startup); a startup banner reports `themes loaded: N (skipped: M)`.
- New `writer/routes/themes.ts` registers two **public, unauthenticated** routes (parity with the existing `/api/config`):
  - `GET /api/themes` → `[{ id, label }]`
  - `GET /api/themes/:id` → `{ id, label, colorScheme, backgroundImage, palette: { "--header-height": "34px", ... } }` or 404.
- `writer/lib/config.ts` gains `THEME_DIR` (default `./themes/`, relative paths resolved against `Deno.cwd()`); `BACKGROUND_IMAGE` is removed entirely.
- `writer/routes/config.ts` is removed (its only payload, `backgroundImage`, is now per-theme); `app.ts` no longer mounts it.

### D4: Frontend — applying CSS variables

`useTheme.ts` exposes `applyTheme(theme: Theme)`:

```ts
const root = document.documentElement;
for (const [name, value] of Object.entries(theme.palette)) {
  root.style.setProperty(name, value);  // name already includes leading "--"
}
if (theme.colorScheme) root.style.setProperty("color-scheme", theme.colorScheme);
document.body.style.backgroundImage = theme.backgroundImage
  ? `url('${CSS.escape(theme.backgroundImage)}')`
  : "";
```

We set on `document.documentElement.style` (i.e. inline `:root` style) so per-property changes take precedence over the stylesheet's `:root { … }` block without a CSS reload. Switching themes never touches the stylesheet.

### D5: FOUC prevention via static boot script + localStorage cache

The reader ships a strict CSP via `<meta http-equiv="Content-Security-Policy">` in `reader-src/index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws://localhost:*
```

`script-src 'self'` with no `'unsafe-inline'` and no nonce means **inline `<script>` blocks are refused by the browser**. The FOUC primer is therefore implemented as a tiny first-party static asset, not an inline script.

Two `localStorage` keys (unchanged):

- `heartReverie.themeId` — string id of the user's selection.
- `heartReverie.themeCache.<id>` — JSON of the last-fetched full theme payload.

Add `reader-src/public/theme-boot.js` (Vite copies `public/` verbatim to the dist root, so it's served from `/theme-boot.js` as a same-origin asset that satisfies `script-src 'self'`):

```js
(function () {
  try {
    var id = localStorage.getItem("heartReverie.themeId");
    if (!id) return;
    var raw = localStorage.getItem("heartReverie.themeCache." + id);
    if (!raw) return;
    var t = JSON.parse(raw);
    var root = document.documentElement;
    for (var k in t.palette) root.style.setProperty(k, t.palette[k]);
    if (t.colorScheme) root.style.setProperty("color-scheme", t.colorScheme);
    function applyBg() {
      if (!document.body) return;
      if (t.backgroundImage) {
        document.body.style.backgroundImage =
          "url('" + String(t.backgroundImage).replace(/'/g, "\\'") + "')";
      }
    }
    if (document.body) applyBg();
    else document.addEventListener("DOMContentLoaded", applyBg, { once: true });
  } catch (_) {}
})();
```

`reader-src/index.html` references it with a regular tag placed **before** the Vite-injected module entry:

```html
<script src="/theme-boot.js"></script>
<script type="module" src="/src/main.ts"></script>
```

Then on Vue mount, `useTheme().applyOnMount()`:
1. Reads `heartReverie.themeId` (defaults to `"default"`).
2. Fetches `/api/themes/:id` to get fresh data.
3. Reapplies CSS variables via `applyTheme` (idempotent — overrides any drift from the cached values).
4. Updates `heartReverie.themeCache.<id>` for the next reload.

On first ever load (no `themeId` in localStorage), the boot script is a no-op; the stylesheet's `:root { … }` declarations from `theme.css` paint first, then `useTheme` fetches `default` and reapplies. Visual result: identical to today (the `default` theme **is** the current palette).

**CSP verification**: after wiring the boot script, manual verification opens the browser DevTools Console, reloads the page with a populated localStorage cache, and confirms zero `Refused to execute inline script` / `Refused to load the script` violations are logged for `/theme-boot.js`.

### D6: Built-in themes shipped under `themes/`

- `themes/default.toml` — verbatim copy of every value in `theme.css` plus `backgroundImage = "/assets/heart.webp"`. The migration is a 1-pass mechanical translation; the design.md schema block above already lists the canonical values.
- `themes/light.toml` — light scheme: cream/parchment panel backgrounds, ink-grey text, muted rose accent kept as the brand colour, no background image.
- `themes/dark.toml` — neutral dark scheme (slate panels, off-white text, teal accent), no background image.

Tests assert that `default.toml` round-trips to `theme.css`'s palette byte-for-byte.

### D7: Theme variable names are preserved

We keep every CSS custom-property name from `theme.css` *unchanged*. Plugins that already write `var(--border-color)` or `var(--text-main)` keep working. This is a hard constraint on the schema in D2.

### D8: Settings UI surface

A new `/settings/theme` child route (registered with `meta.title = '主題'`) lazy-loads `ThemeSettingsPage.vue`. The page:
- Calls `GET /api/themes` once on mount.
- Renders a single `<select>` listing each `{id, label}`.
- Bound to `useTheme().currentThemeId` (a `ref` initialised from `localStorage`).
- On change: persist id, fetch full theme, apply, refresh cache.

The existing `settings-page` capability already requires the sidebar to be derived from route children's `meta.title` (Requirement: *Extensible tab registration*), so no sidebar code change is needed beyond registering the route.

### D9: Removal of `useBackground` and `BACKGROUND_IMAGE`

Pre-release ⇒ delete outright. Files removed: `reader-src/src/composables/useBackground.ts`, `writer/routes/config.ts`. Imports removed from `App.vue` and `writer/app.ts`. The `frontend-background` capability spec is deleted from `openspec/specs/`. References in `.env.example`, `helm/heart-reverie/values.yaml`, `README.md`, `AGENTS.md` are replaced with `THEME_DIR` documentation.

## Risks / Trade-offs

- **[Malformed theme file crashes server]** → Loader catches per-file parse errors, logs, skips. Startup never fails on a single bad theme.
- **[User selects an id that no longer exists on disk]** → `useTheme` falls back to `"default"` if `GET /api/themes/:id` returns 404; clears the stale `themeId` and cache from localStorage.
- **[FOUC cache desync after theme file edited on disk]** → Inline boot script paints stale values for the first frame; `useTheme` re-fetches and re-applies on mount, correcting any drift within the same render tick. Acceptable for v1.
- **[localStorage payload bloat]** → Each cached theme is < 2 KB; we only cache the currently-selected id (old caches purged on switch).
- **[Plugin variable rename later]** → If we ever rename a `--…` variable, plugins break. The schema in D2 freezes today's names; renames would be a separate, single-pass change covering plugins simultaneously.
- **[`backgroundImage` URL injection / off-origin URL]** → Strictly validated at parse time (D2a): only same-origin paths or `data:` URLs are accepted. Off-origin URLs cause the file to be skipped with a clear log message — they cannot reach the runtime where they would be silently blocked by `img-src 'self' data:`. The frontend additionally CSS-escapes the value when interpolating into `url('…')`.
- **[Public unauth endpoints leak palette]** → CSS palette is non-sensitive (it's already shipped to every browser as part of the bundled stylesheet). Same trust model as the current `/api/config`.

## Migration Plan

1. Add `themes/default.toml` whose `[palette]` block is a verbatim translation of `reader-src/src/styles/theme.css` and whose `backgroundImage` is `/assets/heart.webp`. Add `themes/light.toml`, `themes/dark.toml`.
2. Implement `writer/lib/themes.ts` and `writer/routes/themes.ts`; wire them into `writer/app.ts` (mounted before the auth middleware, like `/api/config` was).
3. Add `THEME_DIR` to `writer/lib/config.ts`. Remove `BACKGROUND_IMAGE`. Remove `writer/routes/config.ts`.
4. Add the static FOUC boot script at `reader-src/public/theme-boot.js` and reference it from `reader-src/index.html` via `<script src="/theme-boot.js"></script>` placed before the Vite module entry. (No inline `<script>` — the project's CSP `script-src 'self'` would refuse it.)
5. Implement `reader-src/src/composables/useTheme.ts`. Delete `useBackground.ts`. Update `App.vue` to call `useTheme().applyTheme()` from `onMounted`.
6. Add `ThemeSettingsPage.vue` and register the `/settings/theme` route with `meta.title: '主題'`.
7. Update docs: `.env.example`, `helm/heart-reverie/values.yaml`, `README.md`, `AGENTS.md` — replace `BACKGROUND_IMAGE` with `THEME_DIR`.
8. Remove `openspec/specs/frontend-background/` (handled automatically when this change is archived if the spec delta lists it as REMOVED).
9. Tests: `tests/writer/lib/themes_test.ts`, `tests/writer/routes/themes_test.ts`, `reader-src/src/composables/__tests__/useTheme.test.ts`. Delete the obsolete `frontend-background` tests in `tests/writer/routes/config_test.ts` (or re-target them at the new themes route).
10. Verify byte-for-byte visual parity by booting the app with `localStorage` cleared: `default` theme must reproduce today's appearance.

Rollback: revert the change set; nothing persists outside the new files plus modifications to the listed config/doc files.

## Open Questions

- Should `THEME_DIR` accept multiple directories (e.g. built-ins + user dir)? **v1: no** — single dir, operators copy/symlink built-ins as needed. Revisit if operator feedback justifies.
- Should we expose a `POST /api/themes/refresh` re-scan endpoint for live updates without restart? **v1: no** — out of scope per the proposal's explicit non-goals (no hot-reload). The `refreshThemes()` lib API is wired up so a future change can expose it cheaply.
