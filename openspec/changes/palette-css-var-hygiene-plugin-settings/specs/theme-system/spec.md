# Theme System (delta)

## ADDED Requirements

### Requirement: Reader components reference only declared `--text-*` palette variables

Reader Vue SFCs (`reader-src/src/**/*.vue`) and reader stylesheets (`reader-src/src/styles/*.css`, `reader-src/src/components/**/*.css`) SHALL only reference `--text-*` CSS custom properties that are declared in `reader-src/src/styles/theme.css`.

The pattern `var(--text-undefined-name, literal-fallback)` SHALL NOT be used to "smuggle in" theme-aware syntax for a `--text-*` variable that is not declared. Such usage silently degrades to the literal fallback in every theme — operators switching themes will see the surrounding palette change while the affected element stays frozen on the fallback. Specifically, the following undeclared `--text-*` names SHALL NOT be referenced:

- `--text-primary` (use `--text-main` for principal body text)
- `--text-secondary` (use `--text-italic` for muted/secondary text)

A literal-colour fallback MAY still be supplied as the second `var()` argument as a defensive default for themes that legitimately omit the variable, but the first argument SHALL always name a `--text-*` variable that is declared in `theme.css`.

This requirement governs the `--text-*` family only. Other palette families (`--bg-*`, `--border-*`, `--btn-*`, etc.) carry their own undeclared-variable issues elsewhere in the codebase (`PluginSettingsPage.vue` itself, for example, additionally references undeclared `--bg-secondary` and `--bg-hover`); cleaning those up is out of scope for this change and SHOULD be tracked as a separate audit-and-fix change. This change deliberately scopes to `--text-*` so the spec matches the implementation surface that was actually fixed.

#### Scenario: PluginSettingsPage uses declared `--text-*` palette variables

- **WHEN** `reader-src/src/components/PluginSettingsPage.vue` is searched for undeclared `--text-*` palette references
- **THEN** zero matches SHALL be found for `var(--text-secondary` or `var(--text-primary`
- **AND** the dropdown chevron button colour SHALL reference `var(--text-italic, #888)` (base) and `var(--text-main, #fff)` (hover)
- **AND** the dropdown-empty placeholder colour SHALL reference `var(--text-italic, #888)`

#### Scenario: theme switch updates affected component's text colour

- **WHEN** an operator switches from the `default` theme (dark) to the `light` theme via the Settings page
- **THEN** the `PluginSettingsPage` chevron button colour SHALL update to the light theme's `--text-italic` value
- **AND** its hover colour SHALL update to the light theme's `--text-main` value
- **AND** the dropdown-empty placeholder colour SHALL update to the light theme's `--text-italic` value
- **AND** none of these elements SHALL remain on the dark-theme literal fallback (`#888` / `#fff`)

#### Scenario: literal fallbacks remain as defensive defaults

- **WHEN** a custom theme legitimately omits `--text-italic` from its palette
- **THEN** the affected `var(--text-italic, #888)` calls SHALL fall through to `#888` and continue to render as a sensible muted gray
- **AND** the literal-fallback presence SHALL NOT be removed by future cleanup (it is intentional defensive default)

#### Scenario: out-of-scope undeclared non-`--text-*` variables tolerated

- **WHEN** `PluginSettingsPage.vue` is searched for `var(--bg-secondary` or `var(--bg-hover`
- **THEN** the existence of these undeclared references SHALL NOT violate this requirement (it covers `--text-*` only)
- **AND** these references SHOULD be cleaned up by a separate, broader palette-hygiene audit change
