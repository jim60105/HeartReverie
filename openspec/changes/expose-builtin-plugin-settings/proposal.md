## Why

`context-compaction` already exposes its tuneable knobs (`recentChapters`, `enabled`) on the reader's plugin-settings page through a manifest `settingsSchema` block. Every other built-in plugin ships with hard-coded values that visibly affect runtime behaviour — yet users have no way to tweak them short of editing source files inside the container image. A `dialogue-colorize` user who wants a different accent colour, a `thinking` user on a reasoning-model endpoint that already produces its own `<think>` blocks, or anyone who wants to silence `response-notify` system notifications must fork the plugin. No built-in plugin (besides `context-compaction`) even provides a global `enabled` switch, so opting out requires removing the plugin directory and rebuilding the image.

We are still pre-1.0 with 0 users in the wild, so this is the right moment to widen the settings-page contract. The work splits in two: first, a small engine-enablement pass so plugin settings can actually gate the right things; then, manifest + runtime changes per plugin.

The engine pass is necessary because today:

- `PluginManager.getPromptVariables()` reads every `manifest.promptFragments[].file` directly from disk into static Vento variables; resolved plugin settings are never consulted, and a same-named entry from `getDynamicVariables()` cannot override the static fragment.
- The frontend hook dispatcher passes only a hooks proxy into `mod.register(...)`; there is no live `getSettings(name)` helper, no settings-change broadcast, and no automatic re-render after a `PUT /api/plugins/:name/settings`.
- `/api/plugins/action-buttons` reads manifest data once and ignores plugin settings.

Without those gaps closed, an `enabled = false` toggle could only partially suppress a plugin's runtime contribution, which makes the universal `enabled` promise impossible to keep.

## What Changes

### Engine prerequisites (land before, or together with, the plugin sweep)

1. **Settings-aware prompt-fragment rendering.** `PluginManager.getPromptVariables()` consults each plugin's resolved settings before including `manifest.promptFragments[].file`. When the owning plugin's resolved `settings.enabled === false`, every fragment variable that plugin contributes resolves to the empty string. The same gate also applies to dynamic variables produced via `getDynamicVariables()`.
2. **Frontend plugin-settings register-context helper.** The frontend `register(hooks, context)` register-context gains `context.getSettings(name?)`, returning the most recently resolved settings (or schema defaults) synchronously. A reactive store inside the reader hydrates from `GET /api/plugins/:name/settings` on boot and on each settings-change broadcast.
3. **Settings-changed broadcast + re-render.** A successful `PUT /api/plugins/:name/settings` emits a `plugin-settings:changed` event over the reader's event bus. The chapter renderer subscribes and re-runs the relevant frontend hooks (`frontend-render`, `display-strip-tags`, `notification`) for currently-displayed content. No page reload required for plugins that read settings via `context.getSettings()`.
4. **Settings-aware action buttons.** `/api/plugins/action-buttons` filters out buttons whose owning plugin's resolved `enabled` is `false`. The reader's button strip subscribes to `plugin-settings:changed` and re-fetches.
5. **Explicit non-coverage of strip-tag rules.** A plugin's `promptStripTags` / `displayStripTags` declarations are NOT gated by `enabled`. This is documented as a deliberate trade-off: a plugin's strip-tag rule continues to apply to historical content even when the plugin is disabled; disabling the plugin already removes its own emitted output going forward, so the strip-tag rule has nothing new to strip from current output.

### Per-plugin settings sweep (six built-in plugins)

For each plugin, add a `settingsSchema` block to its `plugin.json` exposing only the safe-to-tune knobs identified by the audit. Where the value is consumed by frontend code, wire the relevant runtime path through `context.getSettings(name)` so the new setting actually takes effect. Where the value is consumed by a prompt fragment, the engine prerequisite (point 1) handles `enabled` automatically; non-`enabled` settings that influence prompt-fragment text are realised by moving the affected fragment into `getDynamicVariables()` (so its content can be rebuilt against the current settings) rather than relying on a static file.

- **`dialogue-colorize`** — `enabled`, `dialogueColor`, `enabledQuoteStyles`. Frontend reads via `context.getSettings("dialogue-colorize")`. The new colour is applied via a dedicated `#plugin-dialogue-color-override` `<style>` element whose rule is appended AFTER the theme's `#theme-highlight-override` element (CSS source-order precedence) so it wins for the same selectors. `dialogueColor` MUST be validated with `CSS.supports("color", value)` before being injected; invalid values fall back to the theme's `--text-name` (i.e., today's behaviour).
- **`polish`** — `enabled` only. Button label and tooltip stay manifest-fixed so action-button visibility is purely a settings-aware filter.
- **`response-notify`** — `enabled`, `notifyTitle`, `notifyBody`, `notifyWhenVisible` (default `false`), `notifyLevel` (`"info" | "success" | "warning"`). The plugin registers on the `notification` hook stage and filters by `context.event === "chat:done"` (this is the existing hook; the audit's earlier "`chat:done` hook" name was wrong).
- **`start-hints`** — `enabled` only. The seven-bullet creative directive belongs at story / lore level, not in plugin settings.
- **`thinking`** — `enabled`, `injectInstruction` (controls the prompt fragment that nudges the model to emit `<think>` blocks; safe to disable when the model already does so natively), `defaultCollapsed`, `completeSummaryLabel`, `streamingSummaryLabel`. Frontend hook for `<think>` rendering is `frontend-render`, not `render-think` (the audit's earlier name was wrong). Label / collapsed settings are read via `context.getSettings("thinking")`. `injectInstruction` requires moving the static `thinking.md` fragment into `getDynamicVariables()`.
- **`user-message`** — `enabled` only. The `<user_message>` wrapper tag name is part of the engine-wide prompt grammar; exposing it as a setting would break inter-plugin parsers.

For every plugin in scope, the new `enabled` setting MUST suppress: prompt fragments (via engine prerequisite 1), frontend hook callbacks (plugin code returns early when `enabled === false`), and action-button click handlers (no-op at click time even if the visibility filter races a stale fetch). Strip-tag declarations are explicitly NOT gated.

Out of scope: backward-compatibility shims, migration tooling, ID renames, per-story overrides.

## Capabilities

### New Capabilities

- `builtin-plugin-settings-coverage` — universal `enabled` contract (and its explicit non-coverage of strip-tags), the per-plugin candidate set, and the runtime-gating rules implied by manifest entries.

### Modified Capabilities

- `plugin-settings` — adds settings-aware fragment rendering, the frontend `context.getSettings(name)` helper, the `plugin-settings:changed` broadcast, and the action-button visibility filter.
- `plugin-action-buttons` — adds the settings-aware visibility rule with stale-fetch click-time fallback.
- `plugin-hooks` — adds the re-render-on-settings-changed contract for `frontend-render`, `display-strip-tags`, and `notification` stages.
- `dialogue-colorize-plugin` — gains the three settings plus the dedicated `::highlight()` literal-color override path with CSS-color validation.
- `response-notify-plugin` — gains the five settings, with the `notifyWhenVisible` default reproducing today's "only when hidden" behaviour.
- `thinking-plugin` — gains the five settings; the prompt-injection toggle requires the prompt fragment to be realised through `getDynamicVariables()`.
- `start-hints-plugin` — gains the `enabled` toggle, realised through engine prerequisite 1.
- `user-message-plugin` — gains the `enabled` toggle only.
- `polish-plugin` — gains the `enabled` toggle only.

## Impact

- Affected engine code: `writer/lib/plugin-manager.ts` (settings-aware fragment rendering, action-button filter), `writer/routes/plugins.ts` (filter action-buttons by resolved settings), `reader-src/src/composables/usePlugins.ts` (settings cache + register-context helper + `plugin-settings:changed` listener), the chapter renderer (re-runs frontend hooks on broadcast), and `PluginSettingsPage.vue` (emit broadcast on save).
- Affected plugin code: `plugins/{dialogue-colorize,polish,response-notify,start-hints,thinking,user-message}/plugin.json`, plus the matching `frontend.js` / `handler.ts` for plugins whose runtime needs to read resolved settings (`dialogue-colorize`, `response-notify`, `thinking`). `thinking` additionally adds a `handler.ts` `getDynamicVariables()` to replace its static fragment.
- Affected APIs: `/api/plugins/action-buttons` becomes settings-aware; `PUT /api/plugins/:name/settings` becomes side-effectful (broadcasts on success).
- User-visible: each of the six plugins gains a tuneable settings card. Default values reproduce today's behaviour exactly, so users who never visit the page see no change.
