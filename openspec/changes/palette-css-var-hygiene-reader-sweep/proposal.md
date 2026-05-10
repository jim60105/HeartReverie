## Why

Following the just-archived `palette-css-var-hygiene-plugin-settings` change (which fixed `--text-secondary` and `--text-primary` in `PluginSettingsPage.vue`), an exhaustive grep audit across `reader-src/src/**/*.{vue,css}` (excluding `plugins/`, which is plugin-injected) surfaced **eleven** additional reader-component sites that exhibit the same silent-fallback anti-pattern across the `--bg-*`, `--muted-*`, `--input-*`, `--accent-color`, and `--panel-bg-hover` families. None of these names are declared in `reader-src/src/styles/theme.css`; every `var(name, fallback)` call therefore degrades to the hardcoded literal in every theme.

| File | Line | Reference | Semantic role |
|---|---|---|---|
| `PluginSettingsPage.vue` | 771 | `background: var(--bg-secondary, #2a2a2a)` | `.dropdown-options` panel |
| `PluginSettingsPage.vue` | 786 | `background: var(--bg-hover, #3a3a3a)` | `.dropdown-option:hover` |
| `PluginSettingsPage.vue` | 790 | `background: var(--bg-hover, #3a3a3a)` | `.dropdown-option.highlighted` |
| `PromptPreview.vue` | 165 | `background: var(--bg-secondary, transparent)` | `.message-card` |
| `PromptPreview.vue` | 196 | `background: var(--bg-tertiary, rgba(127,127,127,0.15))` | `.role-badge` neutral pill |
| `PluginActionBar.vue` | 71 | `background: var(--panel-bg-hover, rgba(255,255,255,0.08))` | `.plugin-action-btn:hover` |
| `LlmSettingsPage.vue` | 523 | `color: var(--muted-color, #888)` | `.field-hint` helper text |
| `LlmSettingsPage.vue` | 566 | `color: var(--muted-color, #888)` | `.field-hint` helper text |
| `LlmSettingsPage.vue` | 573 | `background: var(--input-bg, transparent)` | `.field-input` form field |
| `LlmSettingsPage.vue` | 585 | `border-color: var(--muted-color, #888)` | `.muted` input border |
| `LlmSettingsPage.vue` | 605 | `background: var(--accent-color, #4a90e2)` | `.btn.primary` button |
| `LlmSettingsPage.vue` | 616 | `color: var(--muted-color, #888)` | `.status` text |

Two additional sites — `LlmSettingsPage.vue:621` (`--error-color`) and `LlmSettingsPage.vue:626` (`--warn-color`) — also fail the audit, but they have **no equivalent in the host palette today**. Introducing host palette tokens for error/warn status semantics is a meaningful design decision (which themes look how when an error displays?) and is **deferred to a separate change**; this proposal addresses error/warn by stripping the `var()` wrapper and inlining the existing literal colours, so the silent-fallback bug is removed without prejudicing the future palette decision.

The prior `palette-css-var-hygiene-plugin-settings` spec recorded the broader sweep as an out-of-scope follow-up signal (see `archive/2026-05-10-palette-css-var-hygiene-plugin-settings/tasks.md:24`). This change closes it out and extends the spec contract from `--text-*` to **all** host-palette families.

## What Changes

### Code mappings (no backward compatibility concerns; project has zero users)

- **`--bg-secondary`** (2 sites) → **`--item-bg`** — declared `theme.css:37` as `rgba(255, 255, 255, 0.04)`, the host's existing subtle-recessed item background; semantically the right register for a dropdown options panel and a quoted message card.
- **`--bg-hover`** (2 sites) → **`--btn-hover-bg`** — declared `theme.css:73`, the host's idiomatic hover-tint already used by `LoreEditor.vue` (line 420), `LoreBrowser.vue` (line 418), and others for list-option-style hover states. Closer fit than `--accent-subtle` (which is reserved for warning/collision/tag surfaces in the existing codebase).
- **`--bg-tertiary`** (1 site) → **literal `rgba(127, 127, 127, 0.15)`** (drop the `var()` wrapper) — the role-badge background is a deliberately neutral wash that has no host-palette equivalent (`--item-bg` is too subtle on the dark page; `--pill-bg` is accent-pink and would clash with the multi-coloured role labels). Using the literal directly removes the silent-fallback bug without forcing a poor mapping.
- **`--panel-bg-hover`** (1 site) → **`--btn-hover-bg`** — `PluginActionBar` is a button, so the host's button-hover idiom is the natural match.
- **`--muted-color`** (4 sites: 3 `color`, 1 `border-color`) → **`--text-italic`** — declared `theme.css:32` as `rgba(145, 145, 145, 1)`, the host's canonical de-emphasized text colour; same mapping used by the prior plugin-settings fix and the parallel state-plugin proposal.
- **`--input-bg`** (1 site) → **`--item-bg`** — form field backgrounds match the recessed-item register; the existing literal fallback was `transparent`, so the visual change in the default theme is from transparent to the very subtle `rgba(255, 255, 255, 0.04)` (a barely-perceptible darkening that improves field affordance).
- **`--accent-color`** (1 site) → **`--accent-solid`** — declared `theme.css:66`, the host's primary call-to-action colour; the natural match for `.btn.primary`.
- **`--error-color` / `--warn-color`** (2 sites) → **strip `var()` and use the existing literal directly** (`#c0392b` / `#b07d2b`). Recorded in `tasks.md` as a follow-up signal: introducing `--status-error` / `--status-warn` palette tokens is a separate change.

All literal fallbacks for the kept-with-`var()` sites are preserved (`#2a2a2a`, `#3a3a3a`, `transparent`, `#888`, `#4a90e2`) for FOUC safety.

### Spec deltas

This change touches the existing `theme-system` spec in two ways:

1. **MODIFIED** the existing `Reader components reference only declared --text-* palette variables` requirement to **remove** the now-stale "out-of-scope undeclared non-`--text-*` variables tolerated" scenario (the new broader requirement supersedes it).
2. **ADDED** a new requirement `Reader components reference only declared host-palette variables across all colour families` that covers `--bg-*`, `--border-*`, `--muted-*`, `--input-*`, `--accent-*` and any future host-palette family. The contract is uniform: no reader component may reference a host-palette name that does not exist in `theme.css`. Status colours (error/warn) are explicitly carved out as out-of-scope until a separate change introduces them to the palette.

## Impact

- Affected specs: `theme-system` (1 MODIFIED + 1 ADDED requirement).
- Affected code: `reader-src/src/components/{PluginSettingsPage,PromptPreview,PluginActionBar,LlmSettingsPage}.vue`. Four files, twelve `var()` sites adjusted, plus two `var()` wrappers stripped.
- Visual impact (default `cosmic-passion` theme):
  - Dropdown-option panel: `#2a2a2a` solid → `rgba(255, 255, 255, 0.04)` (very subtle; the original literal was an accident).
  - Dropdown-option hover/selected: `#3a3a3a` solid → `--btn-hover-bg` value (`rgba(255, 255, 255, 0.08)` in the default theme — slightly less dark than before, matching the rest of the host's hover idiom).
  - Plugin action button hover: `rgba(255, 255, 255, 0.08)` literal → `var(--btn-hover-bg)` (visually identical in default theme; theme-tracked elsewhere).
  - Message card (PromptPreview): `transparent` (no change in default theme; theme-tracked elsewhere).
  - Role badge (PromptPreview): pixel-identical (literal preserved verbatim, only the var() wrapper removed).
  - LLM helper text: `#888` → `rgba(145, 145, 145, 1)` (visually indistinguishable; theme-tracked).
  - LLM input field: `transparent` → `rgba(255, 255, 255, 0.04)` (subtle field affordance).
  - LLM primary button: `#4a90e2` (literal blue) → `var(--accent-solid)` (`#b41e3c` scarlet in default theme — significant colour change, but this is the correct theme-tracking behaviour: the prior literal was an accidental override).
  - LLM error/warn status text: pixel-identical (literals preserved; only `var()` wrapper removed).
- No behavioural impact (event handling, layout, navigation, persistence all unchanged).
- No backward compatibility concerns (per project policy: zero in-the-wild users).
- No engine, prompt template, plugin manifest, or theme.css change.
- Out-of-scope follow-up recorded in `tasks.md`: introduce `--status-error` and `--status-warn` palette tokens to `theme.css` and switch `LlmSettingsPage.vue:621,626` from literals back to `var()` references.
