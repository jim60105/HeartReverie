# Design — palette-css-var-hygiene-plugin-settings

## Bug class recap

`var(--undefined, fallback)` always resolves to `fallback` because the named property is never declared. The CSS reads as theme-aware but isn't. The user-visible symptom is "this element doesn't change colour when I change themes."

The project already has a documented hygiene requirement for plugin stylesheets (`### Requirement: Plugin stylesheets use theme variables instead of hardcoded colours` in `theme-system`). This change extends the same hygiene to reader components — Vue SFCs in `reader-src/` SHALL also reference only declared palette variables.

## Replacement mapping

The reader theme palette declares (in `reader-src/src/styles/theme.css`):

| Variable           | Default value              | Semantic role               |
| ------------------ | -------------------------- | --------------------------- |
| `--text-main`      | `rgba(207, 207, 197, 1)`   | Principal body text         |
| `--text-name`      | `#ff8aaa`                  | Character name accent       |
| `--text-title`     | `#e05070`                  | Headings                    |
| `--text-label`     | `#ff7a96`                  | Labels (theme-accent pink)  |
| `--text-italic`    | `rgba(145, 145, 145, 1)`   | Italics, de-emphasized text |
| `--text-underline` | `rgba(145, 145, 145, 1)`   | Underlined text             |
| `--text-quote`     | `rgba(198, 193, 151, 1)`   | Quoted text (warm tan)      |
| `--text-hover`    | `#ffd0dc`                  | Hover state                 |

Two affected selectors in `PluginSettingsPage.vue`:

1. `.chevron-btn { color: var(--text-secondary, #888); }` (base) and `.chevron-btn:hover { color: var(--text-primary, #fff); }` (hover) — the dropdown disclosure button. Base is muted; hover is full-strength.
2. `.dropdown-empty { color: var(--text-secondary, #888); ...}` — placeholder text shown when no dropdown options match.

Mapping:

- `--text-secondary` → `--text-italic` (gray, muted, de-emphasized — semantic match for "secondary text"; matches the same choice made for the plugin stylesheet hygiene fix in `HeartReverie_Plugins/sd-webui-image-gen/styles.css`).
- `--text-primary` → `--text-main` (principal body-text colour; semantic match for "primary text").

The hover transition `--text-italic` → `--text-main` produces the same gray→light-text feel the original `--text-secondary` → `--text-primary` was attempting to express, and now it actually changes when themes change. In the light theme, both variables are remapped to dark colours in the palette, so the hover transition still produces a meaningful contrast.

## Fallback retention

The literal fallbacks (`#888`, `#fff`) are preserved. They are the original dark-theme appearance and serve as defensive defaults for any future theme that legitimately omits a `--text-*` variable. They never apply when any of the built-in themes (`default`, `dark`, `light`) is active because all of them declare both `--text-italic` and `--text-main`.

## Spec placement

The new requirement lives under the `theme-system` capability in this repo (HeartReverie). It complements the two existing requirements:

- `Reader components use theme variables for accent-derived colours` — about not hardcoding the accent rgba palette.
- `Plugin stylesheets use theme variables instead of hardcoded colours` — about plugin stylesheets, in this repo's spec because it constrains the project's bundled reference plugins.

The new requirement (`Reader components reference only declared palette variables`) addresses a different sibling concern: not the use of hardcoded literals, but the reverse mistake of referencing variables that were never declared. Both bug classes silently produce theme-frozen colours.

## Verification

- `grep -nE "var\(--(text|bg)-(secondary|primary|hover)\b" reader-src/src/components/` returns no matches in `PluginSettingsPage.vue` after the change.
- A follow-up audit could grep the entire `reader-src/` tree for the same pattern; that audit is recorded as out of scope for this change (which only fixes the file the user surfaced).
- Container rebuild + smoke: open the reader Plugins settings page, confirm the chevron button and dropdown-empty placeholder render in the active theme's gray-italic / body-main colours.
