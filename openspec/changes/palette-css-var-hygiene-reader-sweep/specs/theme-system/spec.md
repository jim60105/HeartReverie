## MODIFIED Requirements

### Requirement: Reader components reference only declared `--text-*` palette variables

Reader Vue SFCs (`reader-src/src/**/*.vue`) and reader stylesheets (`reader-src/src/styles/*.css`, `reader-src/src/components/**/*.css`) SHALL only reference `--text-*` CSS custom properties that are declared in `reader-src/src/styles/theme.css`.

The pattern `var(--text-undefined-name, literal-fallback)` SHALL NOT be used to "smuggle in" theme-aware syntax for a `--text-*` variable that is not declared. Such usage silently degrades to the literal fallback in every theme — operators switching themes will see the surrounding palette change while the affected element stays frozen on the fallback. Specifically, the following undeclared `--text-*` names SHALL NOT be referenced:

- `--text-primary` (use `--text-main` for principal body text)
- `--text-secondary` (use `--text-italic` for muted/secondary text)

A literal-colour fallback MAY still be supplied as the second `var()` argument as a defensive default for themes that legitimately omit the variable, but the first argument SHALL always name a `--text-*` variable that is declared in `theme.css`.

This requirement governs the `--text-*` family. Other palette families (`--bg-*`, `--border-*`, `--btn-*`, `--muted-*`, `--input-*`, `--accent-*`, etc.) are governed by the parallel requirement `Reader components reference only declared host-palette variables across all colour families`.

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

## ADDED Requirements

### Requirement: Reader components reference only declared host-palette variables across all colour families

Every CSS rule authored in a reader Vue SFC (`reader-src/src/components/**/*.vue`, `reader-src/src/views/**/*.vue`) and every reader CSS file (`reader-src/src/styles/**/*.css`, `reader-src/src/components/**/*.css`, excluding `reader-src/src/styles/plugins/` which is plugin-injected) SHALL reference CSS custom properties that are declared in `reader-src/src/styles/theme.css`.

This requirement extends the `--text-*` requirement above to **every** host-palette family — `--bg-*`, `--border-*`, `--muted-*`, `--input-*`, `--accent-*`, `--panel-*`, `--btn-*`, `--header-*`, `--section-*`, `--pill-*`, `--shadow-*`, `--page-*`, `--font-*`, `--settings-*`, `--reading-*`, `--selection-*`, `--divider`, `--item-*`. The contract is uniform: no reader component may reference a host-palette name that does not exist in `theme.css`. Every `var(name, fallback)` call MUST resolve to a real variable in every theme.

The reader source today declares **zero** component-local CSS variables (verified by audit). If a future change introduces a legitimate component-local var (e.g. a page-layout-scoped sizing token), that change SHALL update the catch-all scenario below to enumerate it explicitly.

**Out-of-scope:** colours for which no host-palette token exists today are exempt PROVIDED the `var(--undeclared-name, literal-fallback)` pattern is replaced by inlining the literal directly. At change-application time the only such colours are status `error` and `warn`, which are pending a separate `add-status-palette-tokens` change.

#### Scenario: PluginSettingsPage dropdown panel uses declared backgrounds

- **WHEN** `reader-src/src/components/PluginSettingsPage.vue` is searched for `var(--bg-secondary` or `var(--bg-hover` or `var(--bg-primary` or `var(--bg-tertiary`
- **THEN** zero matches SHALL be found
- **AND** the `.dropdown-options` rule SHALL use `var(--item-bg, #2a2a2a)` for its background
- **AND** the `.dropdown-option:hover` and `.dropdown-option.highlighted` rules SHALL use `var(--btn-hover-bg, #3a3a3a)` for their backgrounds
- **AND** the rendered dropdown-options panel SHALL track the active theme: switching themes updates the panel and hover backgrounds without a page reload

#### Scenario: PromptPreview message card and role badge use declared or inlined backgrounds

- **WHEN** `reader-src/src/components/PromptPreview.vue` is searched for `var(--bg-secondary` or `var(--bg-tertiary` or `var(--bg-primary` or `var(--bg-hover`
- **THEN** zero matches SHALL be found
- **AND** the `.message-card` rule SHALL use `var(--item-bg, transparent)` for its background
- **AND** the `.role-badge` rule SHALL use the literal `rgba(127, 127, 127, 0.15)` directly (no `var()` wrapper) for its background, because no host-palette token semantically matches the neutral-pill register without clashing with the multi-coloured role labels

#### Scenario: PluginActionBar button hover uses declared button-hover token

- **WHEN** `reader-src/src/components/PluginActionBar.vue` is searched for `var(--panel-bg-hover` or `var(--bg-hover`
- **THEN** zero matches SHALL be found
- **AND** the `.plugin-action-btn:hover:not(:disabled)` rule SHALL use `var(--btn-hover-bg, rgba(255, 255, 255, 0.08))` for its background
- **AND** the rendered hover state SHALL track the active theme

#### Scenario: LlmSettingsPage helper text, input, button, and borders use declared variables

- **WHEN** `reader-src/src/components/LlmSettingsPage.vue` is searched for `var(--muted-color` or `var(--input-bg` or `var(--accent-color`
- **THEN** zero matches SHALL be found
- **AND** every helper-text rule that previously referenced `--muted-color` SHALL use `var(--text-italic, #888)` for its `color`
- **AND** every input/border rule that previously referenced `--muted-color` SHALL use `var(--text-italic, #888)` for its `border-color`
- **AND** the `.field-input` rule SHALL use `var(--item-bg, transparent)` for its `background`
- **AND** the `.btn.primary` rule SHALL use `var(--accent-solid, #4a90e2)` for its `background`
- **AND** the rendered helper text, inputs, and primary button SHALL track the active theme

#### Scenario: status colours (error/warn) deferred to a follow-up palette extension

- **WHEN** `reader-src/src/components/LlmSettingsPage.vue` is searched for `var(--error-color` or `var(--warn-color` or `var(--status-`
- **THEN** zero matches SHALL be found
- **AND** the `.status.error` rule SHALL use the literal `#c0392b` directly (no `var()` wrapper) for its `color`
- **AND** the `.status.warn`, `.status.warning` rule SHALL use the literal `#b07d2b` directly (no `var()` wrapper) for its `color`
- **AND** introducing host-palette tokens (`--status-error`, `--status-warn`) and re-wrapping these literals in `var()` calls SHALL be tracked as a separate change

#### Scenario: no undeclared host-palette names anywhere in the reader tree

- **WHEN** the entire reader source tree (`reader-src/src/components/**/*.vue` and `reader-src/src/views/**/*.vue` and `reader-src/src/styles/**/*.css` and `reader-src/src/components/**/*.css`, excluding `reader-src/src/styles/plugins/`) is searched for `var\(--(bg-(primary|secondary|tertiary|hover))|var\(--(text-(primary|secondary))|var\(--(border-primary)|var\(--muted-color|var\(--input-bg|var\(--accent-color|var\(--panel-bg-hover|var\(--error-color|var\(--warn-color`
- **THEN** zero matches SHALL be found

#### Scenario: every remaining var() in the reader tree resolves to theme.css

- **WHEN** the audit is performed at change-application time (grep across the reader tree for `var(--…)`, cross-reference each match against the canonical declared list in `reader-src/src/styles/theme.css`)
- **THEN** the audit SHALL produce a complete enumeration table (one row per `var(--…)` reference) with each row classified as either "declared host palette" or "VIOLATION"
- **AND** the audit SHALL produce zero VIOLATION rows before the change can be marked complete
- **AND** future changes that introduce component-local CSS variables SHALL update this scenario to enumerate them as a third permitted category
