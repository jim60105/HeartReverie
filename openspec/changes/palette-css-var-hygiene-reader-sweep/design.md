## Context

The `theme-system` capability owns the contract that reader components reference only declared host-palette CSS variables. The just-archived `palette-css-var-hygiene-plugin-settings` change scoped its requirement to the `--text-*` family — `PluginSettingsPage.vue` was using undeclared `--text-secondary` and `--text-primary`. That requirement explicitly tolerated undeclared `--bg-*` references "as out-of-scope follow-up" (see `theme-system/spec.md:423-427`).

The audit closing out that follow-up signal grep'd every `var(--name, …)` reference across `reader-src/src/**/*.{vue,css}` (excluding `plugins/`) and cross-referenced each match against `theme.css`'s declared list. Twelve undeclared offenders were found in four files (`PluginSettingsPage.vue`, `PromptPreview.vue`, `PluginActionBar.vue`, `LlmSettingsPage.vue`), plus two more (`--error-color`, `--warn-color`) that have no host-palette equivalent and require a separate palette-extension proposal. This change addresses all twelve mappable sites and inlines the two unmappable ones to remove the silent-fallback bug without prejudicing the future palette decision.

## Goals

1. Eliminate the silent-fallback bug for every undeclared `var(--…)` reference in reader Vue SFCs in one sweep.
2. Map each offender to a semantically appropriate, currently-declared host-palette token (no new palette tokens required for the in-scope sites).
3. Extend the `theme-system` spec contract from `--text-*` to all host-palette colour families, and remove the now-stale out-of-scope tolerance scenario from the prior `--text-*` requirement.
4. Document the two unmappable sites (error/warn) as a follow-up signal pointing at a separate palette-extension change.

## Non-Goals

- Adding `--bg-primary`, `--bg-secondary`, `--bg-hover`, `--bg-tertiary`, `--input-bg`, `--accent-color`, `--panel-bg-hover`, or `--muted-color` to `theme.css`. Each in-scope offender has a perfect existing-token match; adding new palette tokens would inflate the palette without semantic justification.
- Adding `--status-error` / `--status-warn` palette tokens. Status colours are a meaningful design decision (which themes look how when an error displays?) and deserve their own change.
- Touching plugin stylesheets in this repo's `reader-src/styles/plugins/` (those are plugin-injected and audited separately).
- Touching plugin stylesheets in the `HeartReverie_Plugins` repo (sibling proposal `palette-css-var-hygiene-state` covers the state plugin; sibling-clean plugins were verified during the audit).
- Build-time enforcement (lint rule, CSS-in-JS check). Manual review remains the enforcement mechanism, codified in spec scenarios.
- Component layout, behaviour, or any non-CSS concern.

## Decisions

### Decision 1: `--bg-secondary` → `--item-bg`

Two sites: `PluginSettingsPage.vue:771` (dropdown-options panel background) and `PromptPreview.vue:165` (message-card background). `--item-bg` (declared `theme.css:37` as `rgba(255, 255, 255, 0.04)`) is the host's canonical "subtle recessed item" background, used by the chapter list, the settings list, and other panel-internal items.

Rejected alternatives:
- `--panel-bg` — the dropdown is a child of a panel, not a panel itself; using `--panel-bg` would defeat the visual hierarchy.
- New `--bg-recessed` token in `theme.css` — `--item-bg` already serves this exact role.

### Decision 2: `--bg-hover` → `--btn-hover-bg` (NOT `--accent-subtle`)

Two sites: `PluginSettingsPage.vue:786,790` (dropdown option hover and selected). The audit-time idiom check confirmed `--btn-hover-bg` is what the existing reader code uses for list-option-style hover states (`LoreEditor.vue:420-421`, `LoreBrowser.vue:418-420`). `--accent-subtle` is reserved in the existing codebase for warning / collision / tag surfaces (`QuickAddPage.vue:471-474`, `ImportCharacterCardPage.vue:881-884`).

Visual impact: in the default `cosmic-passion` theme `--btn-hover-bg` is `rgba(255, 255, 255, 0.08)` — slightly less dark than the literal `#3a3a3a` it replaces, and consistent with the rest of the host's hover idiom.

Rejected alternative: `--accent-subtle` (would tint the dropdown hover scarlet, which clashes with the rest of the settings page's button-style hover idiom).

### Decision 3: `--bg-tertiary` → strip `var()` and inline the literal `rgba(127, 127, 127, 0.15)`

One site: `PromptPreview.vue:196` (`.role-badge` background). The role badge displays the message role (system/user/assistant) with multi-coloured text labels (`#888`, `#4a90e2`, `#50c878`). The intended background is a deliberately neutral grey wash that doesn't clash with any of the three label colours.

No host palette token fits:
- `--item-bg` (rgba 4% white) is too subtle on the dark page; the badge would visually disappear.
- `--pill-bg` (rgba 224,80,112,0.12, accent-pink wash) clashes with the user-blue and assistant-green text colours.

Inlining the existing literal `rgba(127, 127, 127, 0.15)` removes the silent-fallback bug (eliminates the misleading `var(--bg-tertiary, …)` reference) without forcing a poor mapping. Visual impact: pixel-identical to the current rendering.

### Decision 4: `--panel-bg-hover` → `--btn-hover-bg`

One site: `PluginActionBar.vue:71` (`.plugin-action-btn:hover` background). The element is a button, so the host's `--btn-hover-bg` is the natural fit. In the default theme its value is `rgba(255, 255, 255, 0.08)` — exactly the same as the existing literal fallback `rgba(255, 255, 255, 0.08)`. Pixel-identical in default theme; theme-tracked elsewhere.

### Decision 5: `--muted-color` → `--text-italic` (4 sites)

Mirrors the prior `palette-css-var-hygiene-plugin-settings` decision: `--text-italic` (declared `theme.css:32` as `rgba(145, 145, 145, 1)`) is the host's canonical de-emphasized text colour. The four `LlmSettingsPage.vue` sites (3 `color` + 1 `border-color`) all share the "subdued informational text/border" semantic.

For the L585 `border-color: var(--muted-color, #888)` site, `--text-italic` renders as a soft grey border — same visual register as the original literal `#888`.

### Decision 6: `--input-bg` → `--item-bg`

One site: `LlmSettingsPage.vue:573` (`.field-input` background). Form input backgrounds share the recessed-item register; using `--item-bg` brings field affordance into line with the rest of the host. Visual impact in default theme: `transparent` → `rgba(255, 255, 255, 0.04)` — a barely-perceptible darkening that improves the field's perceived edge.

### Decision 7: `--accent-color` → `--accent-solid`

One site: `LlmSettingsPage.vue:605` (`.btn.primary` background). `--accent-solid` (declared `theme.css:66` as `#b41e3c` scarlet in the default theme) is the host's primary call-to-action colour. The literal blue `#4a90e2` was an accidental override; the corrected button now matches every other primary-action button on the page.

### Decision 8: `--error-color` / `--warn-color` → strip `var()`, deferred follow-up

Two sites: `LlmSettingsPage.vue:621` (`color: var(--error-color, #c0392b)`) and `LlmSettingsPage.vue:626` (`color: var(--warn-color, #b07d2b)`). No host palette token exists for status colours. Three options:

1. **Add `--status-error` / `--status-warn` to `theme.css`.** Rejected for THIS change: status palette is a meaningful per-theme design choice (does the dark theme use brighter or muted status colours? do scarlet themes recolour the error red?) that deserves its own change with theme-author input.
2. **Map to existing `--accent-*` tokens.** Rejected: `--accent-solid` is scarlet (clashes with error red), `--accent-line` is the wrong intensity. Forcing a mapping would rebrand the existing semantics.
3. **Strip `var()` and inline the literal.** Chosen. Removes the silent-fallback bug (eliminates misleading "this tracks the theme" syntax that doesn't actually) without prejudicing the future palette decision. Visually pixel-identical.

The follow-up signal is recorded in `tasks.md` and explicitly out-of-scope per the new spec requirement scenarios.

### Decision 9: spec — MODIFY existing `--text-*` requirement + ADD broader requirement

Two reasons for the dual delta:
1. The existing `Reader components reference only declared --text-* palette variables` requirement contains a now-false "out-of-scope undeclared non-`--text-*` variables tolerated" scenario (lines 423-427). Leaving it unchanged after this change archives would create stale guidance contradicting the new broader requirement.
2. The new requirement is genuinely broader (covers all colour families, not just `--text-*`), so it deserves to be a first-class requirement, not a sub-clause of the `--text-*` one.

The MODIFIED delta surgically removes only the stale scenario; the rest of the `--text-*` requirement (which remains correct) is preserved verbatim. The ADDED requirement spells out the broader contract with scenarios per-file and a generic catch-all.

### Decision 10: catch-all scenario — drop the broken component-local enumeration

The previous draft enumerated `--header-height, --scene-banner-width, --character-card-width, --audit-row-pad, --audit-col-min` as documented component-local vars. Audit confirmed:
- `--header-height` IS in `theme.css:7` (host palette, not component-local).
- `--scene-banner-width, --character-card-width, --audit-row-pad, --audit-col-min` do not exist anywhere in the reader source.

The reader source declares **zero** component-local CSS variables (verified by grep). Every `var(--…)` reference in the reader resolves to `theme.css`. The catch-all scenario is therefore simplified: every `var(--…)` reference in the reader (excluding `plugins/`) SHALL resolve to a name declared in `theme.css`. No component-local exception is needed today; if a future change introduces one, that change will update this scenario.

## Risks / Trade-offs

- **Risk: `.btn.primary` colour change is conspicuous.** The LLM-settings primary button changes from blue to scarlet in the default theme. Acceptable: this is the correct theme-tracking behaviour; the literal blue was an accident; the rest of the page already uses scarlet for primary actions.
- **Risk: visual shift in dropdown panel default theme.** Solid `#2a2a2a` → `rgba(255, 255, 255, 0.04)` makes the dropdown more transparent on the dark page. Acceptable: matches the rest of the host's recessed-item idiom; the prior literal was the accident.
- **Risk: error/warn defer leaves two `var()` wrappers stripped to literals.** A future contributor may not realize the original intent was theme-aware. Mitigated by the follow-up signal in `tasks.md` and the explicit spec scenario listing them as out-of-scope.
- **Trade-off: not adding new theme tokens.** A future contributor wanting "secondary background", "tertiary background", or "status error" semantics must propose a new theme-palette change. Acceptable: keeps the palette small and forces deliberate semantic naming.
- **Risk: spec catch-all is now strict.** Every reader `var(--…)` reference must resolve to a name in `theme.css`. If a future change introduces a legitimate component-local var, the spec must be updated alongside. Mitigated: the spec scenario explicitly says component-local vars require updating this scenario when introduced.
