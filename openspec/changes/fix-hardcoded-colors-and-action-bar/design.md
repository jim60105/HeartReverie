## Context

The HeartReverie reader frontend uses a TOML-driven theme system that exposes palette values as CSS custom properties (e.g. `--panel-bg`). Three components bypass this system by writing the default theme's dark-red colours directly into their `<style scoped>` blocks. Meanwhile, `MainLayout.vue` renders `PluginActionBar` unconditionally while gating `ChatInput` with `v-if="showChatInput"` — the action bar appears on pages where no chat interface exists.

## Goals / Non-Goals

**Goals:**

- All panel-like backgrounds use `var(--panel-bg)` so they adapt to the active theme.
- `PluginActionBar` is hidden whenever `ChatInput` is hidden.

**Non-Goals:**

- Redesigning theme variable names or adding new variables (existing `--panel-bg` already covers every case).
- Changing PluginActionBar's internal `v-if="actionButtons.length > 0"` logic — both gates must be satisfied.
- Touching the StorySelector solid-color `#1a0810` case to make it a gradient — the simpler `var(--panel-bg)` just works because the variable already holds the gradient value.

## Decisions

### 1. Use `var(--panel-bg)` directly (no new variable)

`--panel-bg` in `theme.css` and every theme `.toml` already equals the gradient (or, for light theme, an equivalent light gradient). Using it verbatim keeps the variable surface minimal.

Alternative considered: Introduce `--dropdown-bg` / `--dialog-bg`. Rejected — these are all "panel" backgrounds, same role as the variable already serves.

### 2. Gate at layout level, keep component-level guard

Adding `v-if="showChatInput"` on `<PluginActionBar>` in `MainLayout.vue` prevents the component from mounting at all when the chat interface is hidden, saving the composable setup cost. The internal `v-if="actionButtons.length > 0"` remains to hide the bar when no buttons are registered — no change needed inside the component.

Alternative considered: Move the visibility logic inside `PluginActionBar` via a prop. Rejected — the `showChatInput` computed already exists in `MainLayout`; passing it down adds API surface for no benefit.

## Risks / Trade-offs

- **[Low] CSS specificity**: All affected declarations are in `<style scoped>` with flat selectors — swapping a literal for a variable cannot change specificity. No risk.
- **[Low] Dual gate confusion**: Future developers might wonder why two `v-if` guards exist. The inner one is defined by the spec ("no DOM when no buttons"); the outer one is layout-level ("no chat → no bar"). A brief HTML comment clarifies.
