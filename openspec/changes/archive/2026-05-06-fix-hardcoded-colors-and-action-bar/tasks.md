## 1. Replace hardcoded colours with theme variable (panel-bg) — DONE

- [x] 1.1 In `StorySelector.vue`, replace `background: #1a0810` with `background: var(--panel-bg)`
- [x] 1.2 In `LoreEditor.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in `.tag-suggestion-list`
- [x] 1.3 In `LoreEditor.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in `.confirm-dialog`
- [x] 1.4 In `LoreBrowser.vue`, replace `background: linear-gradient(145deg, #1a0810, #220c16)` with `background: var(--panel-bg)` in the search results dropdown

## 2. Gate PluginActionBar with showChatInput — DONE

- [x] 2.1 In `MainLayout.vue`, add `v-if="showChatInput"` to the `<PluginActionBar>` element
- [x] 2.2 Update `usePluginActions` test expectations: `backend-only` on non-last chapter should now NOT render (layout gate prevents mount)

## 3. Define new theme variables

- [x] 3.1 Add 11 new CSS variables to `theme.css` `:root` fallback block (`--selection-bg`, `--accent-glow`, `--accent-line`, `--text-hover`, `--pill-bg`, `--pill-hover-bg`, `--accent-shadow`, `--accent-border`, `--accent-inset`, `--accent-subtle`, `--accent-solid`)
- [x] 3.2 Add corresponding palette entries to `themes/default.toml`
- [x] 3.3 Add corresponding palette entries to `themes/light.toml` (adapted to light rose/brown palette)
- [x] 3.4 Add corresponding palette entries to `themes/dark.toml` (adapted to teal-green palette)

## 4. Replace hardcoded accent colours in base.css

- [x] 4.1 Replace `::selection` / `::-moz-selection` `rgba(180, 30, 60, 0.6)` with `var(--selection-bg)`
- [x] 4.2 Replace `pulse-glow` animation colors: `rgba(180, 30, 60, 0.4)` → `var(--accent-shadow)`, `rgba(255, 100, 120, 0.1/0.15)` → `var(--accent-inset)`
- [x] 4.3 Replace `.variable-pill` `rgba(224, 80, 112, 0.12)` → `var(--pill-bg)`, hover `rgba(224, 80, 112, 0.3)` → `var(--pill-hover-bg)`
- [x] 4.4 Replace `.pill-plugin` `rgba(180, 30, 60, 0.6)` border → `var(--item-border)`, `rgba(180, 30, 60, 0.12)` bg → `var(--btn-active-bg)`, hover `rgba(180, 30, 60, 0.25)` → `var(--btn-hover-bg)`

## 5. Replace hardcoded accent colours in reader components

- [x] 5.1 `QuickAddPage.vue`: replace `#b41e3c` (×4) → `var(--accent-solid)`, `rgba(180, 30, 60, 0.08)` → `var(--accent-subtle)`
- [x] 5.2 `ImportCharacterCardPage.vue`: replace `#b41e3c` (×4) → `var(--accent-solid)`, `rgba(180, 30, 60, 0.08)` → `var(--accent-subtle)`
- [x] 5.3 `ToolsMenu.vue`: replace `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)`
- [x] 5.4 `ToolsLayout.vue`: replace `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)`
- [x] 5.5 `SettingsLayout.vue`: replace `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)`
- [x] 5.6 `PromptEditorMessageCard.vue`: replace `rgba(224, 80, 112, 0.12)` → `var(--pill-bg)`, `rgba(180, 30, 60, 0.6)` → `var(--item-border)`, `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)`
- [x] 5.7 `lore/LoreEditor.vue`: replace remaining `rgba(180, 30, 60, 0.22)` → `var(--btn-hover-bg)`
- [x] 5.8 `lore/LoreBrowser.vue`: replace `rgba(224, 80, 112, 0.12/0.3)` → `var(--pill-bg)` / `var(--pill-hover-bg)`, `rgba(180, 30, 60, 0.22)` → `var(--btn-hover-bg)`, `rgba(180, 30, 60, 0.35)` → `var(--accent-shadow)`, `rgba(180, 30, 60, 0.12)` → `var(--btn-active-bg)`, `rgba(180, 30, 60, 0.4)` → `var(--accent-border)`, `rgba(180, 30, 60, 0.15)` → `var(--accent-subtle)`

## 6. Replace hardcoded accent colours in plugin stylesheets

- [x] 6.1 `HeartReverie_Plugins/status/styles.css`: replace `rgba(255, 100, 140, 0.5)` → `var(--accent-glow)`, `rgba(180, 30, 60, 0.5)` → `var(--accent-border)`, `#ffd0dc` → `var(--text-hover)`, `rgba(255, 50, 80, 0.08)` → `var(--accent-subtle)`
- [x] 6.2 `HeartReverie_Plugins/options/styles.css`: replace `#c23456` → `var(--accent-line)`, `rgba(255, 100, 140, 0.5)` → `var(--accent-glow)`, `#ffd0dc` → `var(--text-hover)`, `rgba(180, 30, 60, 0.3)` → `var(--accent-shadow)`, `rgba(180, 30, 60, 0.15)` → `var(--accent-subtle)`

## 7. Validation

- [x] 7.1 Run `deno task check` to confirm no type errors
- [x] 7.2 Run `deno task test` to confirm all existing tests pass
- [x] 7.3 Visually verify in podman build that theme switch updates all affected elements
- [x] 7.4 Verify plugin rendering (status panel, options action bar) adapts correctly across themes
