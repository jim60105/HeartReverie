## Context

The HeartReverie reader frontend uses a TOML-driven theme system that exposes palette values as CSS custom properties (e.g. `--panel-bg`). Many components, global stylesheets (`base.css`), and plugin stylesheets bypass this system by writing the default theme's dark-red/pink colours directly — using literal `rgba(180, 30, 60, …)`, `#b41e3c`, `#ffd0dc`, `rgba(255, 100, 140, …)`, and `#c23456` values. Meanwhile, `MainLayout.vue` renders `PluginActionBar` unconditionally while gating `ChatInput` with `v-if="showChatInput"` — the action bar appears on pages where no chat interface exists.

## Goals / Non-Goals

**Goals:**

- All panel-like backgrounds use `var(--panel-bg)` so they adapt to the active theme.
- All accent-derived hardcoded colors across components, `base.css`, and plugin stylesheets are replaced with CSS custom properties so they adapt to any theme.
- `PluginActionBar` is hidden whenever `ChatInput` is hidden.

**Non-Goals:**

- Changing PluginActionBar's internal `v-if="actionButtons.length > 0"` logic — both gates must be satisfied.
- Touching the StorySelector solid-color `#1a0810` case to make it a gradient — the simpler `var(--panel-bg)` just works because the variable already holds the gradient value.
- Replacing semantic colors that are already correctly using existing variables (e.g. `var(--btn-border)`, `var(--item-border)`).
- Changing the ChatInput error-state red colors (`#dc2626`, `#b91c1c`, `#ef4444`, `#ff6b6b`) which are semantic "destructive action" colors independent of theme accent.

## Decisions

### 1. Use `var(--panel-bg)` directly for panel backgrounds

`--panel-bg` in `theme.css` and every theme `.toml` already equals the gradient (or, for light theme, an equivalent light gradient). Using it verbatim keeps the variable surface minimal.

### 2. Introduce new semantic CSS variables for accent-derived colours

The existing theme variable set lacks coverage for several accent-derived patterns used throughout the UI. New variables:

| Variable | Default theme | Role |
|----------|--------------|------|
| `--selection-bg` | `rgba(180, 30, 60, 0.6)` | `::selection` highlight background |
| `--accent-glow` | `rgba(255, 100, 140, 0.5)` | Text-shadow glow on headings |
| `--accent-line` | `#c23456` | Decorative gradient line center colour |
| `--text-hover` | `#ffd0dc` | Highlighted text on hover states |
| `--pill-bg` | `rgba(224, 80, 112, 0.12)` | Variable-pill / tag background |
| `--pill-hover-bg` | `rgba(224, 80, 112, 0.3)` | Variable-pill hover background |
| `--accent-shadow` | `rgba(180, 30, 60, 0.3)` | Box-shadow colour for accent elements |
| `--accent-border` | `rgba(180, 30, 60, 0.5)` | Strong accent border (scene boxes) |
| `--accent-inset` | `rgba(255, 100, 120, 0.1)` | Inset glow in pulse animation |
| `--accent-subtle` | `rgba(180, 30, 60, 0.08)` | Very subtle accent background (error hints, field highlights) |
| `--accent-solid` | `#b41e3c` | Solid accent color for error text / active indicators |

### 3. Reuse existing variables where semantics align

Several hardcoded colours are already defined as CSS variables but components write the literal instead of referencing the var:

- `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)` — used in ToolsMenu, ToolsLayout, SettingsLayout, PromptEditorMessageCard `.pill-plugin`, LoreBrowser tabs, QuickAddPage/ImportCharacterCardPage error hint backgrounds
- `rgba(180, 30, 60, 0.22)` → `var(--btn-hover-bg)` — used in LoreEditor tag hover, LoreBrowser item hover/selected states
- `rgba(180, 30, 60, 0.6)` → `var(--item-border)` for `.pill-plugin` border (semantically similar)

### 4. Gate at layout level, keep component-level guard

Adding `v-if="showChatInput"` on `<PluginActionBar>` in `MainLayout.vue` prevents the component from mounting at all when the chat interface is hidden, saving the composable setup cost. The internal `v-if="actionButtons.length > 0"` remains to hide the bar when no buttons are registered — no change needed inside the component.

## Affected Files

### Global styles
- `reader-src/src/styles/base.css` — `::selection`, `pulse-glow` animation, `.variable-pill` classes
- `reader-src/src/styles/theme.css` — add new variable definitions

### Reader components
- `QuickAddPage.vue` — `#b41e3c` (×4), `rgba(180, 30, 60, 0.08)` (×1)
- `ImportCharacterCardPage.vue` — `#b41e3c` (×4), `rgba(180, 30, 60, 0.08)` (×1)
- `ToolsMenu.vue` — `rgba(180, 30, 60, 0.12)` (×1)
- `ToolsLayout.vue` — `rgba(180, 30, 60, 0.12)` (×1)
- `SettingsLayout.vue` — `rgba(180, 30, 60, 0.12)` (×1)
- `PromptEditorMessageCard.vue` — `rgba(224, 80, 112, 0.12)` (×1), `rgba(180, 30, 60, 0.6/0.12)` (×2)
- `lore/LoreEditor.vue` — `rgba(180, 30, 60, 0.22)` (×1)
- `lore/LoreBrowser.vue` — `rgba(224, 80, 112, 0.12/0.3)` (×2), `rgba(180, 30, 60, 0.22/0.35/0.12/0.4/0.15)` (×6)

### Plugin styles
- `HeartReverie_Plugins/status/styles.css` — `rgba(255, 100, 140, 0.5)`, `rgba(180, 30, 60, 0.5)`, `#ffd0dc`, `rgba(255, 50, 80, 0.08)`
- `HeartReverie_Plugins/options/styles.css` — `#c23456`, `rgba(255, 100, 140, 0.5)`, `rgba(180, 30, 60, 0.3/0.15)`, `#ffd0dc`

### Theme definitions
- `themes/default.toml` — add new palette entries
- `themes/light.toml` — add new palette entries
- `themes/dark.toml` — add new palette entries

## Risks / Trade-offs

- **[Low] CSS specificity**: All affected declarations use flat selectors — swapping a literal for a variable cannot change specificity. No risk.
- **[Low] Dual gate confusion**: Future developers might wonder why two `v-if` guards exist. The inner one is defined by the spec ("no DOM when no buttons"); the outer one is layout-level ("no chat → no bar"). A brief HTML comment clarifies.
- **[Low] Many new variables**: 11 new variables adds surface area, but each has a distinct semantic role and prevents dozens of hardcoded literals. The alternative — dozens of unrelated hardcoded colours — is worse for theming.
- **[Medium] Plugin CSS inherits variables from host**: Plugin stylesheets (`status/styles.css`, `options/styles.css`) are loaded into the same document and can reference `:root` CSS variables. This is already the pattern used (e.g. `var(--text-name)`, `var(--border-color)` in these files). No architectural change needed.
