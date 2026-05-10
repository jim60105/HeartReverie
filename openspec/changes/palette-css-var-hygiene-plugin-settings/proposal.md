## Why

`reader-src/src/components/PluginSettingsPage.vue` referenced two CSS custom properties that are **not declared** anywhere in the theme palette (`reader-src/src/styles/theme.css`):

- `var(--text-secondary, #888)` at lines 753 and 800 — used for the dropdown chevron button colour and the empty-dropdown placeholder text.
- `var(--text-primary, #fff)` at line 760 — used for the chevron button hover state.

The defined `--text-*` palette is `--text-main`, `--text-name`, `--text-title`, `--text-label`, `--text-italic`, `--text-underline`, `--text-quote`, `--text-hover`. There is no `--text-secondary` and no `--text-primary` — those names are conventions from other design systems (e.g. Material, Tailwind) that the project's palette deliberately doesn't use.

The `var()` calls therefore always fell back to the hardcoded literals `#888` and `#fff` and never reflected the active theme. This is a silent failure: an operator switching from the `default` (dark) theme to the `light` theme would see the rest of the page's text colours flip while the chevron button colour stayed `#888` and its hover state stayed `#fff` — resulting in poor contrast on the light theme and a clear theme-integration bug.

This is the exact bug class already addressed for plugin stylesheets in the existing `Plugin stylesheets use theme variables instead of hardcoded colours` requirement; this change extends the same hygiene to a reader component.

## What Changes

- Replace both `var(--text-secondary, #888)` sites in `PluginSettingsPage.vue` with `var(--text-italic, #888)`. `--text-italic` (`rgba(145, 145, 145, 1)` in the default theme) is the closest semantic match for muted/secondary text in the palette.
- Replace `var(--text-primary, #fff)` in `PluginSettingsPage.vue` with `var(--text-main, #fff)`. `--text-main` is the principal body-text colour and is the natural pair to `--text-italic`'s muted variant.
- Preserve the literal-colour fallbacks (`#888`, `#fff`) so the component still renders sanely if a custom theme legitimately omits the variable.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `theme-system`: extends the existing reader-component palette-hygiene story with a requirement that all reader components reference only declared `--text-*` palette variables (preventing the silent-fallback bug class from recurring in the `--text-*` family). Other palette families (`--bg-*`, `--border-*`, etc.) carry their own undeclared-variable issues elsewhere in the codebase and are explicitly out of scope for this change.

## Impact

Affected files (all already committed in `b34cc0e`):

- `HeartReverie/reader-src/src/components/PluginSettingsPage.vue` lines 753, 760, 800 — two `--text-secondary` → `--text-italic`; one `--text-primary` → `--text-main`.

External impact: zero. The replacement values track the active theme but are visually very close to the previous fallbacks in the default theme. In the light theme (and any custom theme), the chevron button and placeholder now correctly use the theme's defined gray-italic / body-main values instead of staying frozen on the dark-theme fallbacks.
